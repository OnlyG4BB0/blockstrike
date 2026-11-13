/**
 * Rete senza socket: server e client si scambiano i byte attraverso una coda con ritardo, a tempo
 * finto. 150 ms di ping = 75 ms all'andata e 75 al ritorno.
 */
import { describe, expect, it } from 'vitest';
import {
  ByteReader,
  ByteWriter,
  ClientCore,
  MOVE,
  NET,
  PART_TORSO,
  PART_STRIDE,
  ServerCore,
  TICK_RATE,
  createInput,
  createSnapshot,
  readInput,
  readSnapshot,
  writeInput,
  writeSnapshot,
  type MapData,
  type PlayerInput,
} from '../src/index.ts';
import { gameContent, weaponIndex } from './content.ts';
import { FLOOR } from './helpers.ts';

const SECOND = TICK_RATE;
const TICK_MS = 1000 / TICK_RATE;

function testMap(): MapData {
  return {
    version: 1,
    name: 'test',
    killY: -20,
    spawns: [
      { pos: [0, 0, 0], yaw: 0 },
      { pos: [0, 0, -12], yaw: 180 },
    ],
    blocks: [FLOOR],
    waypoints: [],
    sky: { top: '#000000', horizon: '#000000', bottom: '#000000' },
    fog: { color: '#000000', near: 1, far: 2 },
    sun: { direction: [0, -1, 0], color: '#ffffff', intensity: 1 },
    ambient: { sky: '#ffffff', ground: '#ffffff', intensity: 1 },
  };
}

/** Coda di consegne a tempo finto. */
class FakeNetwork {
  time = 0;
  private readonly queue: { at: number; order: number; deliver: () => void }[] = [];
  private order = 0;

  send(delay: number, deliver: () => void): void {
    this.queue.push({ at: this.time + delay, order: this.order++, deliver });
  }

  advance(ms: number): void {
    this.time += ms;
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
    while (this.queue.length > 0 && this.queue[0]!.at <= this.time) this.queue.shift()!.deliver();
  }
}

type Script = (tick: number, client: ClientCore, input: PlayerInput) => void;

interface Session {
  id: string;
  client: ClientCore;
  script: Script;
  input: PlayerInput;
  /** Comandi in più per tick (per simulare un client che imbroglia). */
  flood: number;
  floodWriter: ByteWriter;
  floodSeq: number;
}

/** Server e client collegati da una rete con ritardo `oneWay` (ms) in ogni direzione. */
function world(oneWay: number, lagCompensation = true) {
  const content = gameContent();
  const map = testMap();
  const server = new ServerCore(map, content, { fillTo: 0, lagCompensation, seed: 3 });
  const net = new FakeNetwork();
  const sessions: Session[] = [];
  const add = (id: string, script: Script, flood = 0): Session => {
    const client = new ClientCore(map, content);
    client.now = () => net.time;
    const c = server.join(id, { name: id, classIndex: -1, skin: '' });
    client.welcome(c.id, server.tick, id, -1);
    client.setRoster(server.roster());
    const session = { id, client, script, input: createInput(), flood, floodWriter: new ByteWriter(), floodSeq: 0 };
    sessions.push(session);
    return session;
  };
  let tick = 0;
  const run = (ticks: number, each?: () => void) => {
    for (let i = 0; i < ticks; i++) {
      for (const s of sessions) {
        const input = s.input;
        Object.assign(input, createInput());
        s.script(tick, s.client, input);
        const bytes = s.client.tick(input);
        net.send(oneWay, () => server.receiveInput(s.id, bytes));
        // Comandi falsi in più, con numeri di sequenza nuovi.
        for (let k = 0; k < s.flood; k++) {
          s.floodWriter.reset();
          s.floodSeq += 1;
          writeInput(s.floodWriter, 1_000_000 + s.floodSeq, s.client.renderTick, input);
          const extra = s.floodWriter.finish();
          net.send(oneWay, () => server.receiveInput(s.id, extra));
        }
      }
      server.update();
      each?.();
      if (server.tick % NET.snapshotInterval === 0) {
        for (const s of sessions) {
          const snap = server.snapshot(s.id)!;
          net.send(oneWay, () => s.client.receive(snap));
        }
      }
      net.advance(TICK_MS);
      tick++;
    }
  };
  return { server, net, add, run };
}

