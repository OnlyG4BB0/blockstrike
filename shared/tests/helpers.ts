import {
  CollisionWorld,
  createInput,
  createPlayerState,
  simulateTick,
  type MapBlock,
  type PlayerInput,
  type PlayerState,
  type RampDirection,
  type Vec3Tuple,
} from '../src/index.ts';

export function box(pos: Vec3Tuple, size: Vec3Tuple): MapBlock {
  return { pos, size, color: '#888888', type: 'box' };
}

export function ramp(pos: Vec3Tuple, size: Vec3Tuple, dir: RampDirection): MapBlock {
  return { pos, size, color: '#888888', type: 'ramp', dir };
}

/** Pavimento 200 x 200 con la superficie a quota 0. */
export const FLOOR = box([-100, -1, -100], [200, 1, 200]);

export function world(...blocks: MapBlock[]): CollisionWorld {
  return CollisionWorld.fromBlocks([FLOOR, ...blocks]);
}

/** Yaw (radianti) per guardare verso +x. */
export const FACE_POS_X = -Math.PI / 2;
/** Yaw (radianti) per guardare verso -x. */
export const FACE_NEG_X = Math.PI / 2;

export function playerAt(x: number, y: number, z: number): PlayerState {
  const p = createPlayerState();
  p.x = x;
  p.y = y;
  p.z = z;
  return p;
}

export function input(values: Partial<PlayerInput> = {}): PlayerInput {
  return { ...createInput(), ...values };
}

/** Esegue `ticks` tick con lo stesso input; restituisce lo stato. */
export function run(p: PlayerState, w: CollisionWorld, ticks: number, cmd: PlayerInput): PlayerState {
  for (let i = 0; i < ticks; i++) simulateTick(p, cmd, w);
  return p;
}

/** Fa atterrare il giocatore e lo lascia fermo. */
export function settle(p: PlayerState, w: CollisionWorld, cmd: PlayerInput = input()): PlayerState {
  return run(p, w, 90, cmd);
}
