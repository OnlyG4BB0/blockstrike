/**
 * Numeri casuali deterministici (Mulberry32). Ogni sistema tiene il proprio seme, così
 * client e server ottengono la stessa sequenza dagli stessi eventi.
 */
export interface RandomState {
  seed: number;
}

export function createRandom(seed: number): RandomState {
  return { seed: seed >>> 0 };
}

/** Numero in [0, 1). */
export function random(state: RandomState): number {
  state.seed = (state.seed + 0x6d2b79f5) >>> 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomRange(state: RandomState, min: number, max: number): number {
  return min + (max - min) * random(state);
}

/** Intero in [0, count). */
export function randomInt(state: RandomState, count: number): number {
  return Math.min(count - 1, Math.floor(random(state) * count));
}