/** Mira dal proprio giocatore al busto di un altro come lo si vede sullo schermo (interpolato). */
function aimAtTorso(client: ClientCore, targetId: number, input: PlayerInput): boolean {
  const me = client.local!;
  const target = client.match.getCombatant(targetId);
  if (!target || !target.alive) return false;
  const o = PART_TORSO * PART_STRIDE;
  const tx = target.pose.parts[o]!;
  const ty = target.pose.parts[o + 1]!;
  const tz = target.pose.parts[o + 2]!;
  const dx = tx - me.player.x;
  const dz = tz - me.player.z;
  input.yaw = Math.atan2(-dx, -dz);
  input.pitch = Math.atan2(ty - (me.player.y + 1.6), Math.hypot(dx, dz));
  return true;
}

describe('protocollo', () => {
  it('un comando arriva identico', () => {
    const input = { ...createInput(), yaw: 1.2345678901, pitch: -0.3, forward: 1, right: -1, jump: true, fire: true, weaponSlot: 2 };
    const w = new ByteWriter();
    writeInput(w, 42, 1234.5, input);
    const frame = readInput(new ByteReader(w.finish()), { seq: 0, viewTick: 0, input: createInput() });
    expect(frame.seq).toBe(42);
    expect(frame.viewTick).toBe(1234.5);
    expect(frame.input).toEqual(input);
  });

  it('lo stato del proprio giocatore arriva esatto, quello degli altri compatto', () => {
    const { server, add, run } = world(0);
    add('a', (tick, _c, input) => {
      input.forward = 1;
      input.right = tick % 30 < 15 ? 1 : -1;
      input.fire = tick % 9 === 0;
    });
    add('b', () => {});
    run(SECOND);
    const w = new ByteWriter();
    const a = server.combatantOf('a')!;
    writeSnapshot(w, server.tick, 7, a, server.match.combatants, server.match.projectiles, server.info, []);
    const snap = readSnapshot(new ByteReader(w.finish()), createSnapshot());
    expect(snap.tick).toBe(server.tick);
    expect(snap.ackSeq).toBe(7);
    expect(snap.local.player.x).toBe(a.player.x);
    expect(snap.local.player.vz).toBe(a.player.vz);
    expect(snap.local.weapon.seed).toBe(a.weapon.random.seed);
    expect(snap.local.weapon.ammo).toEqual(a.weapon.ammo);
    expect(snap.remoteCount).toBe(1);
    expect(snap.remotes[0]!.anim.x).toBeCloseTo(server.combatantOf('b')!.anim.x, 4);
  });
});

describe('predizione e riconciliazione con 150 ms di ping', () => {
  it('muovendosi, saltando e sparando la predizione non sbaglia mai', () => {
    const { add, run } = world(75);
    const a = add('a', (tick, _c, input) => {
      input.forward = tick % 120 < 90 ? 1 : 0;
      input.right = tick % 40 < 20 ? 1 : -1;
      input.jump = tick % 50 < 3;
      input.crouch = tick % 200 > 150;
      input.fire = tick % 20 < 2;
      input.yaw = Math.sin(tick / 40);
      input.pitch = Math.cos(tick / 55) * 0.3;
    });
    add('b', () => {});
    run(SECOND * 6);
    expect(a.client.stats.snapshots).toBeGreaterThan(150);
    expect(a.client.stats.mismatches).toBe(0);
  });

  it('una spinta decisa dal server si corregge con un solo pacchetto', () => {
    const { server, add, run } = world(75);
    const a = add('a', (_tick, _c, input) => {
      input.forward = 1;
    });
    run(SECOND);
    // Spinta che solo il server conosce (come un'esplosione).
    server.combatantOf('a')!.player.vx += 8;
    run(SECOND);
    expect(a.client.stats.mismatches).toBe(1);
    // Dopo la correzione client e server coincidono di nuovo.
    const predicted = a.client.local!.player;
    const actual = server.combatantOf('a')!.player;
    expect(Math.abs(predicted.x - actual.x)).toBeLessThan(MOVE.runSpeed);
  });
});

