/**
 * Grafo di navigazione dei bot: i punti indicati dalla mappa, collegati quando il percorso
 * in linea retta tra due punti è libero.
 */
import { BOT, MOVE, NAV, PLAYER, TICK_DT } from './constants.ts';
import type { Vec3Tuple } from './map.ts';
import { canFit, createInput, createPlayerState, simulateTick } from './player.ts';
import { lineOfSight } from './raycast.ts';
import { solidTopAt, type CollisionWorld } from './world.ts';

export interface NavGraph {
  nodes: readonly Vec3Tuple[];
  /** Per ogni punto, gli indici dei punti raggiungibili direttamente. */
  links: readonly (readonly number[])[];
}

/** Quote (sopra i gradini superabili) e scarti laterali (larghezza del corpo) dei raggi di controllo. */
const CLEARANCE_HEIGHTS = [0.7, 1.6];
const CLEARANCE_OFFSETS = [-0.35, 0, 0.35];

function pathClear(world: CollisionWorld, a: Vec3Tuple, b: Vec3Tuple): boolean {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return true;
  const px = -dz / length;
  const pz = dx / length;
  for (const height of CLEARANCE_HEIGHTS) {
    for (const offset of CLEARANCE_OFFSETS) {
      const clear = lineOfSight(
        world,
        a[0] + px * offset,
        a[1] + height,
        a[2] + pz * offset,
        b[0] + px * offset,
        b[1] + height,
        b[2] + pz * offset,
      );
      if (!clear) return false;
    }
  }
  return true;
}

export function buildNavGraph(
  world: CollisionWorld,
  waypoints: readonly Vec3Tuple[],
  maxLength: number = BOT.navLinkMaxLength,
): NavGraph {
  const links: number[][] = waypoints.map(() => []);
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i]!;
      const b = waypoints[j]!;
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > maxLength) continue;
      if (!pathClear(world, a, b)) continue;
      links[i]!.push(j);
      links[j]!.push(i);
    }
  }
  return { nodes: waypoints, links };
}

/**
 * Grafo calcolato dalla geometria, per le mappe senza punti di navigazione (per esempio quelle fatte
 * con l'editor). Punti su una griglia dove un giocatore sta in piedi; due punti vicini sono collegati
 * se una camminata simulata (con salti se serve) va davvero dall'uno all'altro. I collegamenti hanno
 * una direzione: da un gradino alto si scende, ma non è detto che si risalga. Restano solo i punti
 * raggiungibili dai punti di rinascita.
 */
export function generateNavGraph(world: CollisionWorld, spawns: readonly Vec3Tuple[]): NavGraph {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const s of world.solids) {
    minX = Math.min(minX, s.minX);
    minZ = Math.min(minZ, s.minZ);
    maxX = Math.max(maxX, s.maxX);
    maxZ = Math.max(maxZ, s.maxZ);
  }
  if (!Number.isFinite(minX)) return { nodes: [], links: [] };
  const step = NAV.spacing;
  const cols = Math.max(1, Math.floor((maxX - minX) / step));
  const rows = Math.max(1, Math.floor((maxZ - minZ) / step));
  // Quota del pavimento: la superficie più bassa su cui si cammina.
  let floor = Infinity;
  for (const s of world.solids) floor = Math.min(floor, s.maxY);
  // Punti: per ogni cella, ogni superficie superiore su cui c'è posto per stare in piedi
  // (sul pavimento una cella su due in ogni direzione).
  const nodes: Vec3Tuple[] = [];
  const cellOf: number[] = [];
  const candidates: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * ((maxX - minX) / cols);
      const z = minZ + (r + 0.5) * ((maxZ - minZ) / rows);
      const count = world.query(x, z, x, z, candidates);
      for (let i = 0; i < count; i++) {
        const s = world.solids[candidates[i]!]!;
        if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
        const y = solidTopAt(s, x, z);
        if (y <= floor + 0.05 && (r % 2 === 1 || c % 2 === 1)) continue;
        if (!canFit(world, x, y + 0.02, z, PLAYER.height)) continue;
        if (nodes.some((n, k) => cellOf[k] === r * cols + c && Math.abs(n[1] - y) < 0.3)) continue;
        nodes.push([x, y, z]);
        cellOf.push(r * cols + c);
      }
    }
  }
  // Collegamenti tra celle vicine, provati camminando.
  const links: number[][] = nodes.map(() => []);
  const range = NAV.neighborCells;
  for (let i = 0; i < nodes.length; i++) {
    const ci = cellOf[i]!;
    const ri = Math.floor(ci / cols);
    const coli = ci % cols;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const cj = cellOf[j]!;
      if (Math.abs(Math.floor(cj / cols) - ri) > range || Math.abs((cj % cols) - coli) > range) continue;
      if (canWalk(world, nodes[i]!, nodes[j]!)) links[i]!.push(j);
    }
  }
  // Solo i punti raggiungibili dalle rinascite.
  const graph = { nodes, links };
  const reached = new Set<number>();
  const queue: number[] = [];
  for (const spawn of spawns) {
    let best = -1;
    let bestDistance = Infinity;
    nodes.forEach((n, k) => {
      const d = Math.hypot(n[0] - spawn[0], n[1] - spawn[1], n[2] - spawn[2]);
      if (d < bestDistance) {
        bestDistance = d;
        best = k;
      }
    });
    if (best >= 0 && !reached.has(best)) {
      reached.add(best);
      queue.push(best);
    }
  }
  while (queue.length > 0) {
    const node = queue.pop()!;
    for (const next of graph.links[node]!) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  const keep = [...reached].sort((a, b) => a - b);
  const index = new Map(keep.map((old, k) => [old, k]));
  return {
    nodes: keep.map((k) => nodes[k]!),
    links: keep.map((k) => links[k]!.filter((j) => index.has(j)).map((j) => index.get(j)!)),
  };
}

