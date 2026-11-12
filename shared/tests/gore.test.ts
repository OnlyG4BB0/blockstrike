import { describe, expect, it } from 'vitest';
import {
  COMBAT,
  Match,
  PART_HEAD,
  PART_TORSO,
  TICK_RATE,
  decideGore,
  goreRoll,
  type Combatant,
  type GoreDef,
  type KillEvent,
  type MapData,
} from '../src/index.ts';
import { gameContent, weaponIndex } from './content.ts';
import { FLOOR } from './helpers.ts';

const SECOND = TICK_RATE;

function testMap(): MapData {
  return {
    version: 1,
    name: 'test',
    killY: -20,
    spawns: [{ pos: [0, 0, 0], yaw: 0 }],
    blocks: [FLOOR],
    waypoints: [],
    sky: { top: '#000000', horizon: '#000000', bottom: '#000000' },
    fog: { color: '#000000', near: 1, far: 2 },
    sun: { direction: [0, -1, 0], color: '#ffffff', intensity: 1 },
    ambient: { sky: '#ffffff', ground: '#ffffff', intensity: 1 },
  };
}

function place(c: Combatant, x: number, z: number, yaw = 0): void {
  Object.assign(c.player, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, grounded: true });
  c.input.yaw = yaw;
  c.protection = 0;
}

function aimAt(c: Combatant, x: number, y: number, z: number): void {
  const dx = x - c.player.x;
  const dz = z - c.player.z;
  c.input.yaw = Math.atan2(-dx, -dz);
  c.input.pitch = Math.atan2(y - (c.player.y + 1.6), Math.hypot(dx, dz));
}

/** Spara una volta e restituisce le uccisioni di quel tick (copiate). */
function fire(match: Match, shooter: Combatant): KillEvent[] {
  shooter.input.fire = true;
  match.tick();
  shooter.input.fire = false;
  const kills: KillEvent[] = [];
  for (let i = 0; i < match.events.kills.count; i++) kills.push({ ...match.events.kills.get(i) });
  return kills;
}

function setup(weaponId: string, targets = 1): { match: Match; shooter: Combatant; victims: Combatant[] } {
  const match = new Match(testMap(), gameContent(), { seed: 11 });
  match.botMode = 'idle';
  const shooter = match.addCombatant('Tiratore', { weapon: weaponIndex(weaponId) });
  const victims: Combatant[] = [];
  for (let i = 0; i < targets; i++) victims.push(match.addCombatant(`Bersaglio ${i}`, { bot: true }));
  place(shooter, 0, 0);
  victims.forEach((v, i) => place(v, i * 3, -10, 0));
  // Estrazione dell'arma finita.
  for (let i = 0; i < SECOND; i++) match.tick();
  return { match, shooter, victims };
}

const SHOTGUN: GoreDef = { dismember: true, gibChance: 0.5, gibRange: 5 };
const RIFLE: GoreDef = { dismember: false, gibChance: 0, gibRange: 300 };
const KILL = { explosive: false, part: PART_HEAD, distance: 3 };

