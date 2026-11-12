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
  /** Scossa della visuale: ampiezza massima (radianti) e smorzamento (1/s). */
  shakeAmount: 0.05,
  shakeDecay: 7,
  /** Da morti la telecamera scende a questa altezza e si inclina. */
  deathEyeHeight: 0.45,
  deathRoll: 0.35,
} as const;

/** Arma in prima persona. */
export const VIEWMODEL = {
  /** Campo visivo verticale fisso della scena dell'arma (gradi). */
  fov: 62,
  /** Scala dei modelli in prima persona (i modelli sono in metri reali). */
  scale: 0.5,
  /** Posizione dell'arma al fianco, nello spazio della telecamera. */
  hipPosition: [0.15, -0.16, -0.38] as const,
  kickImpulse: 1.2,
  kickStiffness: 260,
  kickDamping: 28,
  /** Ritardo dell'arma rispetto ai movimenti della visuale. */
  swayAmount: 0.6,
  maxSway: 0.04,
  swaySmoothing: 10,
  /** Oscillazione camminando (m). */
  bobX: 0.012,
  bobY: 0.014,
  /** Durata della fiammata (s). */
  flashTime: 0.05,
  /** Oltre questa mira, con il mirino ottico l'arma sparisce e compare il cannocchiale. */
  scopeThreshold: 0.85,
  /** Durata del fendente del coltello (s). */
  slashTime: 0.3,
  /** Corsa delle parti animate, in metri del modello. */
  slideTravel: 0.035,
  pumpTravel: 0.1,
  boltTravel: 0.1,
  magazineDrop: 0.3,
} as const;

/** Effetti: traccianti, segni sui muri, particelle, bossoli, esplosioni. */
export const EFFECTS = {
  tracerSpeed: 320,
  tracerLength: 2.4,
  maxTracers: 96,
  maxDecals: 220,
  bulletHoleSize: 0.13,
  scorchSize: 1.8,
  maxParticles: 700,
  maxCasings: 48,
  casingLife: 4,
  maxFireballs: 6,
  fireballTime: 0.4,
  muzzleLightIntensity: 10,
  muzzleLightTime: 0.05,
  blastLightIntensity: 45,
  blastLightTime: 0.3,
  /** Entro questa distanza un'esplosione scuote la visuale. */
  shakeRange: 16,
} as const;

/** Personaggi: disegno e scritte. */
export const CHARACTERS = {
  /** Personaggi disegnabili insieme (giocatori, bot e anteprime). */
  maxVisible: 16,
  /** Quanto il colpo subito tinge di rosso il personaggio. */
  hurtTint: 0.55,
  /** Colore delle hitbox mostrate con i dati di debug. */
  hitboxColor: '#ffe14d',
  hurtDecay: 6,
  /** Altezza di nome e barra della vita sopra il centro della testa. */
  labelHeight: 0.45,
  /** Distanza oltre la quale nome e vita non si mostrano. */
  labelRange: 60,
  deathFallTime: 0.35,
  deathSinkDelay: 1.6,
  deathSinkTime: 0.9,
  deathSinkDepth: 0.6,
} as const;

/** Suoni. */
export const AUDIO = {
  /** Distanza a cui un suono posizionale si sente a volume pieno. */
  refDistance: 3,
  maxDistance: 120,
  rolloff: 1.1,
  /** Passi: distanza percorsa tra un passo e l'altro. */
  stepDistance: 2.3,
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

/** Anteprima del personaggio nella schermata di scelta. */
export const PREVIEW = {
  fov: 30,
  cameraHeight: 1.2,
  cameraDistance: 4.4,
  targetHeight: 0.95,
  /** Secondi per ogni animazione mostrata. */
  stepTime: 2.2,
  /** Rotazione (radianti al secondo). */
  turnSpeed: 0.6,
  /** Velocità del passo nella corsa (radianti al secondo). */
  runCycle: 9,
  shotInterval: 0.22,
  /** Altezza del salto mostrato. */
  jumpLift: 0.5,
} as const;
