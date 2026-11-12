import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CollisionWorld,
  MapValidationError,
  PLAYER,
  canFit,
  createInput,
  createPlayerState,
  parseMap,
  simulateTick,
  spawnPlayer,
  TICK_RATE,
} from '../src/index.ts';

const MAPS_DIR = new URL('../../content/maps/', import.meta.url);

function validMap(): Record<string, unknown> {
  return {
    version: 1,
    name: 'Test',
    killY: -20,
    spawns: [{ pos: [0, 0, 0], yaw: 0 }],
    blocks: [{ pos: [-5, -1, -5], size: [10, 1, 10], color: '#aabbcc', type: 'box' }],
    sky: { top: '#000000', horizon: '#111111', bottom: '#222222' },
    fog: { color: '#333333', near: 10, far: 100 },
    sun: { direction: [-1, -1, 0], color: '#ffffff', intensity: 2 },
    ambient: { sky: '#ffffff', ground: '#000000', intensity: 1 },
  };
}

describe('validazione delle mappe', () => {
  it('accetta una mappa valida', () => {
    const map = parseMap(validMap(), 'test.json');
    expect(map.blocks).toHaveLength(1);
    expect(map.blocks[0]!.type).toBe('box');
  });

  it('indica file e campo quando un colore non è valido', () => {
    const raw = validMap();
    (raw.blocks as Record<string, unknown>[])[0]!.color = 'rosso';
    expect(() => parseMap(raw, 'test.json')).toThrowError(MapValidationError);
    expect(() => parseMap(raw, 'test.json')).toThrowError(/test\.json: "blocks\[0\]\.color"/);
  });

  it('rifiuta una rampa senza direzione', () => {
    const raw = validMap();
    (raw.blocks as Record<string, unknown>[]).push({ pos: [0, 0, 0], size: [2, 1, 2], color: '#ffffff', type: 'ramp' });
    expect(() => parseMap(raw, 'test.json')).toThrowError(/blocks\[1\]\.dir/);
  });

  it('rifiuta dimensioni nulle o negative', () => {
    const raw = validMap();
    (raw.blocks as Record<string, unknown>[])[0]!.size = [10, 0, 10];
    expect(() => parseMap(raw, 'test.json')).toThrowError(/blocks\[0\]\.size\[1\]/);
  });
});

describe('mappe in /content/maps', () => {
  const files = readdirSync(MAPS_DIR).filter((name) => name.endsWith('.json'));

  it('esiste almeno una mappa', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: è valida e ogni punto di rinascita è libero e porta a terra`, () => {
      const map = parseMap(JSON.parse(readFileSync(new URL(file, MAPS_DIR), 'utf8')), file);
      const world = CollisionWorld.fromBlocks(map.blocks);
      for (const spawn of map.spawns) {
        const [x, y, z] = spawn.pos;
        expect(canFit(world, x, y, z, PLAYER.height)).toBe(true);
        const p = createPlayerState();
        spawnPlayer(p, spawn);
        for (let i = 0; i < TICK_RATE * 3; i++) simulateTick(p, createInput(), world);
        expect(p.grounded).toBe(true);
        expect(p.y).toBeGreaterThan(map.killY);
      }
    });

    it(`${file}: 5 minuti di input casuali, anche a velocità estreme, senza mai entrare nei blocchi`, () => {
      const map = parseMap(JSON.parse(readFileSync(new URL(file, MAPS_DIR), 'utf8')), file);
      const world = CollisionWorld.fromBlocks(map.blocks);
      const minX = Math.min(...world.solids.map((s) => s.minX));
      const maxX = Math.max(...world.solids.map((s) => s.maxX));
      const minZ = Math.min(...world.solids.map((s) => s.minZ));
      const maxZ = Math.max(...world.solids.map((s) => s.maxZ));
      const p = createPlayerState();
      spawnPlayer(p, map.spawns[0]!);
      const cmd = createInput();
      let seed = 2024;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < TICK_RATE * 300; i++) {
        if (i % 30 === 0) {
          cmd.yaw = random() * Math.PI * 2;
          cmd.forward = random() < 0.85 ? 1 : -1;
          cmd.right = random() < 0.3 ? -1 : random() < 0.6 ? 1 : 0;
          cmd.jump = random() < 0.5;
          cmd.crouch = random() < 0.25;
        }
        // Ogni tanto una spinta orizzontale enorme, per cercare di attraversare i muri.
        if (i % 600 === 300) {
          p.vx = (random() - 0.5) * 120;
          p.vz = (random() - 0.5) * 120;
          p.vy = (random() - 0.5) * 10;
        }
        cmd.yaw += (random() - 0.5) * 0.2;
        simulateTick(p, cmd, world);
        const h = p.crouched ? PLAYER.crouchHeight : PLAYER.height;
        if (!canFit(world, p.x, p.y, p.z, h)) {
          throw new Error(`tick ${i}: giocatore dentro un blocco in (${p.x}, ${p.y}, ${p.z})`);
        }
        expect(p.x).toBeGreaterThan(minX);
        expect(p.x).toBeLessThan(maxX);
        expect(p.z).toBeGreaterThan(minZ);
        expect(p.z).toBeLessThan(maxZ);
        expect(p.y).toBeGreaterThan(map.killY);
      }
    });
  }
});
