/**
 * Definizioni delle armi. Nella Fase 3 questi dati passeranno in file JSON (/content/weapons),
 * con la stessa forma: qui c'è già tutto ciò che la simulazione usa.
 * Angoli in gradi, tempi in secondi, distanze in metri.
 */

export interface ProjectileDef {
  kind: 'rocket' | 'grenade';
  /** Velocità iniziale (m/s). */
  speed: number;
  gravity: number;
  /** Raggio di collisione. */
  radius: number;
  /** Dopo questo tempo esplode comunque. */
  lifetime: number;
  /** Esplode dopo questo tempo anche se ferma (0 = solo all'impatto). */
  fuse: number;
  /** Elasticità dei rimbalzi (0 = esplode all'impatto). */
  bounce: number;
  /** Quanta velocità parallela alla superficie resta dopo un rimbalzo. */
  friction: number;
  splashRadius: number;
  /** Danno al centro dell'esplosione. */
  splashDamage: number;
  /** Frazione del danno al bordo dell'area. */
  minSplashFactor: number;
  /** Frazione del danno subita da chi ha lanciato. */
  selfDamageFactor: number;
  /** Spinta al centro dell'esplosione (m/s). */
  knockback: number;
  /** Moltiplicatore della spinta su chi ha lanciato (salti con i razzi). */
  selfKnockbackFactor: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Tasto numerico che seleziona l'arma. */
  slot: number;
  kind: 'hitscan' | 'projectile';
  /** Danno per colpo (per pallino nei fucili a pompa). */
  damage: number;
  headMultiplier: number;
  /** Moltiplicatore per braccia e gambe. */
  limbMultiplier: number;
  /** Colpi al minuto. */
  fireRate: number;
  /** Automatica: spara finché si tiene premuto. */
  auto: boolean;
  magazine: number;
  reloadTime: number;
  /** Tempo per estrarre l'arma prima di poter sparare. */
  drawTime: number;
  /** Pallini per colpo. */
  pellets: number;
  /** Calo del danno: pieno fino a `start`, poi lineare fino a `minDamageFactor` a `end`. */
  range: { start: number; end: number; minDamageFactor: number };
  /**
   * Dispersione: `base` da fermi, + `moving` alla velocità di corsa, + `air` in aria,
   * + quella accumulata sparando (`perShot` a colpo, fino a `max`, recupero `recovery` gradi/s).
   * Mirando si moltiplica tutto per `ads`.
   */
  spread: { base: number; moving: number; air: number; perShot: number; max: number; recovery: number; ads: number };
  /**
   * Rinculo: spostamento della mira a ogni colpo (gradi in alto, gradi a destra), seguendo lo schema.
   * Torna a zero con velocità `recovery` (1/s). Mirando si moltiplica per `ads`.
   */
  recoil: { pattern: readonly (readonly [number, number])[]; recovery: number; ads: number };
  /** Mira: ingrandimento, tempo per entrare in mira, velocità di movimento, mirino ottico. */
  ads: { zoom: number; time: number; moveFactor: number; scope: boolean };
  /** Moltiplicatore della velocità di corsa con l'arma in mano. */
  moveSpeedFactor: number;
  projectile?: ProjectileDef;
}

