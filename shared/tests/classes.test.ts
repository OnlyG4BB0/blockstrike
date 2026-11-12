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
import { gameContent, readSources } from './content.ts';
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

function problemsOf(sources: ContentSources): string[] {
  try {
    loadContent(sources);
  } catch (error) {
    if (error instanceof ContentError) return [...error.problems];
    throw error;
  }
  return [];
}

function classIndex(id: string): number {
  const index = gameContent().classes.findIndex((c) => c.id === id);
  if (index < 0) throw new Error(`Classe ${id} non trovata`);
  return index;
}

function withClass(id: string): { match: Match; c: Combatant } {
  const match = new Match(testMap(), gameContent(), { seed: 5 });
  match.botMode = 'idle';
  const c = match.addCombatant('Prova', { classIndex: classIndex(id) });
  return { match, c };
}

/** Altezza massima raggiunta dai piedi con un salto da fermi. */
function jumpApex(id: string): number {
  const { match, c } = withClass(id);
  for (let i = 0; i < 10; i++) match.tick();
  const start = c.player.y;
  c.input.jump = true;
  match.tick();
  c.input.jump = false;
  let top = start;
  for (let i = 0; i < SECOND * 2; i++) {
    match.tick();
    top = Math.max(top, c.player.y);
  }
  return top - start;
}

/** Velocità a terra dopo due secondi di corsa in avanti con l'arma principale. */
function runSpeed(id: string): number {
  const { match, c } = withClass(id);
  c.input.forward = 1;
  for (let i = 0; i < SECOND * 2; i++) match.tick();
  return horizontalSpeed(c.player);
}

describe('classi dai file JSON', () => {
  it('le cinque classi iniziali si caricano, con armi esistenti', () => {
    const content = gameContent();
    expect(content.classes.map((c) => c.id)).toEqual(['assaltatore', 'cecchino', 'demolitore', 'esploratore', 'pesante']);
    const weapons = new Set(content.weapons.map((w) => w.id));
    for (const c of content.classes) {
      expect(weapons.has(c.primary)).toBe(true);
      expect(weapons.has(c.secondary)).toBe(true);
      expect(c.health).toBeGreaterThan(0);
    }
  });

  it('un JSON di classe non valido dà un errore chiaro, con file e campo', () => {
    const sources = readSources();
    const classes = sources.classes!.map((f) =>
      f.path.endsWith('/pesante.json') ? { ...f, data: { ...(f.data as object), health: -5, primary: 'laser' } } : f,
    );
    const problems = problemsOf({ ...sources, classes });
    expect(problems).toEqual(['content/classes/pesante.json: "health" deve essere almeno 1']);
    const unknown = sources.classes!.map((f) =>
      f.path.endsWith('/pesante.json') ? { ...f, data: { ...(f.data as object), primary: 'laser', melee: 'smg' } } : f,
    );
    const crossProblems = problemsOf({ ...sources, classes: unknown });
    expect(crossProblems).toContain('content/classes/pesante.json: "primary" indica l\'arma "laser", che non esiste in content/weapons');
    expect(crossProblems).toContain('content/classes/pesante.json: "melee" indica "smg", che non è un\'arma corpo a corpo');
  });

  it('le skin dei personaggi vengono controllate; le skin delle armi senza tipo restano skin delle armi', () => {
    const content = gameContent();
    expect(content.characterSkins.length).toBeGreaterThanOrEqual(5);
    expect(content.skins.every((s) => s.type === 'weapon')).toBe(true);
    expect(content.characterSkins.some((s) => s.accessories.some((a) => a.part === 'head'))).toBe(true);
    expect(content.characterSkins.some((s) => s.accessories.some((a) => a.name === 'Zaino'))).toBe(true);

    const sources = readSources();
    const skins = sources.skins.map((f) => {
      if (!f.path.endsWith('/personaggio_recluta.json')) return f;
      const data = structuredClone(f.data) as { colors: Record<string, string>; accessories: { part: string }[] };
      data.colors.coda = '#ff0000';
      return { ...f, data };
    });
    expect(problemsOf({ ...sources, skins })).toEqual([
      'content/skins/personaggio_recluta.json: "colors.coda" non è una parte del personaggio (parti: head, torso, armLeft, armRight, legLeft, legRight, hair, eyes, hands, feet, belt)',
    ]);
    const badPart = sources.skins.map((f) => {
      if (!f.path.endsWith('/personaggio_recluta.json')) return f;
      const data = structuredClone(f.data) as { accessories: { part: string }[] };
      data.accessories[0]!.part = 'coda';
      return { ...f, data };
    });
    expect(problemsOf({ ...sources, skins: badPart })[0]).toContain('"accessories[0].part" deve essere uno tra');
  });
});

