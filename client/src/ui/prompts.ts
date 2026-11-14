/**
 * Tasti da mostrare per ogni azione, secondo il dispositivo in uso: tastiera (dai tasti scelti
 * nelle impostazioni), controller (come sono stampati sul modello collegato) o schermo touch.
 * Funzioni pure: l'interfaccia le usa per comandi, suggerimenti e numeri delle armi.
 */
import { padLabel, type DeviceKind, type PadButton, type PadStyle } from '../input/devices.ts';
import { keyName, type KeyAction, type KeyBindings } from '../input/Input.ts';

export type PromptAction =
  | 'move'
  | 'look'
  | 'jump'
  | 'crouch'
  | 'fire'
  | 'aim'
  | 'reload'
  | 'weapons'
  | 'lastWeapon'
  | 'grenade'
  | 'scoreboard'
  | 'respawn'
  | 'menu'
  | 'chat';

/** Ordine e descrizione delle azioni nella scheda Comandi. */
export const PROMPT_ACTIONS: readonly { action: PromptAction; text: string; onlineOnly?: boolean; trainingOnly?: boolean }[] = [
  { action: 'move', text: 'muoviti' },
  { action: 'look', text: 'guardati intorno' },
  { action: 'jump', text: 'salta (tieni premuto per saltare di continuo)' },
  { action: 'crouch', text: 'accovacciati; in corsa scivoli' },
  { action: 'fire', text: 'spara' },
  { action: 'aim', text: 'mira' },
  { action: 'reload', text: 'ricarica' },
  { action: 'weapons', text: 'armi della classe' },
  { action: 'lastWeapon', text: 'arma di prima' },
  { action: 'grenade', text: 'lancia una granata' },
  { action: 'scoreboard', text: 'punteggi' },
  { action: 'respawn', text: 'torna a un punto di partenza', trainingOnly: true },
  { action: 'menu', text: 'menu e pausa' },
  { action: 'chat', text: 'chat', onlineOnly: true },
];

const KEY_ACTION_OF: Partial<Record<PromptAction, KeyAction>> = {
  jump: 'jump',
  crouch: 'crouch',
  reload: 'reload',
  grenade: 'grenade',
  lastWeapon: 'lastWeapon',
  respawn: 'respawn',
  scoreboard: 'scoreboard',
};

/** Tasti della tastiera (il primo e, se c'è, il secondo assegnato). */
export function keyboardPrompt(action: PromptAction, keys: Readonly<KeyBindings>): string[] {
  const bound = KEY_ACTION_OF[action];
  if (bound) return keys[bound].slice(0, 2).map(keyName);
  switch (action) {
    case 'move':
      return [keys.forward, keys.left, keys.back, keys.right].map((k) => keyName(k[0] ?? '?'));
    case 'look':
      return ['Mouse'];
    case 'fire':
      return ['Clic sinistro'];
    case 'aim':
      return ['Clic destro'];
    case 'weapons':
      return ['1', '2', '3', 'Rotella'];
    case 'menu':
      return ['Esc'];
    case 'chat':
      return ['Invio'];
    default:
      return [];
  }
}

/** Tasti del controller per ogni azione. */
export const PAD_BINDINGS: Readonly<Record<PromptAction, readonly (PadButton | 'lstick' | 'rstick')[]>> = {
  move: ['lstick'],
  look: ['rstick'],
  jump: ['a'],
  crouch: ['b', 'ls'],
  fire: ['rt'],
  aim: ['lt'],
  reload: ['x'],
  weapons: ['y', 'left', 'up', 'right'],
  lastWeapon: ['lb'],
  grenade: ['rb'],
  scoreboard: ['back'],
  respawn: ['down'],
  menu: ['start'],
  chat: [],
};

export function padPrompt(action: PromptAction, style: PadStyle): string[] {
  return PAD_BINDINGS[action].map((b) =>
    b === 'lstick' ? 'Levetta sinistra' : b === 'rstick' ? 'Levetta destra' : padLabel(b, style),
  );
}

/** Sul touch: il controllo sullo schermo che fa l'azione. */
export const TOUCH_PROMPTS: Readonly<Record<PromptAction, string>> = {
  move: 'Levetta a sinistra',
  look: 'Trascina a destra',
  jump: 'Salta',
  crouch: 'Giù (resta attivo)',
  fire: 'Fuoco (trascinalo per mirare)',
  aim: 'Mirino',
  reload: 'Ricarica',
  weapons: 'Arma (cambia)',
  lastWeapon: 'Arma (tieni premuto)',
  grenade: 'Granata',
  scoreboard: 'Punti',
  respawn: 'Ricomincia',
  menu: 'Menu',
  chat: 'Chat',
};

export function touchPrompt(action: PromptAction): string[] {
  return [TOUCH_PROMPTS[action]];
}

export interface PromptContext {
  device: DeviceKind;
  style: PadStyle;
  keys: Readonly<KeyBindings>;
}

export function promptLabels(action: PromptAction, ctx: PromptContext): string[] {
  if (ctx.device === 'gamepad') return padPrompt(action, ctx.style);
  if (ctx.device === 'touch') return touchPrompt(action);
  return keyboardPrompt(action, ctx.keys);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Classe CSS del tasto del controller (colori dei tasti frontali). */
function padClass(label: string, style: PadStyle): string {
  if (style === 'playstation') {
    const ps: Record<string, string> = { '✕': 'ps-cross', '○': 'ps-circle', '□': 'ps-square', '△': 'ps-triangle' };
    return ps[label] ?? '';
  }
  if (style === 'xbox' && /^[ABXY]$/.test(label)) return `xb-${label.toLowerCase()}`;
  return '';
}

/** Tasti come HTML (`<kbd>`), pronti per l'interfaccia. */
export function promptHtml(action: PromptAction, ctx: PromptContext): string {
  const labels = promptLabels(action, ctx);
  if (labels.length === 0) return '<span class="prompt-none">—</span>';
  return labels
    .map((label) => {
      const kind = ctx.device === 'gamepad' ? `pad ${padClass(label, ctx.style)}` : ctx.device === 'touch' ? 'touch' : 'key';
      return `<kbd class="prompt ${kind.trim()}">${escapeHtml(label)}</kbd>`;
    })
    .join(' ');
}

/** Etichette dei tasti delle armi 1, 2, 3 secondo il dispositivo. */
export function weaponSlotLabels(count: number, ctx: PromptContext): string[] {
  const labels: string[] = [];
  const pad = ['left', 'up', 'right'] as const;
  for (let i = 0; i < count; i++) {
    if (ctx.device === 'gamepad') labels.push(i < pad.length ? padLabel(pad[i]!, ctx.style) : '');
    else if (ctx.device === 'touch') labels.push('');
    else labels.push(i < 9 ? String(i + 1) : '');
  }
  return labels;
}