describe('decisione dello splatter', () => {
  it('con il gore spento il corpo svanisce, con il gore ridotto cade intero', () => {
    expect(decideGore({ ...KILL, explosive: true }, SHOTGUN, 'off', 0)).toBe('vanish');
    expect(decideGore({ ...KILL, explosive: true }, SHOTGUN, 'reduced', 0)).toBe('ragdoll');
    expect(decideGore(KILL, SHOTGUN, 'reduced', 0)).toBe('ragdoll');
  });

  it('razzi e granate fanno sempre a pezzi', () => {
    expect(decideGore({ explosive: true, part: -1, distance: 20 }, null, 'full', 0.99)).toBe('gib');
  });

  it('il fucile a pompa fa a pezzi solo da vicino e con la sua probabilità, altrimenti stacca la parte', () => {
    expect(decideGore(KILL, SHOTGUN, 'full', 0.2)).toBe('gib');
    expect(decideGore(KILL, SHOTGUN, 'full', 0.8)).toBe('dismember');
    expect(decideGore({ ...KILL, distance: 12 }, SHOTGUN, 'full', 0.1)).toBe('dismember');
  });

  it('si stacca solo testa o arto, e solo con le armi che lo prevedono', () => {
    expect(decideGore({ ...KILL, part: PART_TORSO }, SHOTGUN, 'full', 0.9)).toBe('ragdoll');
    expect(decideGore(KILL, RIFLE, 'full', 0)).toBe('ragdoll');
  });

  it('lo stesso colpo dà lo stesso esito su ogni client', () => {
    expect(goreRoll(4, 7)).toBe(goreRoll(4, 7));
    expect(goreRoll(4, 7)).not.toBe(goreRoll(4, 8));
    for (let i = 0; i < 100; i++) {
      const value = goreRoll(i, i * 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('eventi di morte per lo splatter', () => {
  it('il colpo alla testa riporta parte, punto, direzione e distanza', () => {
    const { match, shooter, victims } = setup('sniper');
    const victim = victims[0]!;
    shooter.input.ads = true;
    for (let i = 0; i < SECOND; i++) match.tick();
    aimAt(shooter, 0, victim.player.y + 1.63, victim.player.z);
    const [kill] = fire(match, shooter);
    expect(kill).toBeDefined();
    expect(kill!.part).toBe(PART_HEAD);
    expect(kill!.headshot).toBe(true);
    expect(kill!.explosive).toBe(false);
    expect(kill!.distance).toBeCloseTo(10, 1);
    // Direzione: verso -z, dal tiratore alla vittima.
    expect(kill!.dz).toBeLessThan(-0.99);
    expect(kill!.y).toBeGreaterThan(1.46);
  });

  it('le uccisioni con il razzo sono esplosive e senza parte', () => {
    const { match, shooter, victims } = setup('rocket_launcher');
    const victim = victims[0]!;
    victim.health = 1;
    aimAt(shooter, 0, 0.2, victim.player.z + 0.6);
    shooter.input.fire = true;
    match.tick();
    shooter.input.fire = false;
    let kill: KillEvent | null = null;
    for (let i = 0; i < SECOND * 2 && !kill; i++) {
      match.tick();
      if (match.events.kills.count > 0) kill = { ...match.events.kills.get(0) };
    }
    expect(kill).not.toBeNull();
    expect(kill!.explosive).toBe(true);
    expect(kill!.part).toBe(-1);
  });

  it('serie di uccisioni, doppietta e uccisione in aria', () => {
    const { match, shooter, victims } = setup('revolver', 3);
    const headshot = (victim: Combatant): KillEvent => {
      aimAt(shooter, victim.player.x, victim.player.y + 1.63, victim.player.z);
      const kills = fire(match, shooter);
      for (let i = 0; i < SECOND / 2; i++) match.tick();
      return kills[0]!;
    };
    const first = headshot(victims[0]!);
    expect(first.streak).toBe(1);
    expect(first.multi).toBe(1);
    const second = headshot(victims[1]!);
    expect(second.streak).toBe(2);
    expect(second.multi).toBe(2);
    // In aria: chi uccide sta saltando (bersaglio vicino, così la dispersione in aria non conta).
    const near = victims[2]!;
    place(near, 0, -3, 0);
    shooter.player.y = 2;
    shooter.player.grounded = false;
    const third = headshot(near);
    expect(third.killerAirborne).toBe(true);
    expect(third.streak).toBe(3);
    // Dopo la finestra delle uccisioni ravvicinate la doppietta riparte.
    for (let i = 0; i < SECOND * (COMBAT.multiKillWindow + 1); i++) match.tick();
    // Tutti sono rinati sull'unico punto di partenza, dove sta il tiratore: si spostano.
    const respawned = victims[0]!;
    place(respawned, 0, -10, 0);
    place(victims[1]!, 20, 20, 0);
    place(victims[2]!, -20, 20, 0);
    shooter.player.y = 0;
    shooter.player.grounded = true;
    const fourth = headshot(respawned);
    expect(fourth.multi).toBe(1);
    expect(fourth.streak).toBe(4);
  });

  it('morire azzera la serie di chi muore', () => {
    const { match, shooter, victims } = setup('revolver', 1);
    const victim = victims[0]!;
    victim.streak = 4;
    aimAt(shooter, 0, victim.player.y + 1.63, victim.player.z);
    fire(match, shooter);
    expect(victim.alive).toBe(false);
    expect(victim.streak).toBe(0);
  });
});