describe('classi in partita', () => {
  it('ogni classe nasce con la sua vita, le sue armi e le sue granate', () => {
    for (const def of gameContent().classes) {
      const { match, c } = withClass(def.id);
      expect(c.health).toBe(def.health);
      expect(c.maxHealth).toBe(def.health);
      expect(c.loadout.map((i) => match.weapons[i]!.id)).toEqual([def.primary, def.secondary, def.melee]);
      expect(match.weapons[c.weapon.current]!.id).toBe(def.primary);
      expect(c.weapon.grenades).toBe(def.grenades);
    }
  });

  it('i tasti scelgono solo tra le armi della classe', () => {
    const { match, c } = withClass('cecchino');
    c.input.weaponSlot = 2;
    match.tick();
    expect(match.weapons[c.weapon.current]!.id).toBe('revolver');
    c.input.weaponSlot = 3;
    match.tick();
    expect(match.weapons[c.weapon.current]!.id).toBe('knife');
    c.input.weaponSlot = 4;
    match.tick();
    expect(match.weapons[c.weapon.current]!.id).toBe('knife');
  });

  it('l\'altezza del salto viene dalla classe', () => {
    for (const id of ['esploratore', 'assaltatore', 'pesante']) {
      const def = gameContent().classes[classIndex(id)]!;
      expect(jumpApex(id)).toBeGreaterThan(def.jumpHeight * 0.98);
      expect(jumpApex(id)).toBeLessThan(def.jumpHeight * 1.01);
    }
    expect(jumpApex('esploratore')).toBeGreaterThan(jumpApex('pesante') + 0.5);
  });

  it('la velocità di corsa viene dalla classe e dall\'arma in mano', () => {
    const content = gameContent();
    for (const id of ['esploratore', 'assaltatore', 'pesante']) {
      const def = content.classes[classIndex(id)]!;
      const weapon = content.weapons.find((w) => w.id === def.primary)!;
      expect(runSpeed(id)).toBeCloseTo(MOVE.runSpeed * def.speed * weapon.moveSpeedFactor, 1);
    }
    expect(runSpeed('esploratore')).toBeGreaterThan(runSpeed('pesante') * 1.3);
  });

  it('il cambio di classe vale dalla rinascita successiva', () => {
    const { match, c } = withClass('assaltatore');
    match.setClass(c, classIndex('pesante'));
    match.tick();
    expect(c.maxHealth).toBe(100);
    match.forceRespawn(c);
    expect(c.maxHealth).toBe(150);
    expect(match.weapons[c.weapon.current]!.id).toBe('lmg');
  });

  it('i bot hanno classi diverse e nascono con un\'arma che sanno usare', () => {
    const match = new Match(testMap(), gameContent(), { seed: 9 });
    match.setBotCount(5);
    const classes = new Set(match.combatants.map((c) => c.classIndex));
    expect(classes.size).toBe(5);
    for (const c of match.combatants) expect(match.weapons[c.weapon.current]!.bot).not.toBeNull();
  });
});
