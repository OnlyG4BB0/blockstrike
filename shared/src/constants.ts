/**
 * Costanti di gioco condivise da client e server.
 * Tutti i valori di bilanciamento del movimento stanno qui: niente numeri magici nel codice di gioco.
 * Unità: metri, secondi, radianti.
 */

/** Frequenza fissa della simulazione (tick al secondo). */
export const TICK_RATE = 60;
/** Durata di un tick in secondi. */
export const TICK_DT = 1 / TICK_RATE;

/** Dimensioni del giocatore. La posizione del giocatore è il centro della pianta, alla quota dei piedi. */
export const PLAYER = {
  /** Metà del lato del box di collisione (il box è quadrato in pianta). */
  radius: 0.4,
  /** Altezza in piedi. */
  height: 1.8,
  /** Altezza da accovacciato o in scivolata. */
  crouchHeight: 1.2,
  /** Altezza degli occhi in piedi, misurata dai piedi. */
  eyeHeight: 1.6,
  /** Altezza degli occhi da accovacciato. */
  crouchEyeHeight: 1.0,
  /** Limite della visuale verso l'alto e verso il basso. */
  pitchLimit: (89 * Math.PI) / 180,
} as const;

/** Parametri del movimento. */
export const MOVE = {
  /** Accelerazione di gravità (m/s²). Più alta del reale per salti rapidi e precisi. */
  gravity: 22,
  /** Velocità verticale iniziale del salto (circa 1,25 m di altezza). Le classi la ricalcolano. */
  jumpVelocity: 7.4,
  /** Velocità massima di caduta. */
  maxFallSpeed: 55,

  /** Velocità massima di corsa a terra. */
  runSpeed: 7.5,
  /** Velocità massima da accovacciato. */
  crouchSpeed: 3.2,
  /** Accelerazione a terra (moltiplica la velocità desiderata, stile Quake). */
  groundAccel: 10,
  /** Attrito a terra. */
  groundFriction: 6,
  /** Sotto questa velocità l'attrito agisce come se si andasse a questa velocità: fermata netta. */
  stopSpeed: 2.5,

  /** Accelerazione in aria. */
  airAccel: 14,
  /**
   * Velocità massima guadagnabile in aria lungo la direzione desiderata.
   * È il limite che rende possibile lo strafe: si guadagna velocità solo spingendo
   * quasi di lato rispetto al moto, girando la visuale nella stessa direzione.
   */
  airSpeedCap: 0.9,
  /**
   * Sotto la velocità di corsa, in aria si accelera verso la direzione desiderata come a terra
   * ma più piano: tenere avanti mentre si salta porta comunque alla velocità di corsa.
   * Oltre quella velocità si guadagna solo con lo strafe.
   */
  airDriveAccel: 2,

  /** Altezza massima di un gradino superato automaticamente a terra. */
  stepHeight: 0.55,
  /** Altezza massima superata automaticamente in aria (bordi presi al volo). */
  airStepHeight: 0.3,
  /** Distanza massima entro cui il giocatore resta attaccato al suolo in discesa. */
  groundSnap: 0.6,

  /** Un salto premuto poco prima di toccare terra viene eseguito all'atterraggio. */
  jumpBuffer: 0.1,
  /** Tempo per saltare dopo aver lasciato un bordo camminando. */
  coyoteTime: 0.08,
  /** Tenere premuto salto fa saltare di nuovo appena si tocca terra. */
  autoHop: true,
  /** Moltiplica la velocità verticale presa da una rampa quando si salta in salita. */
  rampJumpFactor: 1,

  /** Velocità orizzontale minima per iniziare una scivolata. */
  slideMinSpeed: 5.5,
  /** Spinta data all'inizio della scivolata. */
  slideBoost: 2.5,
  /** La spinta non porta oltre questa velocità (se si va già più veloci, nessuna spinta). */
  slideBoostMaxSpeed: 12.5,
  /** Tempo minimo tra due spinte da scivolata. */
  slideBoostCooldown: 0.6,
  /** Decelerazione costante durante la scivolata (m/s²). */
  slideFriction: 7,
  /** Sotto questa velocità la scivolata finisce. */
  slideEndSpeed: 3.6,
  /** Moltiplicatore della gravità lungo le pendenze durante la scivolata: in discesa si accelera. */
  slideGravityScale: 1.5,
  /** Sterzata durante la scivolata. */
  slideSteerAccel: 10,
  slideSteerCap: 0.6,

  /** Limite di sicurezza della velocità orizzontale, contro valori fuori controllo. */
  maxSpeed: 60,
} as const;

