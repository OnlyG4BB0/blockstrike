/**
 * Hitbox del corpo: testa, busto, braccia e gambe, ruotate con lo sguardo orizzontale del giocatore.
 * Le stesse misure servono al client per costruire il modello a blocchi, così ciò che si vede
 * coincide con ciò che si colpisce.
 *
 * Coordinate locali: x verso destra, y verso l'alto dai piedi, z verso la schiena
 * (il corpo guarda verso -z, come gli oggetti di Three.js).
 */
import type { Vec3Tuple } from './map.ts';
import type { PlayerState } from './player.ts';

export type HitRegion = 'head' | 'torso' | 'arm' | 'leg';

export interface BodyPart {
  name: 'head' | 'torso' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight';
  region: HitRegion;
  min: Vec3Tuple;
  max: Vec3Tuple;
}

export const BODY_STANDING: readonly BodyPart[] = [
  { name: 'head', region: 'head', min: [-0.17, 1.46, -0.17], max: [0.17, 1.8, 0.17] },
  { name: 'torso', region: 'torso', min: [-0.25, 0.86, -0.14], max: [0.25, 1.46, 0.14] },
  { name: 'armLeft', region: 'arm', min: [-0.43, 0.86, -0.1], max: [-0.25, 1.46, 0.1] },
  { name: 'armRight', region: 'arm', min: [0.25, 0.86, -0.1], max: [0.43, 1.46, 0.1] },
  { name: 'legLeft', region: 'leg', min: [-0.23, 0, -0.12], max: [-0.01, 0.86, 0.12] },
  { name: 'legRight', region: 'leg', min: [0.01, 0, -0.12], max: [0.23, 0.86, 0.12] },
];

export const BODY_CROUCHED: readonly BodyPart[] = [
  { name: 'head', region: 'head', min: [-0.17, 0.86, -0.17], max: [0.17, 1.2, 0.17] },
  { name: 'torso', region: 'torso', min: [-0.25, 0.4, -0.14], max: [0.25, 0.86, 0.14] },
  { name: 'armLeft', region: 'arm', min: [-0.43, 0.4, -0.1], max: [-0.25, 0.86, 0.1] },
  { name: 'armRight', region: 'arm', min: [0.25, 0.4, -0.1], max: [0.43, 0.86, 0.1] },
  { name: 'legLeft', region: 'leg', min: [-0.23, 0, -0.3], max: [-0.01, 0.4, 0.12] },
  { name: 'legRight', region: 'leg', min: [0.01, 0, -0.3], max: [0.23, 0.4, 0.12] },
];

export function bodyParts(p: Readonly<PlayerState>): readonly BodyPart[] {
  return p.crouched ? BODY_CROUCHED : BODY_STANDING;
}

export interface BodyHit {
  hit: boolean;
  t: number;
  region: HitRegion;
  /** Indice della parte colpita in bodyParts(). */
  part: number;
}

export function createBodyHit(): BodyHit {
  return { hit: false, t: 0, region: 'torso', part: -1 };
}

/** Raggio contro un box locale (metodo delle lastre). Restituisce la distanza d'ingresso o -1. */
function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  min: Vec3Tuple,
  max: Vec3Tuple,
  maxT: number,
): number {
  let tMin = 0;
  let tMax = maxT;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = min[axis]!;
    const hi = max[axis]!;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  return tMin;
}

const BOUNDS_MIN: Vec3Tuple = [-0.45, 0, -0.32];
const BOUNDS_MAX: Vec3Tuple = [0.45, 1.81, 0.2];

/**
 * Prima parte del corpo colpita dal raggio entro maxT (direzione normalizzata, coordinate di mondo).
 */
export function raycastBody(
  p: Readonly<PlayerState>,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: BodyHit,
): BodyHit {
  out.hit = false;
  out.t = maxT;
  out.part = -1;
  // Porta il raggio nello spazio del corpo (rotazione inversa dello sguardo orizzontale).
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const rx = ox - p.x;
  const ry = oy - p.y;
  const rz = oz - p.z;
  const lox = rx * c - rz * s;
  const loz = rx * s + rz * c;
  const ldx = dx * c - dz * s;
  const ldz = dx * s + dz * c;
  if (rayBox(lox, ry, loz, ldx, dy, ldz, BOUNDS_MIN, BOUNDS_MAX, maxT) < 0) return out;

  const parts = bodyParts(p);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const t = rayBox(lox, ry, loz, ldx, dy, ldz, part.min, part.max, out.t);
    if (t < 0 || t > out.t) continue;
    out.hit = true;
    out.t = t;
    out.region = part.region;
    out.part = i;
  }
  return out;
}
