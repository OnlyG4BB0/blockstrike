import { describe, expect, it } from 'vitest';
import {
  ContentError,
  MOVE,
  Match,
  TICK_RATE,
  horizontalSpeed,
  loadContent,
  type Combatant,
  type ContentSources,
  type MapData,
} from '../src/index.ts';
import { gameContent, readSources, weaponIndex } from './content.ts';
import { FLOOR, box } from './helpers.ts';

const SECOND = TICK_RATE;

function testMap(...extra: MapData['blocks']): MapData {
  return {
    version: 1,
    name: 'test',
    killY: -20,
    spawns: [{ pos: [0, 0, 0], yaw: 0 }],
    blocks: [FLOOR, ...extra],
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

/** Tiratore in (0, 0) che impugna l'arma indicata, bersaglio fermo davanti. */
function setup(weaponId: string, targetZ = -10, map = testMap()) {
  const match = new Match(map, gameContent(), { seed: 5 });
  match.botMode = 'idle';
  const shooter = match.addCombatant('Tiratore', { weapon: weaponIndex(weaponId) });
  const target = match.addCombatant('Bersaglio', { bot: true });
  place(shooter, 0, 0);
  place(target, 0, targetZ);
  for (let i = 0; i < SECOND; i++) match.tick();
  return { match, shooter, target };
}

/** Spara un colpo (una pressione) e restituisce i danni inflitti in quel tick. */
function pull(match: Match, shooter: Combatant): number[] {
  shooter.input.fire = true;
  match.tick();
  shooter.input.fire = false;
  const damage: number[] = [];
  for (let i = 0; i < match.events.hits.count; i++) damage.push(match.events.hits.get(i).damage);
  for (let i = 0; i < SECOND; i++) match.tick();
  return damage;
}

/** Copia profonda di un file JSON, da modificare nei test. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sourcesWith(change: (sources: ContentSources) => void): ContentSources {
  const sources = clone(readSources());
  change(sources);
  return sources;
}

function problemsOf(sources: ContentSources): string[] {
  try {
    loadContent(sources);
  } catch (error) {
    if (error instanceof ContentError) return [...error.problems];
    throw error;
  }
  return [];
}

describe('contenuti in /content', () => {
  it('sono tutti validi e collegati tra loro', () => {
    const content = gameContent();
    expect(content.weapons.map((w) => w.id)).toEqual([
      'assault_rifle',
      'smg',
      'lmg',
      'shotgun',
      'sniper',
      'pistol',
      'revolver',
      'rocket_launcher',
      'knife',
    ]);
    for (const weapon of content.weapons) {
      expect(content.models.has(weapon.model)).toBe(true);
      expect(content.sounds.has(weapon.sounds.fire)).toBe(true);
    }
    expect(content.grenade.count).toBeGreaterThan(0);
    expect(content.skins.length).toBeGreaterThan(0);
  });
});

describe('aggiungere un\'arma', () => {
  it('un nuovo file JSON compare tra le armi, nella posizione indicata, e funziona in partita', () => {
    const sources = sourcesWith((s) => {
      const pistol = clone(s.weapons.find((f) => f.path.endsWith('/pistol.json'))!.data) as Record<string, unknown>;
      pistol.id = 'pistola_prova';
      pistol.name = 'Pistola di prova';
      pistol.order = 6.5;
      pistol.damage = 40;
      s.weapons = [...s.weapons, { path: 'content/weapons/pistola_prova.json', data: pistol }];
    });
    const content = loadContent(sources);
    const ids = content.weapons.map((w) => w.id);
    expect(ids).toHaveLength(10);
    expect(ids.indexOf('pistola_prova')).toBe(ids.indexOf('pistol') + 1);

    const match = new Match(testMap(), content, { seed: 1 });
    match.botMode = 'idle';
    const shooter = match.addCombatant('Tiratore');
    const target = match.addCombatant('Bersaglio', { bot: true });
    place(shooter, 0, 0);
    place(target, 0, -8);
    shooter.input.weaponSlot = ids.indexOf('pistola_prova') + 1;
    for (let i = 0; i < SECOND; i++) match.tick();
    shooter.input.weaponSlot = 0;
    aimAt(shooter, 0, 1.2, -8);
    expect(pull(match, shooter)).toEqual([40]);
  });
});

describe('errori nei file', () => {
  it('un campo sbagliato indica file e campo', () => {
    const problems = problemsOf(
      sourcesWith((s) => {
        (s.weapons.find((f) => f.path.endsWith('/smg.json'))!.data as Record<string, unknown>).fireRate = 'veloce';
      }),
    );
    expect(problems).toEqual(['content/weapons/smg.json: "fireRate" deve essere un numero']);
  });

  it('raccoglie tutti i problemi, da più file, invece di fermarsi al primo', () => {
    const problems = problemsOf(
      sourcesWith((s) => {
        (s.weapons.find((f) => f.path.endsWith('/lmg.json'))!.data as Record<string, unknown>).model = 'non_esiste';
        const spread = (s.weapons.find((f) => f.path.endsWith('/smg.json'))!.data as Record<string, Record<string, unknown>>).spread!;
        spread.base = -1;
        (s.skins.find((f) => f.path.endsWith('/pistol_oro.json'))!.data as Record<string, Record<string, unknown>>).colors!.canna = '#ff0000';
      }),
    );
    expect(problems).toHaveLength(3);
    expect(problems.some((p) => p.includes('content/weapons/smg.json: "spread.base" deve essere almeno 0'))).toBe(true);
    expect(problems.some((p) => p.includes('lmg.json: "model" indica il modello "non_esiste"'))).toBe(true);
    expect(problems.some((p) => p.includes('pistol_oro.json: "colors.canna" non è una parte del modello "pistol"'))).toBe(true);
  });

  it('segnala id duplicati, suoni mancanti e arma senza tipo', () => {
    const problems = problemsOf(
      sourcesWith((s) => {
        const copy = clone(s.weapons[0]!);
        s.weapons = [...s.weapons, { ...copy, path: 'content/weapons/doppione.json' }];
        (s.weapons.find((f) => f.path.endsWith('/revolver.json'))!.data as Record<string, Record<string, unknown>>).sounds!.fire = 'bang';
        delete (s.weapons.find((f) => f.path.endsWith('/pistol.json'))!.data as Record<string, unknown>).type;
      }),
    );
    expect(problems.some((p) => p.startsWith('content/weapons/doppione.json: "id" "assault_rifle" è già usato'))).toBe(true);
    expect(problems.some((p) => p.includes('revolver.json: "sounds.fire" indica il suono "bang"'))).toBe(true);
    expect(problems.some((p) => p.includes('pistol.json: "type" deve essere uno tra "hitscan", "projectile", "melee"'))).toBe(true);
  });

  it('i suoni richiesti dal gioco devono esistere', () => {
    expect(() => loadContent(readSources(), { requiredSounds: ['hit', 'trombetta'] })).toThrowError(
      /manca il suono "trombetta"/,
    );
  });
});

describe('armi nuove', () => {
  it('la mitraglietta spara 15 colpi al secondo', () => {
    const { match, shooter } = setup('smg');
    shooter.input.fire = true;
    let shots = 0;
    for (let i = 0; i < SECOND; i++) {
      match.tick();
      shots += match.events.shots.count;
    }
    expect(shots).toBe(15);
  });

  it('la mitragliatrice ha 100 colpi e ricarica lenta', () => {
    const { shooter, match } = setup('lmg');
    expect(shooter.weapon.ammo[weaponIndex('lmg')]).toBe(100);
    expect(match.weapons[weaponIndex('lmg')]!.reloadTime).toBeGreaterThan(3);
  });

  it('il revolver uccide con un colpo alla testa', () => {
    const { match, shooter, target } = setup('revolver');
    aimAt(shooter, 0, target.player.y + 1.63, target.player.z);
    pull(match, shooter);
    expect(target.alive).toBe(false);
  });

  it('i bot usano solo le armi che lo prevedono', () => {
    const match = new Match(testMap(), gameContent(), { seed: 2 });
    match.setBotCount(8);
    for (const c of match.combatants) expect(match.weapons[c.weapon.current]!.bot).not.toBeNull();
    expect(new Set(match.combatants.map((c) => c.weapon.current)).size).toBeGreaterThan(3);
  });
});

describe('coltello', () => {
  it('due colpi di fronte uccidono, munizioni infinite e niente ricarica', () => {
    const { match, shooter, target } = setup('knife', -1.6);
    target.player.yaw = Math.PI; // guarda verso il tiratore
    aimAt(shooter, 0, 1.2, -1.6);
    expect(pull(match, shooter)).toEqual([55]);
    expect(target.alive).toBe(true);
    pull(match, shooter);
    expect(target.alive).toBe(false);
    expect(shooter.weapon.reloadTimer).toBe(0);
  });

  it('alle spalle uccide con un colpo', () => {
    const { match, shooter, target } = setup('knife', -1.6);
    target.player.yaw = 0; // guarda lontano dal tiratore
    aimAt(shooter, 0, 1.2, -1.6);
    pull(match, shooter);
    expect(target.alive).toBe(false);
  });

  it('non arriva oltre la sua portata né attraverso i muri', () => {
    const far = setup('knife', -3.5);
    aimAt(far.shooter, 0, 1.2, -3.5);
    expect(pull(far.match, far.shooter)).toEqual([]);

    const walled = setup('knife', -1.8, testMap(box([-2, 0, -1.05], [4, 3, 0.1])));
    aimAt(walled.shooter, 0, 1.2, -1.8);
    expect(pull(walled.match, walled.shooter)).toEqual([]);
  });

  it('con il coltello si corre più veloci', () => {
    const { match, shooter } = setup('knife');
    shooter.input.forward = 1;
    for (let i = 0; i < SECOND * 2; i++) match.tick();
    expect(horizontalSpeed(shooter.player)).toBeGreaterThan(MOVE.runSpeed * 1.1);
  });
});
