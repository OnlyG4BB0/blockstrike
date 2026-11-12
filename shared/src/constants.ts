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
  /** Velocità verticale iniziale del salto (circa 1,25 m di altezza). */
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

/** Regole del combattimento. I valori delle singole armi stanno in weapons.ts. */
export const COMBAT = {
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
} as const;

/** Comportamento dei bot. Gli angoli sono in gradi, i tempi in secondi. */
export const BOT = {
  names: ['Rocco', 'Gina', 'Tino', 'Lia', 'Ugo', 'Nina', 'Pino', 'Vera'],
  /** Armi assegnate a turno ai bot (indici in WEAPONS). */
  loadouts: [0, 2, 3, 0, 2, 3, 0, 3],
  /** Distanza preferita in combattimento per arma (m), negli stessi indici di WEAPONS. */
  preferredRange: [18, 30, 6, 12, 20],
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

/** Parametri del sistema di collisioni. */
export const COLLISION = {
  /** Tolleranza per i contatti: due superfici a meno di questa distanza si toccano senza compenetrarsi. */
  epsilon: 1e-4,
  /** Spostamento orizzontale massimo per sotto-passo: impedisce di attraversare i muri sottili. */
  maxSubstep: 0.2,
  /** Lato delle celle della griglia spaziale usata per trovare i blocchi vicini. */
  gridCellSize: 4,
} as const;
