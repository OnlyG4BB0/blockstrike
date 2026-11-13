/**
 * Eventi prodotti da un tick della partita (spari, colpi, uccisioni, esplosioni...).
 * Il client li usa per effetti, suoni e HUD; nella Fase 6 il server li invierà ai giocatori.
 * Gli oggetti vengono riciclati a ogni tick: niente allocazioni durante il gioco.
 */
import type { HitRegion } from './pose.ts';

/** Pallini massimi per colpo. */
export const MAX_PELLETS = 16;

export const SHOT_MISS = 0;
export const SHOT_WORLD = 1;
export const SHOT_BODY = 2;

export interface ShotEvent {
  shooter: number;
  weapon: number;
  ox: number;
  oy: number;
  oz: number;
  pellets: number;
  /** Punto finale di ogni pallino (x, y, z consecutivi). */
  ends: Float32Array;
  /** Normale della superficie colpita, per i segni sui muri. */
  normals: Float32Array;
  /** SHOT_MISS, SHOT_WORLD o SHOT_BODY per ogni pallino. */
  results: Uint8Array;
  /** Solido colpito (SHOT_WORLD) o combattente colpito (SHOT_BODY). */
  targets: Int32Array;
}

export interface HitEvent {
  attacker: number;
  target: number;
  /** Danno inflitto (già limitato alla vita rimasta). */
  damage: number;
  region: HitRegion;
  /** Parte colpita (PART_HEAD ... PART_LEG_RIGHT), -1 per le esplosioni. */
  part: number;
  headshot: boolean;
  killed: boolean;
  /** Arma, oppure KILLED_BY_GRENADE. */
  weapon: number;
  explosive: boolean;
  /** Punto colpito e direzione del colpo (normalizzata): servono a sangue e smembramento. */
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface KillEvent {
  killer: number;
  victim: number;
  /** Indice dell'arma, oppure KILLED_BY_FALL / KILLED_BY_GRENADE. */
  weapon: number;
  headshot: boolean;
  /** Parte colpita dal colpo letale, -1 se nessuna (esplosione, caduta). */
  part: number;
  /** Ucciso da un'esplosione (razzo, granata). */
  explosive: boolean;
  /** Punto e direzione del colpo letale. */
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  /** Distanza tra chi uccide e la vittima (-1 se nessuno, per esempio una caduta). */
  distance: number;
  /** Chi uccide e la vittima erano in aria. */
  killerAirborne: boolean;
  victimAirborne: boolean;
  /** Uccisioni di fila di chi uccide senza morire, compresa questa (0 se non conta). */
  streak: number;
  /** Uccisioni ravvicinate nel tempo di chi uccide, compresa questa (doppietta = 2...). */
  multi: number;
  /** Morti della vittima, compresa questa: con l'id decide lo splatter, uguale su ogni client. */
  victimDeaths: number;
}

export interface ExplosionEvent {
  owner: number;
  /** Arma che ha lanciato il proiettile, oppure KILLED_BY_GRENADE. */
  weapon: number;
  x: number;
  y: number;
  z: number;
  radius: number;
}

export type ActionType =
  | 'reload'
  | 'reloadEnd'
  | 'switch'
  | 'dryFire'
  | 'throw'
  | 'bounce'
  | 'respawn'
  | 'flagTaken'
  | 'flagDropped'
  | 'flagReturned'
  | 'flagCaptured';

export interface ActionEvent {
  combatant: number;
  type: ActionType;
  x: number;
  y: number;
  z: number;
}

export class EventPool<T> {
  count = 0;
  private readonly items: T[] = [];
  private readonly create: () => T;

  constructor(create: () => T) {
    this.create = create;
  }

  add(): T {
    if (this.count === this.items.length) this.items.push(this.create());
    return this.items[this.count++]!;
  }

  get(index: number): T {
    return this.items[index]!;
  }

  clear(): void {
    this.count = 0;
  }
}

export class EventBuffer {
  readonly shots = new EventPool<ShotEvent>(() => ({
    shooter: 0,
    weapon: 0,
    ox: 0,
    oy: 0,
    oz: 0,
    pellets: 0,
    ends: new Float32Array(MAX_PELLETS * 3),
    normals: new Float32Array(MAX_PELLETS * 3),
    results: new Uint8Array(MAX_PELLETS),
    targets: new Int32Array(MAX_PELLETS),
  }));
  readonly hits = new EventPool<HitEvent>(() => ({
    attacker: 0,
    target: 0,
    damage: 0,
    region: 'torso',
    part: -1,
    headshot: false,
    killed: false,
    weapon: 0,
    explosive: false,
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dy: 0,
    dz: 0,
  }));
  readonly kills = new EventPool<KillEvent>(() => ({
    killer: 0,
    victim: 0,
    weapon: 0,
    headshot: false,
    part: -1,
    explosive: false,
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dy: 0,
    dz: 0,
    distance: -1,
    killerAirborne: false,
    victimAirborne: false,
    streak: 0,
    multi: 0,
    victimDeaths: 0,
  }));
  readonly explosions = new EventPool<ExplosionEvent>(() => ({ owner: 0, weapon: 0, x: 0, y: 0, z: 0, radius: 0 }));
  readonly actions = new EventPool<ActionEvent>(() => ({ combatant: 0, type: 'reload', x: 0, y: 0, z: 0 }));

  clear(): void {
    this.shots.clear();
    this.hits.clear();
    this.kills.clear();
    this.explosions.clear();
    this.actions.clear();
  }
}
