/**
 * Hitbox di riferimento del corpo e colpi contro un giocatore di cui si conosce solo lo stato di
 * movimento. Durante la partita le hitbox seguono le parti animate (vedi pose.ts): queste tabelle
 * descrivono la posa ferma a mani libere, in piedi e accovacciati, e servono come riferimento.
 *
 * Coordinate locali: x verso destra, y verso l'alto dai piedi, z verso la schiena
 * (il corpo guarda verso -z, come gli oggetti di Three.js).
 */
import type { Vec3Tuple } from './map.ts';
import type { PlayerState } from './player.ts';
import {
  BodyPose,
  createAnimState,
  poseBody,
  raycastPose,
  resetAnimState,
  type BodyHit,
  type HitRegion,
  type PartName,
} from './pose.ts';

export interface BodyPart {
  name: PartName;
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

/** Posa ferma di riferimento per lo stato del giocatore. */
export function bodyParts(p: Readonly<PlayerState>): readonly BodyPart[] {
  return p.crouched ? BODY_CROUCHED : BODY_STANDING;
}

const scratchAnim = createAnimState();
const scratchPose = new BodyPose();

/**
 * Colpo contro un giocatore fermo a mani libere, nella posa data dal suo stato (in piedi,
 * accovacciato, in scivolata). La partita usa invece la posa animata di ogni combattente.
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
  resetAnimState(scratchAnim, p, -1);
  poseBody(scratchPose, scratchAnim, []);
  return raycastPose(scratchPose, ox, oy, oz, dx, dy, dz, maxT, out);
}
