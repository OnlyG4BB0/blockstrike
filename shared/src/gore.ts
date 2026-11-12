/**
 * Regole dello splatter. Gli effetti (sangue, macchie, pezzi) li calcola solo il client a partire
 * dall'evento di morte; qui c'è solo la decisione, pura e uguale per tutti i client: lo stesso
 * colpo letale produce lo stesso risultato su ogni schermo.
 */
import type { KillEvent } from './events.ts';
import { PART_TORSO } from './pose.ts';
import type { GoreDef } from './weapons.ts';

/** Livello di gore scelto nelle impostazioni. */
export type GoreLevel = 'full' | 'reduced' | 'off';
export const GORE_LEVELS: readonly GoreLevel[] = ['full', 'reduced', 'off'];

/**
 * Cosa succede al corpo:
 * - gib: tutto il personaggio va in pezzi;
 * - dismember: la parte colpita si stacca, il resto cade come un manichino;
 * - ragdoll: il corpo cade intero nella direzione del colpo;
 * - vanish: il corpo svanisce (gore spento).
 */
export type GoreOutcome = 'gib' | 'dismember' | 'ragdoll' | 'vanish';

/** Numero tra 0 e 1 che dipende solo dalla vittima e da quante volte è morta. */
export function goreRoll(victimId: number, deaths: number): number {
  let h = Math.imul(victimId + 1, 0x9e3779b1) ^ Math.imul(deaths + 1, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Esito dello splatter per un'uccisione. `gore` è quello dell'arma (null per granate e cadute),
 * `roll` un numero tra 0 e 1 (vedi goreRoll).
 */
export function decideGore(
  kill: Readonly<Pick<KillEvent, 'explosive' | 'part' | 'distance'>>,
  gore: Readonly<GoreDef> | null,
  level: GoreLevel,
  roll: number,
): GoreOutcome {
  if (level === 'off') return 'vanish';
  if (level === 'reduced') return 'ragdoll';
  // Razzi e granate fanno sempre a pezzi; le altre armi solo con la loro probabilità e da vicino.
  if (kill.explosive) return 'gib';
  if (gore && gore.gibChance > 0 && kill.distance >= 0 && kill.distance <= gore.gibRange && roll < gore.gibChance) {
    return 'gib';
  }
  if (gore?.dismember && kill.part >= 0 && kill.part !== PART_TORSO) return 'dismember';
  return 'ragdoll';
}
