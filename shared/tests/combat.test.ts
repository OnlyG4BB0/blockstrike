import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BODY_STANDING,
  COMBAT,
  CollisionWorld,
  KILLED_BY_GRENADE,
  Match,
  SHOT_BODY,
  TICK_RATE,
  buildNavGraph,
  createBodyHit,
  createPlayerState,
  createRayHit,
  currentSpread,
  damageFalloff,
  isConnected,
  parseMap,
  raycastBody,
  raycastWorld,
  type Combatant,
  type MapBlock,
  type MapData,
} from '../src/index.ts';
import { gameContent, weaponIndex } from './content.ts';
import { FLOOR, box, ramp } from './helpers.ts';

const SECOND = TICK_RATE;
const CONTENT = gameContent();
const WEAPONS = CONTENT.weapons;
const GRENADE = CONTENT.grenade;
const AR = weaponIndex('assault_rifle');
const SNIPER = weaponIndex('sniper');
const SHOTGUN = weaponIndex('shotgun');
const PISTOL = weaponIndex('pistol');
const ROCKET = weaponIndex('rocket_launcher');
/** Tasto numerico che seleziona un'arma. */
const slot = (index: number) => index + 1;

function testMap(...blocks: MapBlock[]): MapData {
  return {
    version: 1,
    name: 'test',
    killY: -20,
    spawns: [{ pos: [0, 0, 0], yaw: 0 }],
    blocks: [FLOOR, ...blocks],
    waypoints: [],
    sky: { top: '#000000', horizon: '#000000', bottom: '#000000' },
    fog: { color: '#000000', near: 1, far: 2 },
    sun: { direction: [0, -1, 0], color: '#ffffff', intensity: 1 },
    ambient: { sky: '#ffffff', ground: '#ffffff', intensity: 1 },
  };
}

function loadArena(): MapData {
  const url = new URL('../../content/maps/arena-prova.json', import.meta.url);
  return parseMap(JSON.parse(readFileSync(url, 'utf8')), 'arena-prova.json');
}

/** Partita con un tiratore (giocatore) e un bersaglio (bot fermo), senza invulnerabilità. */
function duel(map: MapData = testMap()): { match: Match; shooter: Combatant; target: Combatant } {
  const match = new Match(map, CONTENT, { seed: 7 });
  match.botMode = 'idle';
  const shooter = match.addCombatant('Tiratore');
  const target = match.addCombatant('Bersaglio', { bot: true });
  place(shooter, 0, 0, 0);
  place(target, 0, 0, -10);
  return { match, shooter, target };
}

function place(c: Combatant, x: number, y: number, z: number, yaw = 0): void {
  Object.assign(c.player, { x, y, z, vx: 0, vy: 0, vz: 0, yaw, grounded: true });
  c.input.yaw = yaw;
  c.protection = 0;
}

/** Punta il tiratore verso un punto del mondo. */
function aimAt(c: Combatant, x: number, y: number, z: number): void {
  const eyeY = c.player.y + (c.player.crouched ? 1 : 1.6);
  const dx = x - c.player.x;
  const dz = z - c.player.z;
  c.input.yaw = Math.atan2(-dx, -dz);
  c.input.pitch = Math.atan2(y - eyeY, Math.hypot(dx, dz));
}

function headOf(c: Combatant): [number, number, number] {
  return [c.player.x, c.player.y + 1.63, c.player.z];
}

function chestOf(c: Combatant): [number, number, number] {
  return [c.player.x, c.player.y + 1.2, c.player.z];
}

function ticks(match: Match, count: number, each?: () => void): void {
  for (let i = 0; i < count; i++) {
    each?.();
    match.tick();
  }
}

/**
 * Spara un colpo singolo, poi aspetta che arma e rinculo siano pronti (2 s: più della cadenza
 * del cecchino). Restituisce gli eventi di colpo del tick in cui si è sparato.
 */
function singleShot(match: Match, shooter: Combatant): { damage: number; head: boolean; killed: boolean }[] {
  shooter.input.fire = true;
  match.tick();
  const hits = [];
  for (let i = 0; i < match.events.hits.count; i++) {
    const hit = match.events.hits.get(i);
    hits.push({ damage: hit.damage, head: hit.headshot, killed: hit.killed });
  }
  shooter.input.fire = false;
  ticks(match, SECOND * 2);
  return hits;
}

