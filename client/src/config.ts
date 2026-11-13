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

/** Squadre: nomi e colori (indice = squadra; 0 = nessuna). */
export const TEAMS = {
  names: ['', 'Rossi', 'Blu'],
  colors: ['#ffffff', '#e2483d', '#3d7be2'],
} as const;

/** Personaggi: disegno e scritte. */
export const CHARACTERS = {
  /** Personaggi disegnabili insieme (giocatori, bot e anteprime). */
  maxVisible: 40,
  /** Quanto il colpo subito tinge di rosso il personaggio. */
  hurtTint: 0.55,
  /** Colore delle hitbox mostrate con i dati di debug. */
  hitboxColor: '#ffe14d',
  hurtDecay: 6,
  /** Altezza di nome e barra della vita sopra il centro della testa. */
  labelHeight: 0.45,
  /** Distanza oltre la quale nome e vita non si mostrano. */
  labelRange: 60,
} as const;

/** Suoni. */
export const AUDIO = {
  /** Distanza a cui un suono posizionale si sente a volume pieno. */
  refDistance: 3,
  /** Istanze inattive tenute pronte per ogni suono (spari rapidi). */
  pool: 12,
  musicVolume: 0.5,
  /** Dissolvenza della musica del menu (ms). */
  musicFade: 900,
  maxDistance: 120,
  rolloff: 1.1,
  /** Passi: distanza percorsa tra un passo e l'altro. */
  stepDistance: 2.3,
} as const;

/** Livelli di qualità grafica. */
export type Quality = 'bassa' | 'media' | 'alta';
export const QUALITIES: readonly Quality[] = ['bassa', 'media', 'alta'];
export const QUALITY: Readonly<
  Record<Quality, { pixelRatio: number; shadows: boolean; shadowMapSize: number; antialias: boolean; particles: number }>
> = {
  bassa: { pixelRatio: 0.75, shadows: false, shadowMapSize: 512, antialias: false, particles: 600 },
  media: { pixelRatio: 1.25, shadows: true, shadowMapSize: 1024, antialias: true, particles: 1200 },
  alta: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, antialias: true, particles: 2000 },
};

/** Minimappa. */
export const MINIMAP = {
  /** Lato in pixel. */
  size: 170,
  /** Metri mostrati dal centro al bordo. */
  range: 34,
  /** Aggiornamenti al secondo. */
  rate: 15,
  /** Un nemico resta sulla mappa per questo tempo dopo aver sparato (s). */
  revealTime: 2.5,
} as const;