/**
 * Proporzioni del personaggio a blocchi e ampiezze delle animazioni. Il modello disegnato e le
 * hitbox nascono dagli stessi numeri (vedi pose.ts). Metri e radianti.
 *
 * Da fermi in piedi e da accovacciati le parti coincidono con le hitbox delle fasi precedenti:
 * testa 0,34 m sopra il collo, busto 0,6 m (0,46 accovacciati), gambe 0,86 m (0,4 accovacciati).
 */
export const BODY = {
  /** Il collo sta sempre sotto il punto degli occhi: la testa contiene sempre la visuale. */
  neckBelowEye: 0.14,
  headHalf: 0.17,
  torsoLength: 0.6,
  crouchTorsoLength: 0.46,
  torsoHalfWidth: 0.25,
  torsoHalfDepth: 0.14,
  /** Distanza delle spalle dal centro. */
  shoulderX: 0.34,
  /** Giunto delle braccia che reggono l'arma, sotto la cima del busto. */
  shoulderBelowTop: 0.06,
  armHalfWidth: 0.09,
  armHalfDepth: 0.1,
  /** Lunghezza di un braccio libero (mano sinistra staccata dall'arma). */
  freeArmLength: 0.58,
  hipHalfWidth: 0.12,
  legHalfWidth: 0.11,
  legHalfDepth: 0.12,
  legLength: 0.86,
  crouchLegLength: 0.4,
  /** Da accovacciati le gambe piegate sporgono in avanti. */
  crouchLegHalfDepth: 0.21,
  crouchKneeForward: 0.09,
  /** Origine della mira (braccia e arma ruotano attorno a qui), sotto il collo. */
  aimBelowNeck: 0.08,
  /** Posizione dell'arma nello spazio della mira (x a destra, y in alto, z indietro). */
  weaponOffset: [0.1, -0.05, -0.2],
  /** Mano sinistra durante la ricarica, nello spazio dell'arma (verso il caricatore). */
  reloadHand: [-0.02, -0.16, -0.08],

  /** Frazione dell'inclinazione della mira seguita dal busto (il resto lo fanno testa e braccia). */
  torsoPitchFollow: 0.25,
  runLean: 0.14,
  slideLean: 0.6,
  strafeLean: 0.1,
  flinchLean: 0.22,
  flinchHead: 0.25,
  runLegSwing: 0.75,
  runArmSwing: 0.6,
  jumpLegForward: 0.55,
  jumpLegBack: 0.3,
  fallLegForward: 0.2,
  fallLegSpread: 0.14,
  slideLegSpread: 0.08,
  fireKickPitch: 0.1,
  fireKickBack: 0.06,
  meleeSwingPitch: 1.1,
  meleeThrust: 0.25,
  /** Arma abbassata appena estratta, in corsa e in ricarica. */
  drawLower: 0.9,
  carryLower: 0.45,
  reloadLower: 0.25,
  reloadRoll: 0.5,
  /** In corsa con l'arma abbassata la mano destra va avanti e indietro (m). */
  carryPump: 0.05,
  runBob: 0.025,
  breath: 0.008,
} as const;

