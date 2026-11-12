/**
 * Simulazione del movimento del giocatore.
 *
 * - Deterministica e a passo fisso: stessi input, stesso risultato. Girerà identica sul client
 *   (predizione) e sul server (autorità).
 * - Nessuna allocazione per tick: si lavora su oggetti e array riutilizzati.
 * - Collisioni con box allineati agli assi: il moto orizzontale procede per sotto-passi brevi,
 *   un asse alla volta, così non si attraversano i muri sottili e non ci si incastra negli spigoli.
 */
import { COLLISION, MOVE, PLAYER, TICK_DT } from './constants.ts';
import type { SpawnPoint } from './map.ts';
import { clamp, DEG_TO_RAD } from './math.ts';
import { CollisionWorld, SHAPE_BOX, solidGradX, solidGradZ, solidTopAt, type Solid } from './world.ts';

/** Comandi di un giocatore per un tick. */
export interface PlayerInput {
  /** Rotazione orizzontale dello sguardo (radianti). 0 = verso -z, positivo = verso sinistra. */
  yaw: number;
  /** Rotazione verticale (radianti). Positivo = verso l'alto. */
  pitch: number;
  /** Avanti (1) / indietro (-1). */
  forward: number;
  /** Destra (1) / sinistra (-1). */
  right: number;
  jump: boolean;
  crouch: boolean;
  /** Grilletto premuto. */
  fire: boolean;
  /** Mira (tasto destro) premuta. */
  ads: boolean;
  reload: boolean;
  grenade: boolean;
  /** Arma richiesta (1 = prima posizione); 0 = nessun cambio. */
  weaponSlot: number;
}

export interface PlayerState {
  /** Posizione: centro della pianta, alla quota dei piedi. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouched: boolean;
  sliding: boolean;
  /** Pendenza del suolo su cui si poggia (variazione di quota per metro lungo x e z). */
  groundGradX: number;
  groundGradZ: number;
  /** Tempo residuo in cui un salto premuto verrà ancora eseguito. */
  jumpBuffer: number;
  /** Tempo residuo per saltare dopo aver lasciato un bordo. */
  coyoteTime: number;
  slideBoostCooldown: number;
  prevJump: boolean;
  prevCrouch: boolean;
  /** Moltiplica le velocità massime di corsa (arma impugnata, mira). Lo imposta il sistema di combattimento. */
  speedScale: number;

  // Eventi dell'ultimo tick: servono al client per gli effetti, non influenzano la simulazione.
  /** Spostamento verticale istantaneo (gradini, gambe raccolte in aria): il client lo ammorbidisce. */
  stepDelta: number;
  /** Velocità verticale all'impatto se si è atterrati in questo tick, altrimenti 0. */
  landingSpeed: number;
  jumped: boolean;
  slideStarted: boolean;
}

export function createInput(): PlayerInput {
  return {
    yaw: 0,
    pitch: 0,
    forward: 0,
    right: 0,
    jump: false,
    crouch: false,
    fire: false,
    ads: false,
    reload: false,
    grenade: false,
    weaponSlot: 0,
  };
}

export function createPlayerState(): PlayerState {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    grounded: false,
    crouched: false,
    sliding: false,
    groundGradX: 0,
    groundGradZ: 0,
    jumpBuffer: 0,
    coyoteTime: 0,
    slideBoostCooldown: 0,
    prevJump: false,
    prevCrouch: false,
    speedScale: 1,
    stepDelta: 0,
    landingSpeed: 0,
    jumped: false,
    slideStarted: false,
  };
}

const DEFAULT_STATE: Readonly<PlayerState> = createPlayerState();

export function copyPlayerState(target: PlayerState, source: Readonly<PlayerState>): void {
  Object.assign(target, source);
}

/** Riporta il giocatore allo stato iniziale su un punto di rinascita. */
export function spawnPlayer(p: PlayerState, spawn: SpawnPoint): void {
  Object.assign(p, DEFAULT_STATE);
  p.x = spawn.pos[0];
  p.y = spawn.pos[1];
  p.z = spawn.pos[2];
  p.yaw = spawn.yaw * DEG_TO_RAD;
}

