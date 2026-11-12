/**
 * Geometria di collisione della mappa: blocchi pieni e rampe, con una griglia spaziale
 * per trovare in fretta i solidi vicini al giocatore.
 */
import { COLLISION } from './constants.ts';
import type { MapBlock } from './map.ts';

export const SHAPE_BOX = 0;
export const SHAPE_RAMP = 1;
export type Shape = typeof SHAPE_BOX | typeof SHAPE_RAMP;

export interface Solid {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  shape: Shape;
  /** Rampa: asse lungo cui sale (0 = x, 2 = z). */
  axis: 0 | 2;
  /** Rampa: +1 se sale verso l'asse positivo, -1 se verso quello negativo. */
  sign: 1 | -1;
  /** Rampa: pendenza (salita diviso percorso orizzontale). Zero per i blocchi. */
  slope: number;
}

export function solidFromBlock(block: MapBlock): Solid {
  const [x, y, z] = block.pos;
  const [w, h, d] = block.size;
  const solid: Solid = {
    minX: x,
    minY: y,
    minZ: z,
    maxX: x + w,
    maxY: y + h,
    maxZ: z + d,
    shape: SHAPE_BOX,
    axis: 0,
    sign: 1,
    slope: 0,
  };
  if (block.type === 'ramp') {
    const dir = block.dir ?? '+x';
    solid.shape = SHAPE_RAMP;
    solid.axis = dir === '+x' || dir === '-x' ? 0 : 2;
    solid.sign = dir === '+x' || dir === '+z' ? 1 : -1;
    solid.slope = h / (solid.axis === 0 ? w : d);
  }
  return solid;
}

/**
 * Quota della superficie superiore del solido sotto il punto (x, z).
 * Per le rampe si usa il punto (non l'intera pianta del giocatore), bloccato entro la rampa:
 * il giocatore poggia sulla rampa con il centro, come una capsula.
 */
export function solidTopAt(s: Solid, x: number, z: number): number {
  if (s.shape === SHAPE_BOX) return s.maxY;
  const c = s.axis === 0 ? x : z;
  const lo = s.axis === 0 ? s.minX : s.minZ;
  const hi = s.axis === 0 ? s.maxX : s.maxZ;
  const clamped = c < lo ? lo : c > hi ? hi : c;
  let t = (clamped - lo) / (hi - lo);
  if (s.sign < 0) t = 1 - t;
  return s.minY + t * (s.maxY - s.minY);
}

/** Pendenza della superficie lungo x (variazione di quota per metro). */
export function solidGradX(s: Solid): number {
  return s.shape === SHAPE_RAMP && s.axis === 0 ? s.sign * s.slope : 0;
}

/** Pendenza della superficie lungo z (variazione di quota per metro). */
export function solidGradZ(s: Solid): number {
  return s.shape === SHAPE_RAMP && s.axis === 2 ? s.sign * s.slope : 0;
}

/**
 * Insieme dei solidi della mappa con una griglia uniforme sul piano xz.
 * Le interrogazioni non allocano memoria: scrivono gli indici in un array riutilizzato.
 */
export class CollisionWorld {
  readonly solids: readonly Solid[];
  private readonly cellSize: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: number[][];
  private readonly stamps: Uint32Array;
  private stamp = 0;

  constructor(solids: readonly Solid[], cellSize: number = COLLISION.gridCellSize) {
    this.solids = solids;
    this.cellSize = cellSize;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const s of solids) {
      minX = Math.min(minX, s.minX);
      minZ = Math.min(minZ, s.minZ);
      maxX = Math.max(maxX, s.maxX);
      maxZ = Math.max(maxZ, s.maxZ);
    }
    if (solids.length === 0) {
      minX = minZ = 0;
      maxX = maxZ = cellSize;
    }
    this.originX = minX;
    this.originZ = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.stamps = new Uint32Array(solids.length);

    solids.forEach((s, index) => {
      const c0 = this.col(s.minX);
      const c1 = this.col(s.maxX);
      const r0 = this.row(s.minZ);
      const r1 = this.row(s.maxZ);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c]!.push(index);
      }
    });
  }

  static fromBlocks(blocks: readonly MapBlock[]): CollisionWorld {
    return new CollisionWorld(blocks.map(solidFromBlock));
  }

  /**
   * Scrive in `out` gli indici dei solidi la cui cella tocca il rettangolo xz indicato
   * (senza duplicati) e restituisce quanti sono. È un filtro grossolano: i test precisi
   * spettano a chi chiama.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    const c0 = this.col(minX);
    const c1 = this.col(maxX);
    const r0 = this.row(minZ);
    const r1 = this.row(maxZ);
    let count = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[r * this.cols + c]!;
        for (let i = 0; i < cell.length; i++) {
          const index = cell[i]!;
          if (this.stamps[index] === this.stamp) continue;
          this.stamps[index] = this.stamp;
          out[count++] = index;
        }
      }
    }
    return count;
  }

  private col(x: number): number {
    const c = Math.floor((x - this.originX) / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private row(z: number): number {
    const r = Math.floor((z - this.originZ) / this.cellSize);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }
}

const pointQuery: number[] = [];

/** Indice del solido che contiene il punto, oppure -1 (per effetti come sangue e pezzi). */
export function solidAt(world: CollisionWorld, x: number, y: number, z: number): number {
  const count = world.query(x, z, x, z, pointQuery);
  for (let i = 0; i < count; i++) {
    const index = pointQuery[i]!;
    const s = world.solids[index]!;
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ || y < s.minY) continue;
    if (y <= solidTopAt(s, x, z)) return index;
  }
  return -1;
}

/**
 * Uscita più breve dal solido per un punto che ci è entrato: scrive la normale della faccia in
 * `out` (x, y, z) e restituisce la profondità.
 */
export function solidExit(s: Solid, x: number, y: number, z: number, out: { x: number; y: number; z: number }): number {
  const top = solidTopAt(s, x, z);
  let depth = top - y;
  // Sopra: per le rampe la normale segue la pendenza.
  let nx = -solidGradX(s);
  let ny = 1;
  let nz = -solidGradZ(s);
  // Facce laterali e inferiore: vince la più vicina (senza allocare).
  const faces = 5;
  for (let i = 0; i < faces; i++) {
    const d = i === 0 ? x - s.minX : i === 1 ? s.maxX - x : i === 2 ? y - s.minY : i === 3 ? z - s.minZ : s.maxZ - z;
    if (d >= depth) continue;
    depth = d;
    nx = i === 0 ? -1 : i === 1 ? 1 : 0;
    ny = i === 2 ? -1 : 0;
    nz = i === 3 ? -1 : i === 4 ? 1 : 0;
  }
  const length = Math.hypot(nx, ny, nz);
  out.x = nx / length;
  out.y = ny / length;
  out.z = nz / length;
  return Math.max(0, depth);
}