/** Velocità con cui cambiano i pesi delle animazioni (1/s) e altri tempi delle animazioni. */
export const ANIM = {
  crouchRate: 16,
  slideRate: 12,
  airRate: 10,
  fallRate: 8,
  /** Sotto questa velocità verticale si passa dalla posa di salto a quella di caduta. */
  fallSpeed: -1.5,
  runRate: 10,
  leanRate: 6,
  readyRate: 8,
  /** Dopo un colpo l'arma resta alzata per questo tempo. */
  readyHold: 0.6,
  fireDecay: 12,
  swingDecay: 6,
  reloadRate: 10,
  flinchDecay: 5,
  /** Metri percorsi per un ciclo completo del passo. */
  strideLength: 2.4,
  breathPeriod: 3,
  /** L'orologio del respiro riparte da zero dopo questo tempo (multiplo del periodo). */
  clockWrap: 60,
} as const;

/** Regole del combattimento. I valori delle singole armi stanno in weapons.ts. */
export const COMBAT = {
  /** Vita di chi non ha una classe (le classi hanno la loro). */
  maxHealth: 100,
  /** Secondi tra la morte e la rinascita. */
  respawnTime: 3,
  /** Invulnerabilità dopo la rinascita; finisce prima se si spara. */
  spawnProtection: 1.5,
  /** Gittata massima dei colpi istantanei (m). */
  hitscanRange: 300,
  /** Dopo questo tempo senza sparare la dispersione accumulata inizia a calare. */
  bloomRecoveryDelay: 0.12,
  /** Dopo questo tempo senza sparare lo schema di rinculo riparte dal primo colpo. */
  recoilResetTime: 0.35,
  /** Numero massimo di razzi e granate in volo. */
  maxProjectiles: 64,
  /** Componente verso l'alto aggiunta alla spinta delle esplosioni: rende possibili i salti con i razzi. */
  explosionUpwardBias: 0.35,
  /** Distanza dagli occhi a cui nascono razzi e granate. */
  projectileSpawnDistance: 0.5,
  /** Uccisioni entro questo tempo l'una dall'altra contano come doppietta, tripletta... */
  multiKillWindow: 3,
} as const;

/** Comportamento dei bot. Gli angoli sono in gradi, i tempi in secondi. */
export const BOT = {
  names: ['Rocco', 'Gina', 'Tino', 'Lia', 'Ugo', 'Nina', 'Pino', 'Vera', 'Ezio', 'Bice', 'Dario', 'Olga'],
  sightRange: 70,
  /** Metà dell'angolo di visuale: fuori da questo cono un nemico lontano non viene notato. */
  fieldOfView: 100,
  /** Entro questa distanza un nemico viene notato anche alle spalle. */
  hearingRange: 8,
  perceptionInterval: 0.1,
  reactionMin: 0.35,
  reactionMax: 0.7,
  /** Errore di mira iniziale massimo quando si vede un nuovo nemico. */
  initialAimError: 7,
  /** Velocità con cui l'errore di mira si riduce (1/s). */
  aimSettleRate: 1.6,
  /** Tremolio continuo della mira. */
  aimJitter: 0.5,
  /** Velocità massima di rotazione (radianti al secondo). */
  turnRate: 7,
  /** Si spara solo se la mira è entro questo angolo dal bersaglio. */
  fireCone: 5,
  /** Probabilità di mirare alla testa invece che al busto. */
  headAimChance: 0.25,
  burstMin: 0.25,
  burstMax: 0.6,
  pauseMin: 0.2,
  pauseMax: 0.5,
  /** Pausa tra due colpi delle armi semiautomatiche. */
  semiDelayMin: 0.15,
  semiDelayMax: 0.4,
  strafeMin: 0.4,
  strafeMax: 1.2,
  jumpChancePerSecond: 0.35,
  /** Tempo per cui un bot colpito si gira verso chi lo ha colpito. */
  investigateTime: 1.5,
  /** Distanza a cui un punto di navigazione si considera raggiunto. */
  waypointReach: 1.3,
  /** Ogni quanto si controlla se il bot è bloccato, e di quanto deve essersi spostato. */
  stuckCheckInterval: 1,
  stuckMinProgress: 0.6,
  /** Dopo questo tempo bloccato si sceglie un altro percorso. */
  giveUpTime: 3,
  /** Lunghezza massima di un collegamento tra punti di navigazione. */
  navLinkMaxLength: 24,
} as const;