export function playerHeight(p: Readonly<PlayerState>): number {
  return p.crouched ? PLAYER.crouchHeight : PLAYER.height;
}

export function playerEyeHeight(p: Readonly<PlayerState>): number {
  return p.crouched ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
}

export function horizontalSpeed(p: Readonly<PlayerState>): number {
  return Math.hypot(p.vx, p.vz);
}

/** Avanza la simulazione di un tick. */
export function simulateTick(
  p: PlayerState,
  input: Readonly<PlayerInput>,
  world: CollisionWorld,
  dt: number = TICK_DT,
): void {
  p.stepDelta = 0;
  p.landingSpeed = 0;
  p.jumped = false;
  p.slideStarted = false;

  // Input ripuliti: il server non deve mai fidarsi di valori fuori scala.
  p.yaw = finiteOr(input.yaw, p.yaw);
  p.pitch = clamp(finiteOr(input.pitch, p.pitch), -PLAYER.pitchLimit, PLAYER.pitchLimit);
  const forward = clamp(finiteOr(input.forward, 0), -1, 1);
  const right = clamp(finiteOr(input.right, 0), -1, 1);
  const jumpHeld = input.jump === true;
  const crouchHeld = input.crouch === true;

  depenetrate(p, world);

  p.slideBoostCooldown = Math.max(0, p.slideBoostCooldown - dt);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.coyoteTime = Math.max(0, p.coyoteTime - dt);
  if (jumpHeld && !p.prevJump) p.jumpBuffer = MOVE.jumpBuffer;
  const crouchPressed = crouchHeld && !p.prevCrouch;
  p.prevJump = jumpHeld;
  p.prevCrouch = crouchHeld;

  updateCrouch(p, world, crouchHeld);

  // Direzione desiderata sul piano orizzontale.
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  let wishX = -sin * forward + cos * right;
  let wishZ = -cos * forward - sin * right;
  let wishAmount = Math.hypot(wishX, wishZ);
  if (wishAmount > 1e-6) {
    wishX /= wishAmount;
    wishZ /= wishAmount;
    wishAmount = Math.min(wishAmount, 1);
  } else {
    wishX = 0;
    wishZ = 0;
    wishAmount = 0;
  }

  // Salto: da terra, oppure poco dopo aver lasciato un bordo. Il salto avviene prima
  // dell'attrito, quindi saltare appena si tocca terra non fa perdere velocità.
  const wantsJump = p.jumpBuffer > 0 || (MOVE.autoHop && jumpHeld);
  if (wantsJump && (p.grounded || p.coyoteTime > 0)) {
    const carried = p.grounded ? Math.max(0, groundVerticalSpeed(p)) * MOVE.rampJumpFactor : Math.max(0, p.vy);
    p.vy = MOVE.jumpVelocity + carried;
    p.grounded = false;
    p.sliding = false;
    p.coyoteTime = 0;
    p.jumpBuffer = 0;
    p.jumped = true;
    p.groundGradX = 0;
    p.groundGradZ = 0;
  }

  // Scivolata: accovacciarsi mentre si corre veloci.
  if (p.grounded && p.crouched && !p.sliding && crouchPressed && horizontalSpeed(p) >= MOVE.slideMinSpeed) {
    startSlide(p);
  }

  if (p.grounded) groundMove(p, world, wishX, wishZ, wishAmount, dt);
  else airMove(p, world, wishX, wishZ, wishAmount, crouchHeld, dt);
}

// ---------------------------------------------------------------------------------------------
// Movimento a terra e in aria
// ---------------------------------------------------------------------------------------------

