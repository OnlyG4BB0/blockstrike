/** Impostazioni del giocatore, salvate nel browser quando possibile. */
import type { BotMode } from '@blockstrike/shared';

export interface Settings {
  /** Sensibilità del mouse (1 = 0,0008 radianti per pixel). */
  sensitivity: number;
  /** Campo visivo orizzontale in gradi. */
  fov: number;
  dynamicFov: boolean;
  showFps: boolean;
  showDebug: boolean;
  /** Volume generale, da 0 a 1. */
  volume: number;
  damageNumbers: boolean;
  botCount: number;
  botMode: BotMode;
  /** Skin scelta per ogni arma (id arma → id skin). */
  skins: Record<string, string>;
}

/** Radianti di rotazione per pixel di movimento del mouse a sensibilità 1. */
export const SENSITIVITY_SCALE = 0.0008;
export const MAX_BOTS = 7;

const DEFAULTS: Settings = {
  sensitivity: 2.5,
  fov: 100,
  dynamicFov: true,
  showFps: true,
  showDebug: false,
  volume: 0.6,
  damageNumbers: true,
  botCount: 4,
  botMode: 'fight',
  skins: {},
};

const STORAGE_KEY = 'blockstrike.settings.v1';
const BOT_MODES: readonly BotMode[] = ['fight', 'roam', 'idle'];

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result;
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') result[key] = item;
  return result;
}

export function loadSettings(): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) stored = parsed as Record<string, unknown>;
    }
  } catch {
    // Archiviazione non disponibile (finestra privata, dati bloccati): si usano i valori predefiniti.
  }
  return {
    sensitivity: numberIn(stored.sensitivity, 0.2, 10, DEFAULTS.sensitivity),
    fov: numberIn(stored.fov, 70, 120, DEFAULTS.fov),
    dynamicFov: booleanOr(stored.dynamicFov, DEFAULTS.dynamicFov),
    showFps: booleanOr(stored.showFps, DEFAULTS.showFps),
    showDebug: booleanOr(stored.showDebug, DEFAULTS.showDebug),
    volume: numberIn(stored.volume, 0, 1, DEFAULTS.volume),
    damageNumbers: booleanOr(stored.damageNumbers, DEFAULTS.damageNumbers),
    botCount: Math.round(numberIn(stored.botCount, 0, MAX_BOTS, DEFAULTS.botCount)),
    botMode: BOT_MODES.includes(stored.botMode as BotMode) ? (stored.botMode as BotMode) : DEFAULTS.botMode,
    skins: stringRecord(stored.skins),
  };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non salvare non è un errore: le impostazioni valgono per questa sessione.
  }
}
