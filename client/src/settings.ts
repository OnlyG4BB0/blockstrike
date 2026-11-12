/** Impostazioni del giocatore, salvate nel browser quando possibile. */

export interface Settings {
  /** Sensibilità del mouse (1 = 0,0008 radianti per pixel). */
  sensitivity: number;
  /** Campo visivo orizzontale in gradi. */
  fov: number;
  dynamicFov: boolean;
  showFps: boolean;
  showDebug: boolean;
}

/** Radianti di rotazione per pixel di movimento del mouse a sensibilità 1. */
export const SENSITIVITY_SCALE = 0.0008;

const DEFAULTS: Settings = {
  sensitivity: 2.5,
  fov: 100,
  dynamicFov: true,
  showFps: true,
  showDebug: false,
};

const STORAGE_KEY = 'blockstrike.settings.v1';

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
  };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non salvare non è un errore: le impostazioni valgono per questa sessione.
  }
}