function groundMove(
  p: PlayerState,
  world: CollisionWorld,
  wishX: number,
  wishZ: number,
  wishAmount: number,
  dt: number,
): void {
  if (p.sliding) {
    applySlideFriction(p, MOVE.slideFriction, dt);
    // In discesa la gravità spinge lungo la pendenza, in salita frena.
    const gx = p.groundGradX;
    const gz = p.groundGradZ;
    const k2 = gx * gx + gz * gz;
    if (k2 > 0) {
      const a = (MOVE.gravity * MOVE.slideGravityScale) / (1 + k2);
      p.vx -= gx * a * dt;
      p.vz -= gz * a * dt;
    }
    const runSpeed = MOVE.runSpeed * p.speedScale;
    airAccelerate(p, wishX, wishZ, runSpeed * wishAmount, MOVE.slideSteerAccel, MOVE.slideSteerCap, dt);
    if (horizontalSpeed(p) < MOVE.slideEndSpeed) p.sliding = false;
  } else {
    applyFriction(p, MOVE.groundFriction, dt);
    const maxSpeed = (p.crouched ? MOVE.crouchSpeed : MOVE.runSpeed) * p.speedScale;
    accelerate(p, wishX, wishZ, maxSpeed * wishAmount, MOVE.groundAccel, dt);
  }
  limitHorizontalSpeed(p);

  p.vy = 0;
  // Velocità verticale che si avrebbe seguendo il suolo: se si lascia la cima di una rampa, lancia.
  const launchVy = groundVerticalSpeed(p);
  moveHorizontal(p, world, p.vx * dt, p.vz * dt, MOVE.stepHeight);

  // Resta attaccato al suolo in discesa (rampe, scale), altrimenti si è in aria.
  probeFloor(world, p.x, p.y, p.z, floorHit);
  const gap = floorHit.found ? p.y - floorHit.height : Infinity;
  if (gap <= MOVE.groundSnap) {
    if (floorHit.isBox && gap > EPS) p.stepDelta -= gap;
    p.y = floorHit.height;
    p.groundGradX = floorHit.gradX;
    p.groundGradZ = floorHit.gradZ;
    return;
  }
  p.grounded = false;
  p.sliding = false;
  p.vy = launchVy;
  p.coyoteTime = MOVE.coyoteTime;
  p.groundGradX = 0;
  p.groundGradZ = 0;
}

function airMove(
  p: PlayerState,
  world: CollisionWorld,
  wishX: number,
  wishZ: number,
  wishAmount: number,
  crouchHeld: boolean,
  dt: number,
): void {
  const runSpeed = MOVE.runSpeed * p.speedScale;
  if (horizontalSpeed(p) < runSpeed) {
    accelerate(p, wishX, wishZ, runSpeed * wishAmount, MOVE.airDriveAccel, dt);
  }
  airAccelerate(p, wishX, wishZ, runSpeed * wishAmount, MOVE.airAccel, MOVE.airSpeedCap, dt);
  limitHorizontalSpeed(p);
  p.vy = Math.max(p.vy - MOVE.gravity * dt, -MOVE.maxFallSpeed);

  moveHorizontal(p, world, p.vx * dt, p.vz * dt, MOVE.airStepHeight);
  const impactSpeed = -p.vy;
  if (!moveVertical(p, world, p.vy * dt)) return;

  p.grounded = true;
  p.vy = 0;
  p.coyoteTime = 0;
  p.landingSpeed = Math.max(0, impactSpeed);
  p.groundGradX = floorHit.gradX;
  p.groundGradZ = floorHit.gradZ;
  // Atterrare accovacciati in velocità fa partire una scivolata.
  if (p.crouched && crouchHeld && horizontalSpeed(p) >= MOVE.slideMinSpeed) startSlide(p);
}

function startSlide(p: PlayerState): void {
  p.sliding = true;
  p.slideStarted = true;
  if (p.slideBoostCooldown > 0) return;
  const speed = horizontalSpeed(p);
  if (speed < 1e-4) return;
  const target = Math.max(speed, Math.min(speed + MOVE.slideBoost, MOVE.slideBoostMaxSpeed));
  p.vx *= target / speed;
  p.vz *= target / speed;
  p.slideBoostCooldown = MOVE.slideBoostCooldown;
}

