/** Modalità online sul server: squadre, fuoco amico, punteggi, cattura la bandiera. */
import { describe, expect, it } from 'vitest';
import {
  ByteWriter,
  MATCH_RULES,
  ServerCore,
  TICK_RATE,
  createInput,
  writeInput,
  type MapData,
  type PlayerInput,
} from '../src/index.ts';
import { gameContent } from './content.ts';
import { FLOOR } from './helpers.ts';

const SECOND = TICK_RATE;

function teamMap(withFlags: boolean): MapData {
  return {
    version: 1,
    name: 'squadre',
    killY: -20,
    spawns: [
      { pos: [0, 0, 20], yaw: 0, team: 1 },
      { pos: [3, 0, 20], yaw: 0, team: 1 },
      { pos: [0, 0, -20], yaw: 180, team: 2 },
      { pos: [3, 0, -20], yaw: 180, team: 2 },
    ],
    blocks: [FLOOR],
    waypoints: [],
    flags: withFlags
      ? [
          { team: 1, pos: [0, 0, 22] },
          { team: 2, pos: [0, 0, -22] },
        ]
      : [],
    sky: { top: '#000000', horizon: '#000000', bottom: '#000000' },
    fog: { color: '#000000', near: 1, far: 2 },
    sun: { direction: [0, -1, 0], color: '#ffffff', intensity: 1 },
    ambient: { sky: '#ffffff', ground: '#ffffff', intensity: 1 },
  };
}

/** Server con giocatori comandati direttamente (senza rete). */
function server(mode: 'tdm' | 'ctf', players: string[]) {
  const core = new ServerCore(teamMap(mode === 'ctf'), gameContent(), { mode, fillTo: 0, seed: 4 });
  const seq = new Map<string, number>();
  const writer = new ByteWriter();
  for (const id of players) {
    core.join(id, { name: id, classIndex: 0, skin: '' });
    seq.set(id, 0);
  }
  /** Un tick con i comandi indicati (gli altri stanno fermi). */
  const step = (inputs: Record<string, Partial<PlayerInput>> = {}) => {
    for (const id of players) {
      const n = seq.get(id)! + 1;
      seq.set(id, n);
      writer.reset();
      writeInput(writer, n, core.tick, { ...createInput(), ...inputs[id] });
      core.receiveInput(id, writer.finish());
    }
    core.update();
  };
  return { core, step };
}

describe('modalità a squadre', () => {
  it('le squadre sono equilibrate e si nasce dalla propria parte', () => {
    const { core, step } = server('tdm', ['a', 'b', 'c', 'd']);
    step();
    const teams = ['a', 'b', 'c', 'd'].map((id) => core.combatantOf(id)!.team);
    expect(teams.filter((t) => t === 1)).toHaveLength(2);
    expect(teams.filter((t) => t === 2)).toHaveLength(2);
    for (const id of ['a', 'b', 'c', 'd']) {
      const c = core.combatantOf(id)!;
      c.alive = false;
      c.respawnTimer = 0;
    }
    step();
    for (const id of ['a', 'b', 'c', 'd']) {
      const c = core.combatantOf(id)!;
      // Rossi a z = 20, blu a z = -20.
      expect(Math.sign(c.player.z)).toBe(c.team === 1 ? 1 : -1);
    }
  });

  it('niente fuoco amico; uccidere un nemico dà un punto alla squadra', () => {
    const { core, step } = server('tdm', ['a', 'b', 'c', 'd']);
    step();
    const shooter = core.combatantOf('a')!;
    const mate = ['b', 'c', 'd'].map((id) => core.combatantOf(id)!).find((c) => c.team === shooter.team)!;
    const enemy = ['b', 'c', 'd'].map((id) => core.combatantOf(id)!).find((c) => c.team !== shooter.team)!;
    for (const c of [shooter, mate, enemy]) c.protection = 0;
    // Compagno davanti, a 5 m: il colpo lo attraversa senza ferirlo.
    Object.assign(shooter.player, { x: 0, y: 0, z: 0, yaw: 0 });
    Object.assign(mate.player, { x: 0, y: 0, z: -5 });
    Object.assign(enemy.player, { x: 30, y: 0, z: 30 });
    const shooterId = 'a';
    step({ [shooterId]: { yaw: 0, pitch: Math.atan2(1.2 - 1.6, 5), fire: true } });
    expect(mate.health).toBe(mate.maxHealth);
    // Il nemico invece sì.
    Object.assign(enemy.player, { x: 0, y: 0, z: -5 });
    Object.assign(mate.player, { x: 30, y: 0, z: 30 });
    enemy.health = 1;
    for (let i = 0; i < SECOND; i++) step({ [shooterId]: { yaw: 0, pitch: Math.atan2(1.2 - 1.6, 5), fire: i % 20 === 0 } });
    expect(enemy.alive).toBe(false);
    expect(shooter.team === 1 ? core.info.scoreA : core.info.scoreB).toBe(1);
  });
});

describe('cattura la bandiera', () => {
  it('prendere, perdere, riportare e catturare la bandiera', () => {
    const { core, step } = server('ctf', ['a', 'b']);
    step();
    const a = core.combatantOf('a')!;
    const b = core.combatantOf('b')!;
    expect(a.team).not.toBe(b.team);
    expect(core.info.flags).toHaveLength(2);
    const enemyFlagZ = a.team === 1 ? -22 : 22;
    const ownFlagZ = -enemyFlagZ;
    // A va sulla bandiera nemica: la prende.
    Object.assign(a.player, { x: 0, y: 0, z: enemyFlagZ });
    step();
    const enemyFlag = core.info.flags.find((f) => f.carrier === a.id);
    expect(enemyFlag?.state).toBe(1);
    // A muore: la bandiera cade a terra.
    a.health = 0;
    a.alive = false;
    a.respawnTimer = 100;
    step();
    expect(core.info.flags.some((f) => f.state === 2)).toBe(true);
    // B (della squadra della bandiera) la tocca: torna alla base.
    const dropped = core.info.flags.find((f) => f.state === 2)!;
    Object.assign(b.player, { x: dropped.x, y: 0, z: dropped.z });
    step();
    expect(core.info.flags.every((f) => f.state === 0)).toBe(true);
    // A rinasce, riprende la bandiera e la porta alla propria base: cattura.
    a.alive = true;
    a.health = a.maxHealth;
    Object.assign(b.player, { x: 40, y: 0, z: 0 });
    Object.assign(a.player, { x: 0, y: 0, z: enemyFlagZ });
    step();
    Object.assign(a.player, { x: 0, y: 0, z: ownFlagZ });
    step();
    expect(a.team === 1 ? core.info.scoreA : core.info.scoreB).toBe(1);
    expect(core.info.flags.every((f) => f.state === 0)).toBe(true);
  });

  it('una bandiera a terra torna da sola alla base', () => {
    const { core, step } = server('ctf', ['a', 'b']);
    step();
    const a = core.combatantOf('a')!;
    Object.assign(a.player, { x: 0, y: 0, z: a.team === 1 ? -22 : 22 });
    step();
    a.alive = false;
    a.respawnTimer = 1000;
    step();
    expect(core.info.flags.some((f) => f.state === 2)).toBe(true);
    for (let i = 0; i < SECOND * (MATCH_RULES.flagReturnTime + 1); i++) step();
    expect(core.info.flags.every((f) => f.state === 0)).toBe(true);
  });

  it('senza basi nella mappa si gioca a squadre', () => {
    const core = new ServerCore(teamMap(false), gameContent(), { mode: 'ctf', fillTo: 0 });
    expect(core.mode).toBe('tdm');
  });
});
