/**
 * Grafo di navigazione dei bot: i punti indicati dalla mappa, collegati quando il percorso
 * in linea retta tra due punti è libero.
 */
import { BOT } from './constants.ts';
import type { Vec3Tuple } from './map.ts';
import { lineOfSight } from './raycast.ts';
import type { CollisionWorld } from './world.ts';

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