/** Indicatore della direzione dei colpi subiti. */
export const DAMAGE_DIRECTION = {
  /** Durata di ogni segnale (s). */
  time: 1.3,
  /** Segnali visibili insieme. */
  count: 4,
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
  /** Durata degli annunci delle uccisioni speciali. */
  announceTime: 1.8,
  /** Schizzi sulla visuale: quanti e per quanto. */
  splatterDrops: 14,
  splatterTime: 2.2,
  /** Righe di chat visibili. */
  chatLines: 7,
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

/** Splatter (Fase 5). Tetti fissi per particelle, macchie e pezzi. */
export const GORE = {
  maxParticles: 2000,
  maxDecals: 150,
  maxPieces: 60,
  maxRagdolls: 12,
  /** Lato in pixel della texture a blocchi delle macchie. */
  splatTexture: 16,
  gravity: 18,
  airDrag: 0.8,
  bloodColors: ['#c4111c', '#9a0b13', '#e01825', '#78070e'],
  sparkColors: ['#fff3b0', '#ffd25a', '#ffffff'],
  // Getti all'impatto.
  hitDroplets: 8,
  dropletsPerDamage: 0.25,
  headshotFactor: 2,
  sprayCone: 0.5,
  spraySpeed: [2, 6] as const,
  headshotSpeed: [3, 8.5] as const,
  sprayLift: 1.2,
  dropletSize: [0.035, 0.075] as const,
  bigDropletChance: 0.12,
  bigDropletSize: 0.11,
  dropletLife: 3,
  killDroplets: 26,
  // Gore spento: scintille.
  sparkCount: 10,
  sparkSpeed: [3, 9] as const,
  sparkSize: 0.04,
  vanishSparks: 40,
  // Macchie e pozze.
  decalChance: 0.5,
  decalSize: [0.22, 0.5] as const,
  decalOffset: 0.012,
  decalLife: 25,
  decalFade: 4,
  decalOpacity: 0.92,
  poolSize: 1.6,
  poolStart: 0.15,
  poolGrowTime: 5,
  poolLife: 35,
  /** Il corpo deve essere fermo da questo tempo perché si formi la pozza. */
  poolDelay: 0.4,
  // Manichini.
  ragdollStep: 1 / 60,
  ragdollIterations: 4,
  ragdollDamping: 0.995,
  ragdollFriction: 0.55,
  ragdollRadius: 0.09,
  ragdollLife: 8,
  ragdollSinkTime: 1.2,
  sinkDepth: 0.6,
  stillThreshold: 0.004,
  hitImpulse: 3.5,
  hitLift: 1.5,
  explosionImpulse: 9,
  explosionLift: 4,
  partImpulseFactor: 2.2,
  impulseJitter: 0.4,
  // Smembramento.
  stumpBleedTime: 2.5,
  stumpRate: 18,
  stumpBurst: 24,
  dismemberSpeed: 6,
  dismemberLift: 3,
  // Corpo a pezzi.
  gibSpeed: [5, 11] as const,
  gibLift: 4,
  gibSpin: 10,
  gibBlood: 90,
  gibBloodSpeed: [3, 10] as const,
  gibChunks: 12,
  chunkSize: [0.07, 0.13] as const,
  chunkLife: 6,
  chunkBounce: 0.3,
  chunkFriction: 0.6,
  chunkSplatSpeed: 2,
  pieceLife: 9,
  pieceBounce: 0.35,
  pieceFriction: 0.75,
  pieceSpinDamping: 0.6,
  pieceSplatSpeed: 2.5,
  pieceRestSpeed: 0.4,
  trailTime: 1.4,
  trailRate: 30,
  /** Uccisioni fatte da più vicino di così sporcano lo schermo. */
  screenSplatterRange: 3.5,
} as const;

/** Controller (Gamepad API, disposizione standard). */
export const GAMEPAD = {
  /** Zona morta delle levette (0..1): sotto, la levetta è ferma. */
  deadzone: 0.18,
  /** Oltre questa spinta (dopo la zona morta) la levetta sinistra muove in quella direzione. */
  moveThreshold: 0.35,
  /** Rotazione a levetta tutta spinta, a sensibilità 1 (radianti al secondo). */
  lookSpeed: 3.4,
  /** Curva della levetta destra: >1 mira fine vicino al centro. */
  lookCurve: 1.8,
  /** La mira verticale è più lenta di quella orizzontale. */
  lookVerticalScale: 0.65,
  /** Spinta che conta come "uso" del controller (per mostrare i suoi tasti). */
  activity: 0.55,
  /** Grilletti: premuti oltre questo valore. */
  trigger: 0.3,
  /** Gli altri tasti (e la croce) contano come premuti oltre questo valore. */
  button: 0.5,
  /** Navigazione nel menu: prima ripetizione e ripetizioni successive (secondi). */
  navDelay: 0.35,
  navRepeat: 0.12,
  navThreshold: 0.6,
  /** Vibrazione quando si viene colpiti (ms e intensità 0..1). */
  rumbleHitMs: 140,
  rumbleHitWeak: 0.35,
  rumbleHitStrong: 0.8,
};

/** Comandi touch sullo schermo. */
export const TOUCH = {
  /** Raggio della levetta virtuale (px CSS). */
  joystickRadius: 58,
  /** Oltre questa frazione del raggio la levetta muove in quella direzione. */
  moveThreshold: 0.32,
  /** Radianti per pixel trascinato, a sensibilità 1 (100 px ≈ 37°). */
  lookRadiansPerPixel: 0.0065,
  /** Accelerazione della visuale: oltre questa velocità del dito (px/ms) il guadagno cresce... */
  lookAccelStart: 0.45,
  /** ...di tanto per ogni px/ms in più... */
  lookAccel: 0.8,
  /** ...fino a questo in più (guadagno massimo 2,2). */
  lookAccelMax: 1.2,
  /** Spostamento del dito (px) oltre il quale un tasto diventa anche visuale. */
  lookFromButton: 10,
  /** Diametro dei tasti (px) consentito nell'editor della disposizione. */
  buttonMin: 36,
  buttonMax: 140,
  /** Vibrazione del telefono quando si viene colpiti (ms). */
  vibrateHitMs: 35,
  /** Tenere premuto il tasto delle armi così a lungo torna all'arma di prima (secondi). */
  longPress: 0.4,
  /** Frazione sinistra dello schermo dove compare la levetta (a destra si guarda intorno). */
  moveZone: 0.45,
  /** Dopo la pausa dal tasto touch si ignora il clic che segue il tocco (ms). */
  clickGuardMs: 450,
};
