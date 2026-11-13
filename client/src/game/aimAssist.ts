/**
 * Automira per i comandi touch (parti pure, senza DOM né three.js). Due effetti:
 * - rallentamento: vicino a un nemico la visuale col dito è più lenta, così non si scavalca il bersaglio;
 * - attrazione: mentre si spara, si mira o si muove la visuale, il mirino va piano verso il nemico
 *   più vicino al centro, dentro un piccolo cono e solo se si vede (la linea di vista la controlla
 *   chi chiama).
 * Cambia solo la direzione in cui si guarda, come farebbe il dito: il server decide i colpi come sempre.
 */

const TWO_PI = Math.PI * 2;

/** Differenza tra due angoli nell'intervallo (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

export interface Look {
  yaw: number;
  pitch: number;
}

/** Direzione (stessa convenzione dei comandi: yaw 0 guarda verso -z) dall'occhio a un punto. */
export function lookAt(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, out: Look): Look {
  const dx = tx - ex;
  const dz = tz - ez;
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(ty - ey, Math.hypot(dx, dz));
  return out;
}

/** Distanza angolare tra la mira e una direzione (radianti). */
export function angularDistance(yaw: number, pitch: number, target: Look): number {
  return Math.hypot(angleDelta(yaw, target.yaw) * Math.cos(pitch), angleDelta(pitch, target.pitch));
}

/**
 * Di quanto ruotare in questo fotogramma verso il bersaglio: si avvicina con una legge esponenziale
 * (rate al secondo) senza superare maxSpeed radianti al secondo. Scrive in `out`.
 */
export function pull(yaw: number, pitch: number, target: Look, rate: number, maxSpeed: number, dt: number, out: Look): Look {
  const dy = angleDelta(yaw, target.yaw);
  const dp = angleDelta(pitch, target.pitch);
  const fraction = 1 - Math.exp(-rate * dt);
  let sy = dy * fraction;
  let sp = dp * fraction;
  const step = Math.hypot(sy, sp);
  const limit = maxSpeed * dt;
  if (step > limit && step > 0) {
    sy *= limit / step;
    sp *= limit / step;
  }
  out.yaw = sy;
  out.pitch = sp;
  return out;
}

/**
 * Rallentamento della visuale: 1 lontano dai nemici, fino a 1 - friction con il mirino sopra il
 * bersaglio, in modo graduale dentro il cono.
 */
export function friction(distance: number, cone: number, strength: number): number {
  if (!(distance < cone) || strength <= 0) return 1;
  return 1 - strength * (1 - distance / cone);
}
