/**
 * Note delle patch (content/patches.json) e confronto delle versioni: funzioni pure.
 * Dopo un aggiornamento il menu mostra le novità che il giocatore non ha ancora visto.
 */

export interface PatchNote {
  version: string;
  date: string;
  title: string;
  notes: string[];
}

/** Confronta versioni "x.y.z" (numeri): negativo se a < b, 0 se uguali, positivo se a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const VERSION = /^\d+\.\d+\.\d+$/;

/** Note dal file JSON, controllate, dalla più nuova; quelle scritte male si saltano. */
export function parsePatches(raw: unknown): PatchNote[] {
  const list = typeof raw === 'object' && raw !== null ? (raw as { patches?: unknown }).patches : undefined;
  if (!Array.isArray(list)) return [];
  const patches: PatchNote[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { version, date, title, notes } = item as Record<string, unknown>;
    if (typeof version !== 'string' || !VERSION.test(version)) continue;
    if (!Array.isArray(notes) || !notes.every((n) => typeof n === 'string')) continue;
    patches.push({
      version,
      date: typeof date === 'string' ? date : '',
      title: typeof title === 'string' ? title : '',
      notes: notes as string[],
    });
  }
  return patches.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Novità da mostrare: le versioni più nuove di quella vista per ultima (al massimo `max`). Al primo
 * avvio (niente di visto) solo l'ultima.
 */
export function unseenPatches(patches: readonly PatchNote[], lastSeen: string, max = 3): PatchNote[] {
  if (!lastSeen) return patches.slice(0, 1);
  return patches.filter((p) => compareVersions(p.version, lastSeen) > 0).slice(0, max);
}