/** Accovacciarsi e rialzarsi. In aria si raccolgono le gambe: i piedi salgono, la testa resta ferma. */
function updateCrouch(p: PlayerState, world: CollisionWorld, wantCrouch: boolean): void {
  const legs = PLAYER.height - PLAYER.crouchHeight;
  if (wantCrouch) {
    if (p.crouched) return;
    p.crouched = true;
    if (!p.grounded) {
      p.y += legs;
      p.stepDelta += legs;
    }
    return;
  }
  if (!p.crouched) return;

  if (p.grounded) {
    if (canFit(world, p.x, p.y, p.z, PLAYER.height)) {
      p.crouched = false;
      p.sliding = false;
    }
    return;
  }
  // In aria: riabbassa le gambe, ma non dentro il pavimento.
  probeFloor(world, p.x, p.y, p.z, floorHit);
  const target = floorHit.found ? Math.max(p.y - legs, floorHit.height) : p.y - legs;
  if (canFit(world, p.x, target, p.z, PLAYER.height)) {
    p.stepDelta += target - p.y;
    p.y = target;
    p.crouched = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Accelerazione e attrito (modello stile Quake)
// ---------------------------------------------------------------------------------------------

function applyFriction(p: PlayerState, friction: number, dt: number): void {
  const speed = horizontalSpeed(p);
  if (speed < 1e-4) {
    p.vx = 0;
    p.vz = 0;
    return;
  }
  const control = Math.max(speed, MOVE.stopSpeed);
  const k = Math.max(0, speed - control * friction * dt) / speed;
  p.vx *= k;
  p.vz *= k;
}

function applySlideFriction(p: PlayerState, deceleration: number, dt: number): void {
  const speed = horizontalSpeed(p);
  if (speed < 1e-4) return;
  const k = Math.max(0, speed - deceleration * dt) / speed;
  p.vx *= k;
  p.vz *= k;
}

function accelerate(p: PlayerState, wishX: number, wishZ: number, wishSpeed: number, accel: number, dt: number): void {
  if (wishSpeed <= 0) return;
  const add = wishSpeed - (p.vx * wishX + p.vz * wishZ);
  if (add <= 0) return;
  const amount = Math.min(accel * wishSpeed * dt, add);
  p.vx += wishX * amount;
  p.vz += wishZ * amount;
}

/**
 * Accelerazione in aria: si può aggiungere al massimo `cap` lungo la direzione desiderata.
 * Spingendo quasi di lato rispetto al moto la componente lungo `wish` resta piccola e la
 * velocità totale cresce: è lo strafe.
 */
function airAccelerate(
  p: PlayerState,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  cap: number,
  dt: number,
): void {
  if (wishSpeed <= 0) return;
  const add = Math.min(wishSpeed, cap) - (p.vx * wishX + p.vz * wishZ);
  if (add <= 0) return;
  const amount = Math.min(accel * wishSpeed * dt, add);
  p.vx += wishX * amount;
  p.vz += wishZ * amount;
}

function limitHorizontalSpeed(p: PlayerState): void {
  const speed = horizontalSpeed(p);
  if (speed <= MOVE.maxSpeed) return;
  const k = MOVE.maxSpeed / speed;
  p.vx *= k;
  p.vz *= k;
}

function groundVerticalSpeed(p: Readonly<PlayerState>): number {
  return p.vx * p.groundGradX + p.vz * p.groundGradZ;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------------------------
// Collisioni
// ---------------------------------------------------------------------------------------------

const EPS = COLLISION.epsilon;
const R = PLAYER.radius;

/** Array riutilizzati per le interrogazioni della griglia. */
const moveCandidates: number[] = [];
const probeCandidates: number[] = [];

interface FloorHit {
  found: boolean;
  height: number;
  gradX: number;
  gradZ: number;
  isBox: boolean;
}

const floorHit: FloorHit = { found: false, height: 0, gradX: 0, gradZ: 0, isBox: true };

function setAxis(p: PlayerState, axis: 0 | 2, value: number): void {
  if (axis === 0) p.x = value;
  else p.z = value;
}

function stopAxis(p: PlayerState, axis: 0 | 2): void {
  if (axis === 0) p.vx = 0;
  else p.vz = 0;
}

function overlapsXZ(s: Solid, x: number, z: number): boolean {
  return s.minX < x + R - EPS && s.maxX > x - R + EPS && s.minZ < z + R - EPS && s.maxZ > z - R + EPS;
}

/** Il solido compenetra il corpo del giocatore (piedi a quota y, altezza h)? */
function overlapsBody(s: Solid, x: number, y: number, z: number, h: number): boolean {
  if (!overlapsXZ(s, x, z)) return false;
  if (s.minY >= y + h - EPS) return false;
  return solidTopAt(s, x, z) > y + EPS;
}

/** C'è spazio per un corpo alto h con i piedi in (x, y, z)? */
export function canFit(world: CollisionWorld, x: number, y: number, z: number, h: number): boolean {
  const n = world.query(x - R, z - R, x + R, z + R, probeCandidates);
  for (let i = 0; i < n; i++) {
    if (overlapsBody(world.solids[probeCandidates[i]!]!, x, y, z, h)) return false;
  }
  return true;
}

/** Trova il pavimento più alto sotto i piedi (a quota y o più in basso). */
function probeFloor(world: CollisionWorld, x: number, y: number, z: number, out: FloorHit): FloorHit {
  out.found = false;
  out.height = -Infinity;
  out.gradX = 0;
  out.gradZ = 0;
  out.isBox = true;
  let bestSlope = Infinity;
  const n = world.query(x - R, z - R, x + R, z + R, probeCandidates);
  for (let i = 0; i < n; i++) {
    const s = world.solids[probeCandidates[i]!]!;
    if (!overlapsXZ(s, x, z)) continue;
    const top = solidTopAt(s, x, z);
    if (top > y + EPS) continue;
    const gx = solidGradX(s);
    const gz = solidGradZ(s);
    const slope = gx * gx + gz * gz;
    // A parità di quota si preferisce il suolo più piano (es. cima di una rampa su una piattaforma).
    if (top > out.height + EPS || (top >= out.height - EPS && slope < bestSlope)) {
      out.found = true;
      out.height = top;
      out.gradX = gx;
      out.gradZ = gz;
      out.isBox = s.shape === SHAPE_BOX;
      bestSlope = slope;
    }
  }
  return out;
}

/** Quota del soffitto più basso sopra la testa. */
function probeCeiling(world: CollisionWorld, x: number, z: number, headY: number): number {
  let ceiling = Infinity;
  const n = world.query(x - R, z - R, x + R, z + R, probeCandidates);
  for (let i = 0; i < n; i++) {
    const s = world.solids[probeCandidates[i]!]!;
    if (!overlapsXZ(s, x, z)) continue;
    if (s.minY >= headY - EPS && s.minY < ceiling) ceiling = s.minY;
  }
  return ceiling;
}

/** Moto orizzontale a sotto-passi: ogni sotto-passo sposta al massimo `maxSubstep` per asse. */
function moveHorizontal(p: PlayerState, world: CollisionWorld, dx: number, dz: number, stepHeight: number): void {
  const distance = Math.max(Math.abs(dx), Math.abs(dz));
  if (distance === 0) return;
  const steps = Math.max(1, Math.ceil(distance / COLLISION.maxSubstep));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && p.vx !== 0) moveAxis(p, world, 0, sx, stepHeight);
    if (sz !== 0 && p.vz !== 0) moveAxis(p, world, 2, sz, stepHeight);
  }
}

/**
 * Sposta il giocatore lungo un asse. Un ostacolo più alto di `stepHeight` è un muro e ferma il
 * giocatore sulla sua faccia; uno più basso è un gradino e viene scavalcato se sopra c'è spazio.
 */
function moveAxis(p: PlayerState, world: CollisionWorld, axis: 0 | 2, delta: number, stepHeight: number): void {
  const h = playerHeight(p);
  const start = axis === 0 ? p.x : p.z;
  setAxis(p, axis, start + delta);

  // 1) Muri: ci si ferma sulla faccia del primo muro incontrato.
  let n = world.query(p.x - R, p.z - R, p.x + R, p.z + R, moveCandidates);
  let blocked = false;
  let limit = delta > 0 ? Infinity : -Infinity;
  for (let i = 0; i < n; i++) {
    const s = world.solids[moveCandidates[i]!]!;
    if (!overlapsBody(s, p.x, p.y, p.z, h)) continue;
    if (solidTopAt(s, p.x, p.z) - p.y <= stepHeight) continue;
    blocked = true;
    if (delta > 0) limit = Math.min(limit, (axis === 0 ? s.minX : s.minZ) - R);
    else limit = Math.max(limit, (axis === 0 ? s.maxX : s.maxZ) + R);
  }
  if (blocked) {
    // Mai tornare indietro oltre il punto di partenza.
    setAxis(p, axis, delta > 0 ? Math.max(start, limit) : Math.min(start, limit));
    stopAxis(p, axis);
  }

  // 2) Gradini: si sale sul punto più alto ancora compenetrato.
  n = world.query(p.x - R, p.z - R, p.x + R, p.z + R, moveCandidates);
  let stepTop = -Infinity;
  let stepIsBox = false;
  for (let i = 0; i < n; i++) {
    const s = world.solids[moveCandidates[i]!]!;
    if (!overlapsBody(s, p.x, p.y, p.z, h)) continue;
    const top = solidTopAt(s, p.x, p.z);
    if (top > stepTop) {
      stepTop = top;
      stepIsBox = s.shape === SHAPE_BOX;
    }
  }
  if (stepTop === -Infinity) return;
  if (stepTop - p.y <= stepHeight && canFit(world, p.x, stepTop, p.z, h)) {
    if (stepIsBox) p.stepDelta += stepTop - p.y;
    p.y = stepTop;
    return;
  }
  // Gradino senza spazio sopra: si comporta come un muro.
  setAxis(p, axis, start);
  stopAxis(p, axis);
}

/** Moto verticale esatto: si atterra sul primo pavimento o si sbatte sul primo soffitto. */
function moveVertical(p: PlayerState, world: CollisionWorld, dy: number): boolean {
  if (dy < 0) {
    probeFloor(world, p.x, p.y, p.z, floorHit);
    const target = p.y + dy;
    if (floorHit.found && target <= floorHit.height) {
      p.y = floorHit.height;
      return true;
    }
    p.y = target;
    return false;
  }
  if (dy > 0) {
    const h = playerHeight(p);
    const ceiling = probeCeiling(world, p.x, p.z, p.y + h);
    if (p.y + h + dy >= ceiling) {
      p.y = Math.max(p.y, ceiling - h);
      p.vy = 0;
    } else {
      p.y += dy;
    }
  }
  return false;
}

/** Se il giocatore si trova dentro un solido (es. punto di rinascita sbagliato), lo spinge fuori. */
function depenetrate(p: PlayerState, world: CollisionWorld): void {
  for (let iteration = 0; iteration < 4; iteration++) {
    const h = playerHeight(p);
    const n = world.query(p.x - R, p.z - R, p.x + R, p.z + R, moveCandidates);
    let pushed = false;
    for (let i = 0; i < n && !pushed; i++) {
      const s = world.solids[moveCandidates[i]!]!;
      if (!overlapsBody(s, p.x, p.y, p.z, h)) continue;
      const up = solidTopAt(s, p.x, p.z) - p.y;
      const down = p.y + h - s.minY;
      const toNegX = p.x + R - s.minX;
      const toPosX = s.maxX - (p.x - R);
      const toNegZ = p.z + R - s.minZ;
      const toPosZ = s.maxZ - (p.z - R);
      const best = Math.min(up, down, toNegX, toPosX, toNegZ, toPosZ);
      if (best === up) p.y += up;
      else if (best === toNegX) p.x -= toNegX;
      else if (best === toPosX) p.x += toPosX;
      else if (best === toNegZ) p.z -= toNegZ;
      else if (best === toPosZ) p.z += toPosZ;
      else p.y -= down;
      pushed = true;
    }
    if (!pushed) return;
  }
}