describe('raggi contro la mappa', () => {
  it('colpisce la faccia di un blocco con la normale giusta', () => {
    const world = CollisionWorld.fromBlocks([box([5, 0, -5], [2, 4, 10])]);
    const hit = raycastWorld(world, 0, 1, 0, 1, 0, 0, 100, createRayHit());
    expect(hit.hit).toBe(true);
    expect(hit.t).toBeCloseTo(5, 9);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([-1, 0, 0]);
  });

  it('colpisce la superficie inclinata di una rampa', () => {
    // Rampa che sale verso +x da quota 0 a 4 in 4 m: superficie a 45°.
    const world = CollisionWorld.fromBlocks([ramp([0, 0, -5], [4, 4, 10], '+x')]);
    const hit = raycastWorld(world, 2, 10, 0, 0, -1, 0, 100, createRayHit());
    expect(hit.hit).toBe(true);
    expect(hit.y).toBeCloseTo(2, 9);
    expect(hit.nx).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(hit.ny).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('passa sopra la parte bassa di una rampa', () => {
    const world = CollisionWorld.fromBlocks([ramp([0, 0, -5], [4, 4, 10], '+x')]);
    // A x = 1 la rampa è alta 1 m: un raggio orizzontale a quota 1,5 deve passare oltre fino al retro.
    const hit = raycastWorld(world, -2, 1.5, 0, 1, 0, 0, 100, createRayHit());
    expect(hit.hit).toBe(true);
    expect(hit.x).toBeCloseTo(1.5, 9);
  });
});

describe('hitbox', () => {
  const p = createPlayerState();
  const hit = createBodyHit();

  it('riconosce testa, busto, braccia e gambe', () => {
    expect(raycastBody(p, 0, 1.63, 5, 0, 0, -1, 100, hit).region).toBe('head');
    expect(raycastBody(p, 0, 1.2, 5, 0, 0, -1, 100, hit).region).toBe('torso');
    expect(raycastBody(p, 0.34, 1.2, 5, 0, 0, -1, 100, hit).region).toBe('arm');
    expect(raycastBody(p, 0.1, 0.4, 5, 0, 0, -1, 100, hit).region).toBe('leg');
    expect(raycastBody(p, 0, 1.9, 5, 0, 0, -1, 100, hit).hit).toBe(false);
    expect(raycastBody(p, 0.6, 1.2, 5, 0, 0, -1, 100, hit).hit).toBe(false);
  });

  it('ruota con lo sguardo: di fianco il braccio copre il busto', () => {
    const side = createPlayerState();
    // Guarda verso +x: il braccio destro sta dalla parte di +z. Visto da +z il giocatore
    // mostra il fianco, e a quota busto si colpisce prima il braccio.
    side.yaw = -Math.PI / 2;
    expect(raycastBody(side, 0, 1.2, 5, 0, 0, -1, 100, hit).region).toBe('arm');
  });

  it('da accovacciati la testa è più in basso', () => {
    const crouched = createPlayerState();
    crouched.crouched = true;
    expect(raycastBody(crouched, 0, 1.0, 5, 0, 0, -1, 100, hit).region).toBe('head');
    expect(raycastBody(crouched, 0, 1.63, 5, 0, 0, -1, 100, hit).hit).toBe(false);
  });

  it('le parti del corpo sono dentro il box di collisione in altezza', () => {
    for (const part of BODY_STANDING) {
      expect(part.min[1]).toBeGreaterThanOrEqual(0);
      expect(part.max[1]).toBeLessThanOrEqual(1.81);
    }
  });
});

describe('armi istantanee', () => {
  it('il fucile d\'assalto uccide con 2 colpi alla testa', () => {
    const { match, shooter, target } = duel();
    match.tick();
    aimAt(shooter, ...headOf(target));
    const first = singleShot(match, shooter);
    expect(first).toHaveLength(1);
    expect(first[0]!.head).toBe(true);
    expect(first[0]!.damage).toBeCloseTo(24 * 2.1, 6);
    expect(target.alive).toBe(true);
    aimAt(shooter, ...headOf(target));
    const second = singleShot(match, shooter);
    expect(second[0]!.killed).toBe(true);
    expect(target.alive).toBe(false);
    expect(shooter.kills).toBe(1);
  });

  it('il fucile d\'assalto uccide con 5 colpi al busto, non con 4', () => {
    const { match, shooter, target } = duel();
    match.tick();
    for (let i = 0; i < 4; i++) {
      aimAt(shooter, ...chestOf(target));
      expect(singleShot(match, shooter)[0]!.head).toBe(false);
    }
    expect(target.alive).toBe(true);
    expect(target.health).toBeCloseTo(100 - 4 * 24, 6);
    aimAt(shooter, ...chestOf(target));
    singleShot(match, shooter);
    expect(target.alive).toBe(false);
  });

  it('il danno cala con la distanza', () => {
    const def = WEAPONS[AR]!;
    expect(damageFalloff(def, 10)).toBe(1);
    expect(damageFalloff(def, 80)).toBe(0.6);
    expect(damageFalloff(def, 42.5)).toBeCloseTo(0.8, 9);
    expect(damageFalloff(WEAPONS[SNIPER]!, 250)).toBe(1);
  });

  it('il cecchino uccide con un colpo al busto, non a una gamba', () => {
    const { match, shooter, target } = duel();
    shooter.input.weaponSlot = slot(SNIPER);
    ticks(match, SECOND);
    shooter.input.weaponSlot = 0;
    shooter.input.ads = true;
    ticks(match, SECOND);
    aimAt(shooter, target.player.x + 0.1, target.player.y + 0.4, target.player.z);
    expect(singleShot(match, shooter)[0]!.killed).toBe(false);
    aimAt(shooter, ...chestOf(target));
    expect(singleShot(match, shooter)[0]!.killed).toBe(true);
  });

  it('il fucile a pompa uccide da vicino e fa poco danno da lontano', () => {
    const near = duel();
    place(near.target, 0, 0, -3);
    near.shooter.input.weaponSlot = slot(SHOTGUN);
    ticks(near.match, SECOND);
    aimAt(near.shooter, ...chestOf(near.target));
    const close = singleShot(near.match, near.shooter);
    expect(close).toHaveLength(1);
    expect(close[0]!.killed).toBe(true);

    const far = duel();
    place(far.target, 0, 0, -25);
    far.shooter.input.weaponSlot = slot(SHOTGUN);
    ticks(far.match, SECOND);
    aimAt(far.shooter, ...chestOf(far.target));
    const distant = singleShot(far.match, far.shooter);
    const total = distant.reduce((sum, hit) => sum + hit.damage, 0);
    expect(total).toBeLessThan(40);
  });

  it('cadenza: automatico tenendo premuto, semiautomatico solo a ogni pressione', () => {
    const { match, shooter } = duel();
    place(match.combatants[1]!, 50, 0, 50);
    match.tick();
    let shots = 0;
    shooter.input.fire = true;
    ticks(match, SECOND, () => (shots += match.events.shots.count));
    shots += match.events.shots.count;
    // 600 colpi/min = 10 al secondo (il primo parte subito).
    expect(shots).toBe(10);

    shooter.input.fire = false;
    shooter.input.weaponSlot = slot(PISTOL);
    ticks(match, SECOND);
    shooter.input.weaponSlot = 0;
    shots = 0;
    shooter.input.fire = true;
    ticks(match, SECOND, () => (shots += match.events.shots.count));
    shots += match.events.shots.count;
    expect(shots).toBe(1);
  });

  it('caricatore, ricarica automatica e niente colpi durante la ricarica', () => {
    const { match, shooter } = duel();
    place(match.combatants[1]!, 50, 0, 50);
    shooter.input.fire = true;
    let shots = 0;
    ticks(match, SECOND * 4, () => (shots += match.events.shots.count));
    // 30 colpi in 3 s, poi 1,9 s di ricarica: nel quarto secondo nessun colpo dopo il trentesimo.
    expect(shots).toBe(30);
    shooter.input.fire = false;
    ticks(match, SECOND * 2);
    expect(shooter.weapon.ammo[AR]).toBe(WEAPONS[AR]!.magazine);
  });

  it('cambiare arma richiede il tempo di estrazione', () => {
    const { match, shooter } = duel();
    place(match.combatants[1]!, 50, 0, 50);
    shooter.input.weaponSlot = slot(ROCKET);
    shooter.input.fire = true;
    let shots = 0;
    ticks(match, Math.floor(WEAPONS[ROCKET]!.drawTime * SECOND) - 1, () => (shots += match.events.shots.count));
    expect(shooter.weapon.current).toBe(ROCKET);
    expect(shots).toBe(0);
  });

  it('dispersione: più ampia in movimento e in aria, ridotta mirando, cresce sparando', () => {
    const { match, shooter } = duel();
    place(match.combatants[1]!, 50, 0, 50);
    match.tick();
    const still = currentSpread(shooter, WEAPONS[AR]!);
    shooter.player.vx = 7.5;
    const moving = currentSpread(shooter, WEAPONS[AR]!);
    shooter.player.grounded = false;
    const air = currentSpread(shooter, WEAPONS[AR]!);
    shooter.player.vx = 0;
    shooter.player.grounded = true;
    expect(moving).toBeGreaterThan(still);
    expect(air).toBeGreaterThan(moving);

    shooter.input.ads = true;
    ticks(match, SECOND);
    expect(currentSpread(shooter, WEAPONS[AR]!)).toBeLessThan(still * 0.5);
    shooter.input.ads = false;
    ticks(match, SECOND);

    // Mezzo secondo di raffica: 5 colpi da 0,4° di dispersione accumulata.
    shooter.input.fire = true;
    ticks(match, 30);
    expect(currentSpread(shooter, WEAPONS[AR]!)).toBeCloseTo(still + 5 * WEAPONS[AR]!.spread.perShot, 6);
  });

  it('il rinculo alza la mira sparando e poi torna a zero', () => {
    const { match, shooter } = duel();
    place(match.combatants[1]!, 50, 0, 50);
    shooter.input.fire = true;
    ticks(match, 30);
    expect(shooter.weapon.recoilPitch).toBeGreaterThan(0.02);
    shooter.input.fire = false;
    ticks(match, SECOND * 2);
    expect(shooter.weapon.recoilPitch).toBeLessThan(0.001);
  });

  it('l\'invulnerabilità dopo la rinascita blocca i danni e finisce sparando', () => {
    const { match, shooter, target } = duel();
    target.protection = COMBAT.spawnProtection;
    aimAt(shooter, ...headOf(target));
    singleShot(match, shooter);
    expect(target.health).toBe(100);
    expect(shooter.protection).toBe(0);
  });

  it('chi muore rinasce dopo il tempo previsto, con vita e munizioni piene', () => {
    const { match, shooter, target } = duel();
    aimAt(shooter, ...headOf(target));
    singleShot(match, shooter);
    aimAt(shooter, ...headOf(target));
    singleShot(match, shooter);
    expect(target.alive).toBe(false);
    expect(target.deaths).toBe(1);
    ticks(match, Math.ceil(COMBAT.respawnTime * SECOND));
    expect(target.alive).toBe(true);
    expect(target.health).toBe(COMBAT.maxHealth);
  });
});

describe('razzi e granate', () => {
  it('un razzo diretto uccide', () => {
    const { match, shooter, target } = duel();
    shooter.input.weaponSlot = slot(ROCKET);
    ticks(match, SECOND);
    aimAt(shooter, ...chestOf(target));
    shooter.input.fire = true;
    match.tick();
    shooter.input.fire = false;
    ticks(match, SECOND);
    expect(target.alive).toBe(false);
  });

  it('salto con il razzo: sparare ai piedi spinge in alto e toglie meno di metà vita', () => {
    const { match, shooter } = duel();
    place(match.combatants[1]!, 50, 0, 50);
    shooter.input.weaponSlot = slot(ROCKET);
    ticks(match, SECOND);
    shooter.input.pitch = -Math.PI / 2 + 0.05;
    shooter.input.fire = true;
    let maxY = 0;
    ticks(match, SECOND * 2, () => (maxY = Math.max(maxY, shooter.player.y)));
    expect(maxY).toBeGreaterThan(1.5);
    expect(shooter.alive).toBe(true);
    expect(shooter.health).toBeGreaterThan(50);
  });

  it('la granata rimbalza, esplode dopo la miccia e danneggia chi è vicino', () => {
    const { match, shooter, target } = duel();
    place(target, 0, 0, -2.5);
    // Lanciata verso i propri piedi: rimbalza sul posto.
    shooter.input.pitch = -Math.PI / 2 + 0.01;
    shooter.input.grenade = true;
    let explosions = 0;
    let bounces = 0;
    let explodedAt = -1;
    let targetDamage = 0;
    for (let i = 0; i < SECOND * 3; i++) {
      match.tick();
      if (match.events.explosions.count > 0) explodedAt = i;
      explosions += match.events.explosions.count;
      for (let a = 0; a < match.events.actions.count; a++) {
        if (match.events.actions.get(a).type === 'bounce') bounces++;
      }
      for (let h = 0; h < match.events.hits.count; h++) {
        const hit = match.events.hits.get(h);
        if (hit.target === target.id) targetDamage += hit.damage;
      }
    }
    expect(explosions).toBe(1);
    expect(bounces).toBeGreaterThan(0);
    expect(explodedAt / SECOND).toBeCloseTo(GRENADE.projectile.fuse, 1);
    expect(shooter.weapon.grenades).toBe(GRENADE.count - 1);
    expect(targetDamage).toBeGreaterThan(40);
    // Chi lancia una granata ai propri piedi ne subisce il danno pieno.
    expect(shooter.alive).toBe(false);
    expect(shooter.killedByWeapon).toBe(KILLED_BY_GRENADE);
  });

  it('un muro tra esplosione e bersaglio blocca il danno', () => {
    // Muro alto tra il tiratore e il bersaglio; il razzo colpisce il muro.
    const { match, shooter, target } = duel(testMap(box([-5, 0, -6], [10, 6, 0.5])));
    place(target, 0, 0, -7.5);
    shooter.input.weaponSlot = slot(ROCKET);
    ticks(match, SECOND);
    aimAt(shooter, 0, 1.2, -6);
    shooter.input.fire = true;
    match.tick();
    shooter.input.fire = false;
    ticks(match, SECOND);
    expect(target.health).toBe(100);
  });
});

describe('bot', () => {
  it('i punti di navigazione dell\'arena sono tutti collegati', () => {
    const arena = loadArena();
    const graph = buildNavGraph(CollisionWorld.fromBlocks(arena.blocks), arena.waypoints);
    expect(graph.nodes.length).toBeGreaterThan(10);
    for (const links of graph.links) expect(links.length).toBeGreaterThan(0);
    expect(isConnected(graph)).toBe(true);
  });

  it('un bot trova e uccide un giocatore fermo', () => {
    const match = new Match(testMap(), CONTENT, { seed: 3 });
    const human = match.addCombatant('Umano');
    const bot = match.addCombatant('Bot', { bot: true, weapon: AR });
    place(human, 0, 0, 0);
    place(bot, 0, 0, -20, Math.PI);
    let killedBy = -1;
    for (let i = 0; i < SECOND * 15 && killedBy < 0; i++) {
      human.protection = 0;
      match.tick();
      for (let k = 0; k < match.events.kills.count; k++) {
        const kill = match.events.kills.get(k);
        if (kill.victim === human.id) killedBy = kill.killer;
      }
    }
    expect(killedBy).toBe(bot.id);
  });

  it('i bot girano per l\'arena senza bloccarsi', () => {
    const match = new Match(loadArena(), CONTENT, { seed: 11 });
    match.botMode = 'roam';
    match.setBotCount(3);
    const travelled = match.combatants.map(() => 0);
    for (let i = 0; i < SECOND * 30; i++) {
      const before = match.combatants.map((c) => [c.player.x, c.player.z] as const);
      match.tick();
      match.combatants.forEach((c, j) => {
        travelled[j]! += Math.hypot(c.player.x - before[j]![0], c.player.z - before[j]![1]);
      });
    }
    for (const distance of travelled) expect(distance).toBeGreaterThan(80);
  });

  it('partita con bot che combattono: stessi semi, stesso identico risultato', () => {
    const simulate = () => {
      const match = new Match(loadArena(), CONTENT, { seed: 99 });
      match.setBotCount(5);
      let shots = 0;
      let kills = 0;
      for (let i = 0; i < SECOND * 40; i++) {
        match.tick();
        shots += match.events.shots.count;
        kills += match.events.kills.count;
      }
      return {
        shots,
        kills,
        states: match.combatants.map((c) => ({ ...c.player, health: c.health, alive: c.alive, k: c.kills })),
      };
    };
    const a = simulate();
    const b = simulate();
    expect(a).toEqual(b);
    expect(a.shots).toBeGreaterThan(20);
    expect(a.kills).toBeGreaterThan(0);
  });

  it('i colpi dei bot registrano corpo e mondo', () => {
    const match = new Match(loadArena(), CONTENT, { seed: 5 });
    match.setBotCount(4);
    let bodyHits = 0;
    for (let i = 0; i < SECOND * 30; i++) {
      match.tick();
      for (let s = 0; s < match.events.shots.count; s++) {
        const shot = match.events.shots.get(s);
        for (let pellet = 0; pellet < shot.pellets; pellet++) if (shot.results[pellet] === SHOT_BODY) bodyHits++;
      }
    }
    expect(bodyHits).toBeGreaterThan(5);
  });
});

describe('dati delle armi', () => {
  it('ogni arma ha valori sensati', () => {
    for (const def of WEAPONS) {
      // Caricatore 0 solo per le armi corpo a corpo (munizioni infinite).
      if (def.kind === 'melee') expect(def.magazine).toBe(0);
      else expect(def.magazine).toBeGreaterThan(0);
      expect(def.fireRate).toBeGreaterThan(0);
      expect(def.recoil.pattern.length).toBeGreaterThan(0);
      expect(def.pellets).toBeGreaterThan(0);
      if (def.kind === 'projectile') expect(def.projectile).toBeDefined();
    }
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
    expect(WEAPONS[PISTOL]!.auto).toBe(false);
    expect(WEAPONS[SHOTGUN]!.pellets).toBeGreaterThan(1);
  });
});