describe('compensazione del lag con 150 ms di ping', () => {
  /** Percentuale di colpi a segno su un bersaglio che si sposta di lato. */
  function hitRate(lagCompensation: boolean): { rate: number; rewind: number } {
    const { server, add, run } = world(75, lagCompensation);
    let targetId = -1;
    add('a', (tick, client, input) => {
      if (tick < SECOND) return;
      if (aimAtTorso(client, targetId, input)) input.fire = tick % 12 === 0;
    });
    const b = add('b', (tick, _c, input) => {
      input.right = Math.floor(tick / 35) % 2 === 0 ? 1 : -1;
    });
    targetId = b.client.local!.id;
    let shots = 0;
    let hits = 0;
    const shooter = server.combatantOf('a')!.id;
    const target = server.combatantOf('b')!;
    run(SECOND * 7, () => {
      target.health = 1e6;
      const e = server.match.events;
      for (let i = 0; i < e.shots.count; i++) if (e.shots.get(i).shooter === shooter) shots++;
      for (let i = 0; i < e.hits.count; i++) if (e.hits.get(i).attacker === shooter) hits++;
    });
    expect(shots).toBeGreaterThan(20);
    return { rate: hits / shots, rewind: server.stats.maxRewindTicks };
  }

  it('si colpisce chi si sposta di lato mirando dove lo si vede', () => {
    const withRewind = hitRate(true);
    const without = hitRate(false);
    expect(withRewind.rate).toBeGreaterThan(0.8);
    expect(without.rate).toBeLessThan(0.5);
    // Riavvolgimento circa pari a ping + interpolazione, entro il limite.
    expect(withRewind.rewind).toBeGreaterThan(NET.interpolationDelay + 6);
    expect(withRewind.rewind).toBeLessThanOrEqual(NET.interpolationDelay + NET.maxRewind);
  });

  it('un riavvolgimento oltre il limite viene tagliato', () => {
    const { server, net, add, run } = world(0);
    add('a', () => {});
    add('b', () => {});
    run(SECOND * 2);
    // Comando falso che dice di aver visto il mondo 100 tick fa, sparando.
    const w = new ByteWriter();
    const input = { ...createInput(), fire: true };
    writeInput(w, 999_999, server.tick - 100, input);
    server.receiveInput('a', w.finish());
    run(2);
    void net;
    expect(server.stats.clampedRewinds).toBeGreaterThanOrEqual(1);
    expect(server.stats.maxRewindTicks).toBeLessThanOrEqual(NET.interpolationDelay + NET.maxRewind);
  });
});

describe('controlli del server', () => {
  it('mandare più comandi del dovuto non fa correre più veloce', () => {
    const forward: Script = (_tick, _c, input) => {
      input.forward = 1;
    };
    const honest = world(30);
    honest.add('a', forward);
    honest.run(SECOND * 3);
    const cheater = world(30);
    cheater.add('a', forward, 3);
    cheater.run(SECOND * 3);
    const distance = (w: ReturnType<typeof world>) => {
      const p = w.server.combatantOf('a')!.player;
      return Math.hypot(p.x, p.z);
    };
    // Al massimo NET.inputBurst comandi in più rispetto al tempo passato.
    expect(distance(cheater)).toBeLessThan(distance(honest) + MOVE.runSpeed * ((NET.inputBurst + 2) / SECOND));
    expect(cheater.server.stats.droppedInputs).toBeGreaterThan(SECOND * 3);
  });

  it('premere il grilletto a raffica non supera la cadenza dell\'arma', () => {
    const { server, add, run } = world(30);
    add('a', (tick, _c, input) => {
      input.fire = tick % 2 === 0;
      input.weaponSlot = tick === 0 ? weaponIndex('pistol') + 1 : 0;
    });
    let shots = 0;
    const shooter = server.combatantOf('a')!.id;
    run(SECOND * 3, () => {
      const e = server.match.events;
      for (let i = 0; i < e.shots.count; i++) if (e.shots.get(i).shooter === shooter) shots++;
    });
    const pistol = gameContent().weapons[weaponIndex('pistol')]!;
    expect(shots).toBeGreaterThan(5);
    expect(shots).toBeLessThanOrEqual(Math.ceil((3 * pistol.fireRate) / 60) + 1);
  });
});
