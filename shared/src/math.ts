export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export const DEG_TO_RAD = Math.PI / 180;
