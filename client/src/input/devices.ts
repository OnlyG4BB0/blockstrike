/**
 * Parti pure dei dispositivi di gioco (niente DOM): disposizione standard dei controller, zona
 * morta delle levette, stile del controller dal nome e nomi dei tasti da mostrare.
 */

/** Dispositivo usato per ultimo: decide quali tasti mostrare. */
export type DeviceKind = 'keyboard' | 'touch' | 'gamepad';

/** Famiglia del controller, per disegnare i tasti come sono stampati. */
export type PadStyle = 'xbox' | 'playstation' | 'nintendo' | 'generic';

/** Indici dei tasti nella disposizione "standard" della Gamepad API (W3C). */
export const PAD = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  ls: 10,
  rs: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export type PadButton = keyof typeof PAD;

/** Lo stile dal nome che il browser dà al controller (contiene spesso marca e id USB). */
export function padStyleOf(id: string): PadStyle {
  const s = id.toLowerCase();
  // 045e = Microsoft. Prima di Sony: anche l'Xbox si chiama "Wireless Controller".
  if (/045e|xbox|xinput|x-box/.test(s)) return 'xbox';
  // 057e = Nintendo.
  if (/057e|nintendo|pro controller|joy-?con/.test(s)) return 'nintendo';
  // 054c = Sony; "Wireless Controller" da solo è il nome dei DualShock 4 su molti sistemi.
  if (/054c|dualshock|dualsense|playstation|wireless controller|ps[345]/.test(s)) return 'playstation';
  return 'generic';
}

const LABELS: Record<PadStyle, Record<PadButton, string>> = {
  xbox: {
    a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT',
    back: 'View', start: 'Menu', ls: 'LS', rs: 'RS', up: '↑', down: '↓', left: '←', right: '→',
  },
  playstation: {
    a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2',
    back: 'Create', start: 'Options', ls: 'L3', rs: 'R3', up: '↑', down: '↓', left: '←', right: '→',
  },
  // Sui controller Nintendo il tasto in basso è B e quello a destra è A.
  nintendo: {
    a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR',
    back: '−', start: '+', ls: 'LS', rs: 'RS', up: '↑', down: '↓', left: '←', right: '→',
  },
  generic: {
    a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT',
    back: 'Select', start: 'Start', ls: 'L3', rs: 'R3', up: '↑', down: '↓', left: '←', right: '→',
  },
};

/** Nome del tasto come è stampato sul controller. */
export function padLabel(button: PadButton, style: PadStyle): string {
  return LABELS[style][button];
}

/** Un punto in due dimensioni (levetta), riusabile per non allocare. */
export interface Stick {
  x: number;
  y: number;
}

/**
 * Zona morta circolare: sotto `deadzone` la levetta vale 0, sopra si riscala da 0 a 1 così il
 * movimento parte morbido e non a scatto. Scrive in `out`.
 */
export function applyDeadzone(x: number, y: number, deadzone: number, out: Stick): Stick {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= deadzone) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  out.x = (x / length) * scaled;
  out.y = (y / length) * scaled;
  return out;
}

/** Da un asse analogico a -1, 0 o 1 (il server riceve solo direzioni intere: 8 direzioni). */
export function toDigital(value: number, threshold: number): number {
  if (value >= threshold) return 1;
  if (value <= -threshold) return -1;
  return 0;
}

/** Velocità di rotazione da un asse già senza zona morta: curva per mirare fine vicino al centro. */
export function lookRate(value: number, curve: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), curve);
}

/** Valore di un tasto (0..1), anche per i grilletti analogici; 0 se il tasto non esiste. */
export function buttonValue(buttons: readonly { pressed: boolean; value: number }[], index: number): number {
  const b = buttons[index];
  if (!b) return 0;
  return b.pressed ? Math.max(b.value, 1e-3) : b.value;
}

/** Il controller è stato usato davvero: un tasto premuto o una levetta spinta (non il solo rumore). */
export function padActivity(
  pad: { buttons: readonly { pressed: boolean; value: number }[]; axes: readonly number[] },
  axisThreshold: number,
): boolean {
  for (const b of pad.buttons) if (b.pressed) return true;
  for (const a of pad.axes) if (Math.abs(a) >= axisThreshold) return true;
  return false;
}

/** Direzione di navigazione nel menu da croce direzionale o levetta sinistra. */
export type NavDirection = 'up' | 'down' | 'left' | 'right';

export function navDirection(dx: number, dy: number, threshold: number): NavDirection | null {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * Prossimo elemento da mettere a fuoco in una direzione, tra rettangoli sullo schermo: vince il più
 * vicino nella direzione, penalizzando lo scarto di lato. -1 se non ce n'è.
 */
export function nearestInDirection(
  from: { x: number; y: number; w: number; h: number },
  candidates: readonly { x: number; y: number; w: number; h: number }[],
  direction: NavDirection,
): number {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((r, i) => {
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    const dx = x - cx;
    const dy = y - cy;
    let along: number;
    let side: number;
    if (direction === 'right') [along, side] = [dx, dy];
    else if (direction === 'left') [along, side] = [-dx, dy];
    else if (direction === 'down') [along, side] = [dy, dx];
    else [along, side] = [-dy, dx];
    if (along <= 1) return;
    const score = along + Math.abs(side) * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
