/**
 * Disposizione dei tasti touch (parti pure, senza DOM): posizione e dimensione di ogni tasto,
 * salvate nelle impostazioni e modificabili dal giocatore, e la risposta della visuale al dito.
 */
import { TOUCH } from '../config.ts';

export type TouchButton =
  | 'fire'
  | 'aim'
  | 'jump'
  | 'crouch'
  | 'reload'
  | 'grenade'
  | 'weapon'
  | 'score'
  | 'pause'
  | 'chat'
  | 'respawn';

/** Centro del tasto in frazioni dello schermo (0..1) e diametro in pixel CSS. */
export interface ButtonPlace {
  x: number;
  y: number;
  size: number;
}

export type TouchLayout = Record<TouchButton, ButtonPlace>;

export const TOUCH_BUTTONS: readonly TouchButton[] = [
  'fire',
  'aim',
  'jump',
  'crouch',
  'reload',
  'grenade',
  'weapon',
  'score',
  'pause',
  'chat',
  'respawn',
];

/**
 * Disposizione predefinita, per il pollice destro: il fuoco grande al centro della zona, attorno
 * (a portata senza staccare il pollice) mirino, salto, giù e granata; sopra ricarica e arma; in
 * alto i tasti piccoli che si usano poco.
 */
export const DEFAULT_TOUCH_LAYOUT: Readonly<TouchLayout> = {
  fire: { x: 0.86, y: 0.62, size: 96 },
  aim: { x: 0.7, y: 0.5, size: 64 },
  jump: { x: 0.73, y: 0.8, size: 74 },
  crouch: { x: 0.6, y: 0.84, size: 62 },
  grenade: { x: 0.58, y: 0.62, size: 54 },
  reload: { x: 0.93, y: 0.3, size: 56 },
  weapon: { x: 0.8, y: 0.3, size: 56 },
  score: { x: 0.81, y: 0.08, size: 44 },
  pause: { x: 0.95, y: 0.08, size: 44 },
  chat: { x: 0.67, y: 0.08, size: 44 },
  respawn: { x: 0.67, y: 0.08, size: 44 },
};

/** Tasti da cui, trascinando il dito, si muove anche la visuale (come dal fuoco). */
export const LOOK_BUTTONS: ReadonlySet<TouchButton> = new Set<TouchButton>(['fire', 'aim', 'jump', 'crouch', 'reload', 'grenade', 'weapon']);

export function defaultTouchLayout(): TouchLayout {
  const layout = {} as TouchLayout;
  for (const button of TOUCH_BUTTONS) layout[button] = { ...DEFAULT_TOUCH_LAYOUT[button] };
  return layout;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Disposizione salvata, controllata: quello che manca o non va bene torna al predefinito. */
export function touchLayoutFrom(value: unknown): TouchLayout {
  const layout = defaultTouchLayout();
  if (typeof value !== 'object' || value === null) return layout;
  const raw = value as Record<string, unknown>;
  for (const button of TOUCH_BUTTONS) {
    const place = raw[button];
    if (typeof place !== 'object' || place === null) continue;
    const { x, y, size } = place as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof size !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size)) continue;
    layout[button] = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), size: clamp(size, TOUCH.buttonMin, TOUCH.buttonMax) };
  }
  return layout;
}

/**
 * Guadagno della visuale secondo la velocità del dito (pixel al millisecondo): 1 con movimenti
 * lenti (mira precisa), fino a 1 + lookAccelMax con uno scatto (girarsi di colpo).
 */
export function lookGain(speed: number): number {
  if (!Number.isFinite(speed) || speed <= TOUCH.lookAccelStart) return 1;
  return 1 + Math.min(TOUCH.lookAccelMax, (speed - TOUCH.lookAccelStart) * TOUCH.lookAccel);
}