export interface ThrowableDef {
  id: string;
  name: string;
  /** Granate a ogni vita. */
  count: number;
  /** Tempo minimo tra due lanci. */
  cooldown: number;
  /** Spinta verso l'alto aggiunta al lancio (m/s). */
  throwUp: number;
  /** Frazione della velocità del giocatore trasmessa alla granata. */
  inheritVelocity: number;
  projectile: ProjectileDef;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'assault_rifle',
    name: "Fucile d'assalto",
    slot: 1,
    kind: 'hitscan',
    damage: 24,
    headMultiplier: 2.1,
    limbMultiplier: 0.8,
    fireRate: 600,
    auto: true,
    magazine: 30,
    reloadTime: 1.9,
    drawTime: 0.45,
    pellets: 1,
    range: { start: 25, end: 60, minDamageFactor: 0.6 },
    spread: { base: 0.5, moving: 1.6, air: 3, perShot: 0.4, max: 4, recovery: 9, ads: 0.3 },
    recoil: {
      pattern: [
        [0.9, 0],
        [0.85, 0.15],
        [0.8, 0.3],
        [0.75, -0.1],
        [0.7, -0.35],
        [0.65, -0.4],
        [0.6, 0.25],
        [0.6, 0.45],
      ],
      recovery: 5,
      ads: 0.6,
    },
    ads: { zoom: 1.35, time: 0.18, moveFactor: 0.75, scope: false },
    moveSpeedFactor: 0.95,
  },
  {
    id: 'sniper',
    name: 'Cecchino',
    slot: 2,
    kind: 'hitscan',
    damage: 100,
    headMultiplier: 2,
    limbMultiplier: 0.7,
    fireRate: 40,
    auto: false,
    magazine: 5,
    reloadTime: 2.6,
    drawTime: 0.6,
    pellets: 1,
    range: { start: 300, end: 300, minDamageFactor: 1 },
    spread: { base: 6, moving: 6, air: 10, perShot: 0, max: 0, recovery: 0, ads: 0.02 },
    recoil: { pattern: [[3.2, 0.3]], recovery: 7, ads: 1 },
    ads: { zoom: 4, time: 0.25, moveFactor: 0.55, scope: true },
    moveSpeedFactor: 0.9,
  },
  {
    id: 'shotgun',
    name: 'Fucile a pompa',
    slot: 3,
    kind: 'hitscan',
    damage: 13,
    headMultiplier: 1.5,
    limbMultiplier: 0.8,
    fireRate: 70,
    auto: false,
    magazine: 6,
    reloadTime: 2.2,
    drawTime: 0.5,
    pellets: 8,
    range: { start: 6, end: 20, minDamageFactor: 0.25 },
    spread: { base: 5, moving: 1, air: 1, perShot: 0, max: 0, recovery: 0, ads: 0.8 },
    recoil: { pattern: [[4, 0]], recovery: 6, ads: 0.8 },
    ads: { zoom: 1.15, time: 0.2, moveFactor: 0.8, scope: false },
    moveSpeedFactor: 0.95,
  },
  {
    id: 'pistol',
    name: 'Pistola',
    slot: 4,
    kind: 'hitscan',
    damage: 28,
    headMultiplier: 2,
    limbMultiplier: 0.8,
    fireRate: 360,
    auto: false,
    magazine: 12,
    reloadTime: 1.3,
    drawTime: 0.3,
    pellets: 1,
    range: { start: 15, end: 45, minDamageFactor: 0.55 },
    spread: { base: 0.8, moving: 1.2, air: 3, perShot: 0.6, max: 3.5, recovery: 6, ads: 0.35 },
    recoil: { pattern: [[1.6, 0.1], [1.5, -0.15]], recovery: 7, ads: 0.7 },
    ads: { zoom: 1.25, time: 0.15, moveFactor: 0.85, scope: false },
    moveSpeedFactor: 1,
  },
  {
    id: 'rocket_launcher',
    name: 'Lanciarazzi',
    slot: 5,
    kind: 'projectile',
    damage: 0,
    headMultiplier: 1,
    limbMultiplier: 1,
    fireRate: 50,
    auto: false,
    magazine: 1,
    reloadTime: 1.3,
    drawTime: 0.6,
    pellets: 1,
    range: { start: 0, end: 0, minDamageFactor: 1 },
    spread: { base: 0, moving: 0.6, air: 1.2, perShot: 0, max: 0, recovery: 0, ads: 0.5 },
    recoil: { pattern: [[2.5, 0]], recovery: 6, ads: 1 },
    ads: { zoom: 1.2, time: 0.2, moveFactor: 0.75, scope: false },
    moveSpeedFactor: 0.85,
    projectile: {
      kind: 'rocket',
      speed: 34,
      gravity: 0,
      radius: 0.15,
      lifetime: 6,
      fuse: 0,
      bounce: 0,
      friction: 0,
      splashRadius: 4.5,
      splashDamage: 110,
      minSplashFactor: 0.15,
      selfDamageFactor: 0.35,
      knockback: 10,
      selfKnockbackFactor: 1.25,
    },
  },
];

export const GRENADE: ThrowableDef = {
  id: 'grenade',
  name: 'Granata',
  count: 2,
  cooldown: 0.8,
  throwUp: 2.5,
  inheritVelocity: 0.5,
  projectile: {
    kind: 'grenade',
    speed: 17,
    gravity: 22,
    radius: 0.12,
    lifetime: 2.2,
    fuse: 2.2,
    bounce: 0.45,
    friction: 0.75,
    splashRadius: 5.5,
    splashDamage: 120,
    minSplashFactor: 0.1,
    selfDamageFactor: 1,
    knockback: 8,
    selfKnockbackFactor: 1,
  },
};

/** Indici speciali per l'arma che ha causato un'uccisione. */
export const KILLED_BY_FALL = -1;
export const KILLED_BY_GRENADE = -2;

/** Moltiplicatore di danno per la parte del corpo colpita. */
export function regionMultiplier(def: WeaponDef, region: 'head' | 'torso' | 'arm' | 'leg'): number {
  if (region === 'head') return def.headMultiplier;
  if (region === 'torso') return 1;
  return def.limbMultiplier;
}

/** Fattore di danno in base alla distanza. */
export function damageFalloff(def: WeaponDef, distance: number): number {
  const { start, end, minDamageFactor } = def.range;
  if (distance <= start || end <= start) return 1;
  if (distance >= end) return minDamageFactor;
  return 1 - ((distance - start) / (end - start)) * (1 - minDamageFactor);
}

/** Indice dello schema di rinculo per il colpo n-esimo: finita la sequenza ripete la seconda metà. */
export function recoilPatternIndex(length: number, shot: number): number {
  if (shot < length) return shot;
  const loopStart = Math.floor(length / 2);
  return loopStart + ((shot - length) % (length - loopStart));
}
