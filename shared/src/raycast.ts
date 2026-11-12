/**
 * Raggi contro la geometria della mappa: blocchi e rampe (cunei).
 * Ogni solido è un poliedro convesso: si interseca il raggio con i suoi piani (Cyrus-Beck).
 */
import { SHAPE_RAMP, type CollisionWorld, type Solid } from './world.ts';

export interface RayHit {
  hit: boolean;
  /** Distanza lungo il raggio (la direzione è normalizzata). */
  t: number;
  x: number;
  y: number;
  z: number;
  /** Normale della superficie colpita. */
  nx: number;
  ny: number;
  nz: number;
  /** Indice del solido colpito, -1 se nessuno. */
  solid: number;
}

export function createRayHit(): RayHit {
  return { hit: false, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, solid: -1 };
}

const candidates: number[] = [];
const losHit = createRayHit();

// Stato del ritaglio del raggio (variabili di modulo: nessuna allocazione).
let enterT = 0;
let exitT = 0;
let enterNx = 0;
let enterNy = 0;
let enterNz = 0;

/** Restringe l'intervallo del raggio al semispazio n·p ≤ d. Restituisce false se diventa vuoto. */
function clip(
  nx: number,
  ny: number,
  nz: number,
  d: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): boolean {
  const denom = nx * dx + ny * dy + nz * dz;
  const dist = d - (nx * ox + ny * oy + nz * oz);
  if (Math.abs(denom) < 1e-12) return dist >= 0;
  const t = dist / denom;
  if (denom < 0) {
    if (t > enterT) {
      enterT = t;
      enterNx = nx;
      enterNy = ny;
      enterNz = nz;
    }
  } else if (t < exitT) {
    exitT = t;
  }
  return enterT <= exitT;
}

/** Interseca il raggio con un solido entro maxT; in caso di successo lascia il risultato in enterT/enterN*. */
function intersectSolid(
  s: Solid,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): boolean {
  enterT = -Infinity;
  exitT = maxT;
  enterNx = -dx;
  enterNy = -dy;
  enterNz = -dz;
  if (!clip(1, 0, 0, s.maxX, ox, oy, oz, dx, dy, dz)) return false;
  if (!clip(-1, 0, 0, -s.minX, ox, oy, oz, dx, dy, dz)) return false;
  if (!clip(0, 1, 0, s.maxY, ox, oy, oz, dx, dy, dz)) return false;
  if (!clip(0, -1, 0, -s.minY, ox, oy, oz, dx, dy, dz)) return false;
  if (!clip(0, 0, 1, s.maxZ, ox, oy, oz, dx, dy, dz)) return false;
  if (!clip(0, 0, -1, -s.minZ, ox, oy, oz, dx, dy, dz)) return false;
  if (s.shape === SHAPE_RAMP) {
    // Superficie inclinata: y ≤ minY + pendenza × distanza dal lato basso.
    const k = s.sign * s.slope;
    const lo = s.axis === 0 ? s.minX : s.minZ;
    const hi = s.axis === 0 ? s.maxX : s.maxZ;
    const base = s.sign > 0 ? lo : hi;
    const length = Math.hypot(k, 1);
    const nAlong = -k / length;
    const ny = 1 / length;
    const d = (s.minY - k * base) / length;
    const ok =
      s.axis === 0
        ? clip(nAlong, ny, 0, d, ox, oy, oz, dx, dy, dz)
        : clip(0, ny, nAlong, d, ox, oy, oz, dx, dy, dz);
    if (!ok) return false;
  }
  if (exitT < 0) return false;
  if (enterT < 0) enterT = 0;
  return true;
}

/**
 * Primo solido colpito dal raggio (origine o, direzione d normalizzata) entro maxT.
 * Il risultato viene scritto in `out`, che viene anche restituito.
 */
export function raycastWorld(
  world: CollisionWorld,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: RayHit,
): RayHit {
  out.hit = false;
  out.t = maxT;
  out.solid = -1;
  const ex = ox + dx * maxT;
  const ez = oz + dz * maxT;
  const n = world.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), candidates);
  let best = maxT;
  for (let i = 0; i < n; i++) {
    const index = candidates[i]!;
    if (!intersectSolid(world.solids[index]!, ox, oy, oz, dx, dy, dz, best)) continue;
    if (enterT > best) continue;
    best = enterT;
    out.hit = true;
    out.solid = index;
    out.nx = enterNx;
    out.ny = enterNy;
    out.nz = enterNz;
  }
  out.t = best;
  out.x = ox + dx * best;
  out.y = oy + dy * best;
  out.z = oz + dz * best;
  if (out.hit) {
    const length = Math.hypot(out.nx, out.ny, out.nz) || 1;
    out.nx /= length;
    out.ny /= length;
    out.nz /= length;
  }
  return out;
}

/** Vero se nessun solido si trova tra i due punti. */
export function lineOfSight(
  world: CollisionWorld,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return true;
  raycastWorld(world, ax, ay, az, dx / length, dy / length, dz / length, length, losHit);
  return !losHit.hit || losHit.t >= length - 1e-3;
}