/** Grafo di navigazione calcolato dalla geometria (mappe senza punti di navigazione). */
export const NAV = {
  /**
   * Lato della griglia dei punti (m): fitta sulle strutture (rampe e piattaforme strette hanno i
   * loro punti), il doppio sul pavimento più basso.
   */
  spacing: 2,
  /** Un collegamento vale se una camminata simulata arriva entro questa distanza dal punto. */
  arriveRadius: 0.8,
  /** Tempo massimo della camminata di prova (s). */
  walkTime: 2.5,
  /** Collegamenti solo tra punti vicini (in celle della griglia). */
  neighborCells: 2,
  /** Oltre questo dislivello in salita si tiene premuto il salto nella camminata di prova. */
  jumpRise: 0.4,
} as const;

/** Parametri del sistema di collisioni. */
export const COLLISION = {
  /** Tolleranza per i contatti: due superfici a meno di questa distanza si toccano senza compenetrarsi. */
  epsilon: 1e-4,
  /** Spostamento orizzontale massimo per sotto-passo: impedisce di attraversare i muri sottili. */
  maxSubstep: 0.2,
  /** Lato delle celle della griglia spaziale usata per trovare i blocchi vicini. */
  gridCellSize: 4,
} as const;

/** Rete (Fase 6). Tempi in tick di simulazione (60 al secondo). */
export const NET = {
  /** Ogni quanti tick il server invia lo stato: 2 = 30 volte al secondo. */
  snapshotInterval: 2,
  /** Gli altri giocatori si vedono così indietro nel tempo (6 tick = 100 ms), interpolando. */
  interpolationDelay: 6,
  /** Latenza compensata al massimo quando il server riavvolge le hitbox (12 tick = 200 ms). */
  maxRewind: 12,
  /** Storia delle pose tenuta dal server per riavvolgere (tick). */
  historyTicks: 64,
  /** Comandi elaborati al massimo per tick e in coda per giocatore. */
  inputsPerTick: 3,
  maxQueuedInputs: 30,
  /** Comandi accettati in più rispetto ai tick passati (scatti di rete): oltre, si scartano. */
  inputBurst: 12,
  /** Correzione dell'orologio del client verso quello del server, per ogni pacchetto. */
  clockCorrection: 0.05,
  /** Oltre questo scarto (tick) l'orologio del client salta direttamente al valore del server. */
  clockSnap: 12,
  /** Giocatori per stanza. */
  maxPlayers: 12,
  /** Lunghezza massima di nomi e messaggi della chat. */
  maxName: 16,
  maxChat: 120,
  /** Messaggi di chat al massimo ogni questi secondi. */
  chatInterval: 0.7,
} as const;

/** Regole delle modalità online: tempo (s), punteggio per vincere, durata della schermata finale. */
export const MATCH_RULES = {
  ffa: { timeLimit: 480, scoreLimit: 25 },
  tdm: { timeLimit: 600, scoreLimit: 50 },
  ctf: { timeLimit: 600, scoreLimit: 3 },
  /** Secondi di schermata finale prima della partita successiva. */
  endScreen: 10,
  /** Combattenti minimi in una stanza: i bot riempiono i posti vuoti. */
  fillTo: 6,
  /** Cattura la bandiera: distanza per prenderla o portarla alla base, ritorno automatico. */
  flagReach: 1.4,
  flagReturnTime: 20,
} as const;
