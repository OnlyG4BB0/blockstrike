/**
 * Parametri solo visivi del client (non influenzano la simulazione).
 * I valori di gioco stanno in /shared/src/constants.ts.
 */

export const VIEW = {
  nearPlane: 0.05,
  farPlane: 1000,
  maxPixelRatio: 2,
  /** Velocità con cui la visuale insegue gradini, accovacciamenti e gambe raccolte (1/s). */
  eyeSmoothing: 14,
  /** Atterraggio: sotto questa velocità d'impatto nessun sobbalzo. */
  landingMinSpeed: 4,
  /** Atterraggio: spinta verso il basso della visuale per ogni m/s d'impatto oltre il minimo. */
  landingKick: 0.3,
  landingMaxKick: 4,
  /** Molla che riporta la visuale in posizione dopo l'atterraggio. */
  springStiffness: 140,
  springDamping: 24,
  /** Inclinazione laterale della visuale mentre ci si sposta di lato (radianti per m/s). */
  strafeRollPerSpeed: 0.0025,
  maxStrafeRoll: 0.025,
  slideRoll: 0.04,
  rollSmoothing: 10,
  /** Allargamento del campo visivo in velocità (gradi orizzontali). */
  fovBoostMax: 12,
  /** Velocità oltre quella di corsa a cui l'allargamento è massimo (m/s). */
  fovBoostSpeedRange: 14,
  fovSmoothing: 6,
  maxFov: 135,
} as const;

export const RENDER = {
  /** Lato in metri di una ripetizione della texture dei blocchi. */
  textureTileSize: 2,
  textureSize: 32,
  shadowMapSize: 2048,
  skyRadius: 400,
} as const;

export const HUD = {
  /** La barra della velocità è piena a questo multiplo della velocità di corsa. */
  speedBarMaxFactor: 3,
  /** Sopra questi multipli della velocità di corsa il tachimetro cambia colore. */
  fastFactor: 1.15,
  blazingFactor: 1.8,
  fpsInterval: 0.5,
} as const;