const walker = createPlayerState();
const walkInput = createInput();

/** Una camminata simulata da a arriva a b? */
function canWalk(world: CollisionWorld, a: Vec3Tuple, b: Vec3Tuple): boolean {
  Object.assign(walker, createPlayerState());
  walker.x = a[0];
  walker.y = a[1];
  walker.z = a[2];
  walker.grounded = true;
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  walkInput.yaw = Math.atan2(-dx, -dz);
  walkInput.forward = 1;
  walkInput.jump = b[1] - a[1] > NAV.jumpRise;
  const ticks = Math.ceil(NAV.walkTime / TICK_DT);
  for (let t = 0; t < ticks; t++) {
    const rx = b[0] - walker.x;
    const rz = b[2] - walker.z;
    walkInput.yaw = Math.atan2(-rx, -rz);
    simulateTick(walker, walkInput, world);
    if (Math.hypot(rx, rz) < NAV.arriveRadius && Math.abs(walker.y - b[1]) < MOVE.stepHeight) return true;
    if (walker.y < Math.min(a[1], b[1]) - 2) return false;
  }
  return false;
}

/** Grafo di una mappa: dai suoi punti di navigazione o, se non ne ha, calcolato dalla geometria. */
export function navGraphFor(world: CollisionWorld, waypoints: readonly Vec3Tuple[], spawns: readonly Vec3Tuple[]): NavGraph {
  return waypoints.length > 0 ? buildNavGraph(world, waypoints) : generateNavGraph(world, spawns);
}

/** Punto più vicino visibile da (x, y, z); se nessuno è visibile, il più vicino in assoluto. */
export function nearestNode(world: CollisionWorld, graph: NavGraph, x: number, y: number, z: number): number {
  let visible = -1;
  let visibleDistance = Infinity;
  let any = -1;
  let anyDistance = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i]!;
    const distance = Math.hypot(node[0] - x, node[1] - y, node[2] - z);
    if (distance < anyDistance) {
      anyDistance = distance;
      any = i;
    }
    if (distance < visibleDistance && lineOfSight(world, x, y + 0.7, z, node[0], node[1] + 0.7, node[2])) {
      visibleDistance = distance;
      visible = i;
    }
  }
  return visible >= 0 ? visible : any;
}

/** Vero se ogni punto è raggiungibile da ogni altro. */
export function isConnected(graph: NavGraph): boolean {
  if (graph.nodes.length === 0) return true;
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const node = queue.pop()!;
    for (const next of graph.links[node]!) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === graph.nodes.length;
}
