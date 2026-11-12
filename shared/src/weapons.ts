/**
 * Tipi delle armi. I valori stanno nei file JSON in /content/weapons e /content/equipment
 * (vedi content.ts): aggiungere un'arma non richiede modifiche al codice.
 * Angoli in gradi, tempi in secondi, distanze in metri.
 */
import type { WeaponModelDef } from './content.ts';

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
  /** Modello in volo (id in /content/weapon-models). */
  model: string;
  sounds: { explode: string; bounce: string };
}

export interface MeleeDef {
  /** Portata del colpo (m). */
  reach: number;
  /** Tolleranza laterale del colpo (m): non serve mirare al millimetro. */
  radius: number;
  /** Moltiplicatore del danno colpendo alle spalle. */
  backstabMultiplier: number;
}

export interface WeaponSounds {
  fire: string;
  reload: string;
  reloadEnd: string;
  draw: string;
  /** Suono quando un colpo corpo a corpo va a segno (null = quello generico). */
  hit: string | null;
}

/** Effetti splatter (Fase 5). */
export interface GoreDef {
  /** Il colpo letale può staccare la parte colpita. */
  dismember: boolean;
  /** Probabilità di far esplodere il corpo in pezzi. */
  gibChance: number;
  /** La probabilità vale solo entro questa distanza (m): il fucile a pompa fa a pezzi da vicino. */
  gibRange: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Nome breve per l'HUD. */
  shortName: string;
  /** Posizione nell'elenco delle armi (tasti numerici in ordine). */
  order: number;
  kind: 'hitscan' | 'projectile' | 'melee';
  /** Danno per colpo (per pallino nei fucili a pompa). */
  damage: number;
  headMultiplier: number;
  /** Moltiplicatore per braccia e gambe. */
  limbMultiplier: number;
  /** Colpi al minuto. */
  fireRate: number;
  /** Automatica: spara finché si tiene premuto. */
  auto: boolean;
  /** Colpi nel caricatore; 0 = munizioni infinite (armi corpo a corpo). */
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
  projectile: ProjectileDef | null;
  melee: MeleeDef | null;
  gore: GoreDef;
  /** Modello (id in /content/weapon-models). */
  model: string;
  sounds: WeaponSounds;
  /** Se presente, i bot possono usare quest'arma e cercano di stare a questa distanza. */
  bot: { preferredRange: number } | null;
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
  sounds: { throw: string };
}

/** Classe del personaggio (/content/classes): statistiche e armi con cui si nasce. */
export interface ClassDef {
  id: string;
  name: string;
  description: string;
  /** Posizione nell'elenco delle classi. */
  order: number;
  health: number;
  /** Moltiplicatore della velocità di corsa. */
  speed: number;
  /** Altezza del salto da fermi (m). */
  jumpHeight: number;
  /** Armi (id in /content/weapons): tasto 1, tasto 2 e, se c'è, tasto 3. */
  primary: string;
  secondary: string;
  melee: string | null;
  grenades: number;
}

/** Dati di gioco che servono alla simulazione. */
export interface CombatContent {
  weapons: readonly WeaponDef[];
  grenade: ThrowableDef;
  /** Classi: senza, ogni combattente ha tutte le armi. */
  classes?: readonly ClassDef[];
  /** Modelli delle armi: servono per le impugnature (posa delle braccia). */
  models?: ReadonlyMap<string, WeaponModelDef>;
}

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
