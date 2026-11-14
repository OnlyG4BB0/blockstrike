/**
 * Animazione e posa del corpo, uguali su client e server.
 *
 * Lo stato dell'animazione (AnimState) avanza a passo fisso insieme alla simulazione, a partire dallo
 * stato del giocatore e dell'arma: corsa, salto, caduta, accovacciamento, scivolata, sparo, ricarica,
 * estrazione dell'arma, colpo subito. I pesi cambiano in modo continuo, così le pose si mescolano
 * senza scatti. È una struttura piatta di numeri: si copia, si interpola e (Fase 6) si invia in rete.
 *
 * La posa (BodyPose) è una funzione pura dello stato dell'animazione: sei box orientati (testa,
 * busto, due braccia, due gambe) più la posizione dell'arma in mano. Il client la usa per disegnare
 * il personaggio, la simulazione per i colpi: ciò che si vede è ciò che si colpisce.
 *
 * La catena parte dal collo, che sta sempre sotto il punto degli occhi: la testa contiene sempre il
 * punto da cui il giocatore guarda e spara, a qualunque inclinazione della mira. Il busto pende dal
 * collo, le gambe partono dal bacino, le braccia vanno dalle spalle all'impugnatura dell'arma.
 *
 * Coordinate del personaggio: x a destra, y in alto dai piedi, z verso la schiena (guarda verso -z).
 */
import { ANIM, BODY, MOVE, PLAYER } from './constants.ts';
import type { WeaponModelDef } from './content.ts';
import { clamp } from './math.ts';
import type { PlayerState } from './player.ts';
import type { WeaponDef } from './weapons.ts';

export type HitRegion = 'head' | 'torso' | 'arm' | 'leg';

export const PART_HEAD = 0;
export const PART_TORSO = 1;
export const PART_ARM_LEFT = 2;
export const PART_ARM_RIGHT = 3;
export const PART_LEG_LEFT = 4;
export const PART_LEG_RIGHT = 5;
export const PART_COUNT = 6;
export const PART_NAMES = ['head', 'torso', 'armLeft', 'armRight', 'legLeft', 'legRight'] as const;
export type PartName = (typeof PART_NAMES)[number];
export const PART_REGIONS: readonly HitRegion[] = ['head', 'torso', 'arm', 'arm', 'leg', 'leg'];

const TWO_PI = Math.PI * 2;

// -----------------------------------------------------------------------------------------------
// Stato dell'animazione
// -----------------------------------------------------------------------------------------------

export interface AnimState {
  /** Posizione dei piedi e sguardo, copiati dal giocatore. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Arma in mano (indice nell'elenco delle armi della partita); -1 = mani libere. */
  weapon: number;
  /** Pesi da 0 a 1. */
  crouch: number;
  slide: number;
  air: number;
  /** In aria: 0 = salita (posa di salto), 1 = discesa (posa di caduta). */
  fall: number;
  /** Corsa: cresce con la velocità a terra. */
  run: number;
  /** Fase del passo (radianti, da 0 a 2π). */
  phase: number;
  /** Spostamento laterale: da -1 (verso sinistra) a 1 (verso destra). */
  lean: number;
  /** 1 se si cammina all'indietro: i passi vanno al contrario e il busto non si piega in avanti. */
  back: number;
  /** Arma pronta (mira, sparo recente, ricarica). Con 0, in corsa l'arma si abbassa. */
  ready: number;
  /** Contraccolpo dell'ultimo colpo: 1 appena sparato, poi cala. */
  fire: number;
  /** Avanzamento della ricarica (da 0 a 1) e peso della posa di ricarica. */
  reload: number;
  reloadWeight: number;
  /** Arma appena cambiata: 1 = ancora da estrarre, 0 = pronta. */
  draw: number;
  /** Sussulto per un colpo subito. */
  flinch: number;
  /** Orologio del respiro da fermi (secondi, ciclico). */
  clock: number;
}

export function createAnimState(): AnimState {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    weapon: -1,
    crouch: 0,
    slide: 0,
    air: 0,
    fall: 0,
    run: 0,
    phase: 0,
    lean: 0,
    back: 0,
    ready: 0,
    fire: 0,
    reload: 0,
    reloadWeight: 0,
    draw: 0,
    flinch: 0,
    clock: 0,
  };
}

export function copyAnimState(target: AnimState, source: Readonly<AnimState>): void {
  Object.assign(target, source);
}

/** Posizione e sguardo dal giocatore, senza far avanzare l'animazione (per esempio dopo un teletrasporto). */
export function syncAnimPosition(a: AnimState, p: Readonly<PlayerState>): void {
  a.x = p.x;
  a.y = p.y;
  a.z = p.z;
  a.yaw = p.yaw;
  a.pitch = p.pitch;
}

/** Riparte da una posa ferma coerente con il giocatore (alla rinascita). */
export function resetAnimState(a: AnimState, p: Readonly<PlayerState>, weapon: number): void {
  syncAnimPosition(a, p);
  a.weapon = weapon;
  a.crouch = p.crouched ? 1 : 0;
  a.slide = p.sliding ? 1 : 0;
  a.air = 0;
  a.fall = 0;
  a.run = 0;
  a.lean = 0;
  a.back = 0;
  a.ready = 0;
  a.fire = 0;
  a.reload = 0;
  a.reloadWeight = 0;
  a.draw = 0;
  a.flinch = 0;
}

function approach(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

function wrap(value: number, period: number): number {
  const result = value % period;
  return result < 0 ? result + period : result;
}

/** Interpolazione tra angoli ciclici lungo la via più breve. */
function lerpWrapped(a: number, b: number, t: number, period: number): number {
  let delta = wrap(b - a, period);
  if (delta > period / 2) delta -= period;
  return wrap(a + delta * t, period);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpola due stati (per disegnare tra due tick, o per riavvolgere le hitbox nel passato). */
export function lerpAnimState(out: AnimState, a: Readonly<AnimState>, b: Readonly<AnimState>, t: number): AnimState {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  let dYaw = wrap(b.yaw - a.yaw, TWO_PI);
  if (dYaw > Math.PI) dYaw -= TWO_PI;
  out.yaw = a.yaw + dYaw * t;
  out.pitch = lerp(a.pitch, b.pitch, t);
  out.weapon = t < 0.5 ? a.weapon : b.weapon;
  out.crouch = lerp(a.crouch, b.crouch, t);
  out.slide = lerp(a.slide, b.slide, t);
  out.air = lerp(a.air, b.air, t);
  out.fall = lerp(a.fall, b.fall, t);
  out.run = lerp(a.run, b.run, t);
  out.phase = lerpWrapped(a.phase, b.phase, t, TWO_PI);
  out.lean = lerp(a.lean, b.lean, t);
  out.back = t < 0.5 ? a.back : b.back;
  out.ready = lerp(a.ready, b.ready, t);
  out.fire = lerp(a.fire, b.fire, t);
  out.reload = b.reload >= a.reload ? lerp(a.reload, b.reload, t) : b.reload;
  out.reloadWeight = lerp(a.reloadWeight, b.reloadWeight, t);
  out.draw = lerp(a.draw, b.draw, t);
  out.flinch = lerp(a.flinch, b.flinch, t);
  out.clock = lerpWrapped(a.clock, b.clock, t, ANIM.clockWrap);
  return out;
}

/** Quello che serve dell'arma in mano: WeaponState lo soddisfa. */
export interface AnimWeaponInput {
  current: number;
  adsAmount: number;
  sinceShot: number;
  reloadTimer: number;
  drawTimer: number;
}

/** Fa avanzare l'animazione di un tick, dopo il movimento e lo sparo. */
export function updateAnimState(
  a: AnimState,
  p: Readonly<PlayerState>,
  w: Readonly<AnimWeaponInput>,
  def: Readonly<WeaponDef> | null,
  dt: number,
): void {
  syncAnimPosition(a, p);
  a.weapon = def ? w.current : -1;
  const speed = Math.hypot(p.vx, p.vz);
  const onFoot = p.grounded && !p.sliding;
  a.crouch = approach(a.crouch, p.crouched ? 1 : 0, ANIM.crouchRate, dt);
  a.slide = approach(a.slide, p.sliding ? 1 : 0, ANIM.slideRate, dt);
  a.air = approach(a.air, p.grounded ? 0 : 1, ANIM.airRate, dt);
  a.fall = approach(a.fall, !p.grounded && p.vy < ANIM.fallSpeed ? 1 : 0, ANIM.fallRate, dt);
  a.run = approach(a.run, onFoot ? Math.min(1, speed / MOVE.runSpeed) : 0, ANIM.runRate, dt);
  // Passi più corti a bassa velocità, lunghi in corsa: la cadenza resta credibile a ogni andatura.
  if (onFoot) a.phase = wrap(a.phase + (speed * dt * TWO_PI) / lerp(ANIM.walkStride, ANIM.strideLength, a.run), TWO_PI);
  const ahead = -(p.vx * Math.sin(p.yaw) + p.vz * Math.cos(p.yaw));
  a.back = onFoot && ahead < ANIM.backSpeed ? 1 : 0;
  const lateral = (p.vx * Math.cos(p.yaw) - p.vz * Math.sin(p.yaw)) / MOVE.runSpeed;
  a.lean = approach(a.lean, onFoot ? clamp(lateral, -1, 1) : 0, ANIM.leanRate, dt);
  const busy = w.adsAmount > 0 || w.sinceShot < ANIM.readyHold || w.reloadTimer > 0;
  a.ready = approach(a.ready, busy ? 1 : 0, ANIM.readyRate, dt);
  const decay = def?.kind === 'melee' ? ANIM.swingDecay : ANIM.fireDecay;
  a.fire = w.sinceShot === 0 ? 1 : a.fire * Math.exp(-decay * dt);
  a.reload = def && w.reloadTimer > 0 && def.reloadTime > 0 ? clamp(1 - w.reloadTimer / def.reloadTime, 0, 1) : 0;
  a.reloadWeight = approach(a.reloadWeight, w.reloadTimer > 0 ? 1 : 0, ANIM.reloadRate, dt);
  a.draw = def && def.drawTime > 0 ? clamp(w.drawTimer / def.drawTime, 0, 1) : 0;
  a.flinch *= Math.exp(-ANIM.flinchDecay * dt);
  a.clock = wrap(a.clock + dt, ANIM.clockWrap);
}

// -----------------------------------------------------------------------------------------------
// Impugnature delle armi
// -----------------------------------------------------------------------------------------------

/** Dove vanno le mani su un'arma (coordinate del modello, metri). */
export interface WeaponGrip {
  right: readonly [number, number, number];
  left: readonly [number, number, number];
  /** Arma corpo a corpo: la mano sinistra resta libera. */
  melee: boolean;
}

const DEFAULT_GRIP: WeaponGrip = { right: [0, -0.06, 0.02], left: [0, 0, -0.35], melee: false };

/** Impugnature di tutte le armi, nello stesso ordine; senza modelli si usa una presa generica. */
export function buildGrips(weapons: readonly WeaponDef[], models?: ReadonlyMap<string, WeaponModelDef>): WeaponGrip[] {
  return weapons.map((def) => {
    const model = models?.get(def.model);
    const melee = def.kind === 'melee';
    if (!model) return { ...DEFAULT_GRIP, melee };
    return { right: model.hands.right, left: model.hands.left, melee };
  });
}

// -----------------------------------------------------------------------------------------------
// Posa
// -----------------------------------------------------------------------------------------------

/** Numeri per parte: centro (3), assi X Y Z (9), semi-dimensioni (3), perno (3). */
export const PART_STRIDE = 18;
export const POSE_CENTER = 0;
export const POSE_AXIS_X = 3;
export const POSE_AXIS_Y = 6;
export const POSE_AXIS_Z = 9;
export const POSE_HALF = 12;
export const POSE_PIVOT = 15;

/**
 * Sei box orientati in coordinate di mondo. Il perno è il giunto della parte (collo, bacino,
 * spalla, anca): le braccia e le gambe si estendono lungo -Y dal perno, testa e busto lungo +Y.
 */
export class BodyPose {
  readonly parts = new Float64Array(PART_COUNT * PART_STRIDE);
  /** Arma in mano: posizione (3) e assi X, Y, Z (9). Valida solo se `armed`. */
  readonly weapon = new Float64Array(12);
  armed = false;
  /** Box allineato agli assi che contiene tutto il corpo (controllo rapido dei colpi). */
  readonly min = new Float64Array(3);
  readonly max = new Float64Array(3);
}

// Matrici 3x3 per colonne (assi X, Y, Z), riutilizzate.
const torso = new Float64Array(9);
const head = new Float64Array(9);
const aim = new Float64Array(9);
const limb = new Float64Array(9);
const swing = new Float64Array(9);
const arm = new Float64Array(9);

/** rotZ(roll) · rotX(pitch): pitch > 0 porta la cima della parte indietro (+z), roll > 0 verso -x. */
function rotZX(m: Float64Array, roll: number, pitch: number): void {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  m[0] = cr;
  m[1] = sr;
  m[2] = 0;
  m[3] = -sr * cp;
  m[4] = cr * cp;
  m[5] = sp;
  m[6] = sr * sp;
  m[7] = -cr * sp;
  m[8] = cp;
}

/** rotX(pitch) · rotZ(roll): l'arma prima ruota attorno alla canna, poi segue la mira. */
function rotXZ(m: Float64Array, pitch: number, roll: number): void {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  m[0] = cr;
  m[1] = cp * sr;
  m[2] = sp * sr;
  m[3] = -sr;
  m[4] = cp * cr;
  m[5] = sp * cr;
  m[6] = 0;
  m[7] = -sp;
  m[8] = cp;
}

function multiply(out: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let col = 0; col < 3; col++) {
    const x = b[col * 3]!;
    const y = b[col * 3 + 1]!;
    const z = b[col * 3 + 2]!;
    out[col * 3] = a[0]! * x + a[3]! * y + a[6]! * z;
    out[col * 3 + 1] = a[1]! * x + a[4]! * y + a[7]! * z;
    out[col * 3 + 2] = a[2]! * x + a[5]! * y + a[8]! * z;
  }
}

// Riferimento del personaggio nel mondo durante il calcolo di una posa.
let baseX = 0;
let baseY = 0;
let baseZ = 0;
let yawCos = 1;
let yawSin = 0;

function worldPoint(out: Float64Array, i: number, lx: number, ly: number, lz: number): void {
  out[i] = baseX + lx * yawCos + lz * yawSin;
  out[i + 1] = baseY + ly;
  out[i + 2] = baseZ - lx * yawSin + lz * yawCos;
}

function worldVector(out: Float64Array, i: number, lx: number, ly: number, lz: number): void {
  out[i] = lx * yawCos + lz * yawSin;
  out[i + 1] = ly;
  out[i + 2] = -lx * yawSin + lz * yawCos;
}

/** Scrive una parte: perno e assi in coordinate del personaggio, centro spostato di (cx, cy, cz) nello spazio della parte. */
function writePart(
  parts: Float64Array,
  index: number,
  px: number,
  py: number,
  pz: number,
  m: Float64Array,
  hx: number,
  hy: number,
  hz: number,
  cx: number,
  cy: number,
  cz: number,
): void {
  const o = index * PART_STRIDE;
  worldPoint(
    parts,
    o + POSE_CENTER,
    px + m[0]! * cx + m[3]! * cy + m[6]! * cz,
    py + m[1]! * cx + m[4]! * cy + m[7]! * cz,
    pz + m[2]! * cx + m[5]! * cy + m[8]! * cz,
  );
  worldVector(parts, o + POSE_AXIS_X, m[0]!, m[1]!, m[2]!);
  worldVector(parts, o + POSE_AXIS_Y, m[3]!, m[4]!, m[5]!);
  worldVector(parts, o + POSE_AXIS_Z, m[6]!, m[7]!, m[8]!);
  parts[o + POSE_HALF] = hx;
  parts[o + POSE_HALF + 1] = hy;
  parts[o + POSE_HALF + 2] = hz;
  worldPoint(parts, o + POSE_PIVOT, px, py, pz);
}

/**
 * Arto dal giunto (spalla, anca) all'estremità (mano, piede): l'asse Y va dall'estremità al giunto,
 * l'asse X resta il più possibile parallelo a (rx, ry, rz).
 *
 * Gomito e ginocchio: `bend` è di quanto sporgono lungo l'asse Z dell'arto (positivo verso +Z,
 * negativo verso -Z). Il box si allarga da quella parte per contenerli, così chi disegna l'arto in
 * due segmenti resta dentro la hitbox. `shift` sposta il centro lungo Z (gambe accovacciate).
 */
function writeLimb(
  parts: Float64Array,
  index: number,
  sx: number,
  sy: number,
  sz: number,
  hx: number,
  hy: number,
  hz: number,
  rx: number,
  ry: number,
  rz: number,
  halfWidth: number,
  halfDepth: number,
  bend: number,
  shift: number,
): void {
  let yx = sx - hx;
  let yy = sy - hy;
  let yz = sz - hz;
  let length = Math.hypot(yx, yy, yz);
  if (length < 1e-4) {
    yx = 0;
    yy = 1;
    yz = 0;
    length = 1e-4;
  } else {
    yx /= length;
    yy /= length;
    yz /= length;
  }
  const dot = rx * yx + ry * yy + rz * yz;
  let xx = rx - dot * yx;
  let xy = ry - dot * yy;
  let xz = rz - dot * yz;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-4) {
    // Braccio parallelo al riferimento: si usa un asse qualsiasi perpendicolare.
    xx = yy;
    xy = -yx;
    xz = 0;
    xl = Math.hypot(xx, xy) || 1;
  }
  xx /= xl;
  xy /= xl;
  xz /= xl;
  arm[0] = xx;
  arm[1] = xy;
  arm[2] = xz;
  arm[3] = yx;
  arm[4] = yy;
  arm[5] = yz;
  // Z = X × Y
  arm[6] = xy * yz - xz * yy;
  arm[7] = xz * yx - xx * yz;
  arm[8] = xx * yy - xy * yx;
  writePart(parts, index, sx, sy, sz, arm, halfWidth, length / 2, halfDepth + Math.abs(bend) / 2, 0, -length / 2, shift + bend / 2);
}

/** Sporgenza del giunto di mezzo per un arto di due ossa lunghe `bone` con le estremità a distanza `length`. */
function jointBend(bone: number, length: number): number {
  return Math.sqrt(Math.max(0, bone * bone - (length * length) / 4));
}

function distance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

/** Ruota attorno all'asse verticale una matrice per colonne (angolo > 0: la destra va in avanti). */
function twistY(m: Float64Array, angle: number): void {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  for (let col = 0; col < 9; col += 3) {
    const x = m[col]!;
    const z = m[col + 2]!;
    m[col] = x * c + z * sn;
    m[col + 2] = -x * sn + z * c;
  }
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Calcola la posa del corpo. Funzione pura dello stato dell'animazione e delle impugnature. */
export function poseBody(out: BodyPose, a: Readonly<AnimState>, grips: readonly WeaponGrip[]): BodyPose {
  baseX = a.x;
  baseY = a.y;
  baseZ = a.z;
  yawCos = Math.cos(a.yaw);
  yawSin = Math.sin(a.yaw);
  const parts = out.parts;
  // Accovacciati il corpo si accorcia; in scivolata invece resta lungo e si sdraia.
  const crouchBody = a.crouch * (1 - a.slide);
  const eye = lerp(PLAYER.eyeHeight, PLAYER.crouchEyeHeight, a.crouch);
  const neckY = eye - BODY.neckBelowEye;

  // Busto: pende dal collo, segue in parte la mira, si piega in corsa, all'indietro in scivolata.
  // Appena atterrati (ancora un po' "in caduta", ma già a terra) il corpo ammortizza piegandosi in avanti.
  const land = clamp((1 - a.air) * a.fall * 4, 0, 1);
  const back = a.back >= 0.5;
  const torsoPitch =
    a.pitch * BODY.torsoPitchFollow -
    BODY.runLean * a.run * (back ? -0.4 : 1) +
    BODY.slideLean * a.slide +
    BODY.flinchLean * a.flinch -
    BODY.landLean * land;
  const torsoRoll = -a.lean * BODY.strafeLean;
  rotZX(torso, torsoRoll, torsoPitch);
  // In corsa le spalle ruotano con il passo: la spalla opposta al piede che avanza va in avanti.
  twistY(torso, Math.sin(a.phase) * BODY.runTwist * a.run);
  const torsoLength = lerp(BODY.torsoLength, BODY.crouchTorsoLength, crouchBody);
  const hipX = -torso[3]! * torsoLength;
  const hipY = neckY - torso[4]! * torsoLength;
  const hipZ = -torso[5]! * torsoLength;
  writePart(parts, PART_TORSO, hipX, hipY, hipZ, torso, BODY.torsoHalfWidth, torsoLength / 2, BODY.torsoHalfDepth, 0, torsoLength / 2, 0);

  // Testa: ruota attorno al collo con tutta la mira.
  rotZX(head, 0, clamp(a.pitch + BODY.flinchHead * a.flinch, -PLAYER.pitchLimit, PLAYER.pitchLimit));
  const h = BODY.headHalf;
  writePart(parts, PART_HEAD, 0, neckY, 0, head, h, h, h, 0, h, 0);

  // Gambe: dall'anca al piede. A terra i piedi fanno passi veri nella direzione in cui ci si muove:
  // appoggiati restano fermi sul terreno mentre il corpo avanza, poi si alzano e tornano avanti. In
  // aria una gamba sale e l'altra resta indietro (salto) o tutte e due si preparano all'urto
  // (caduta); in scivolata vanno in avanti con i piedi a terra. Il ginocchio sporge in avanti quando
  // il piede è più vicino all'anca della gamba distesa.
  const legLength = lerp(BODY.legLength, BODY.crouchLegLength, crouchBody);
  const legHalfDepth = lerp(BODY.legHalfDepth, BODY.crouchLegHalfDepth, crouchBody);
  const knee = -BODY.crouchKneeForward * crouchBody;
  const moving = smooth01(a.run / 0.12) * (1 - a.air);
  const reach = lerp(BODY.stepReachWalk, BODY.stepReachRun, a.run) * (1 - BODY.crouchStepScale * crouchBody) * moving;
  const stepLift = lerp(BODY.stepLiftWalk, BODY.stepLiftRun, a.run) * (1 - 0.5 * crouchBody) * moving;
  const stance = lerp(ANIM.stanceWalk, ANIM.stanceRun, a.run);
  const sideways = clamp(a.lean / Math.max(a.run, 0.05), -1, 1);
  const stepX = sideways * BODY.stepSideScale;
  const stepZ = Math.sqrt(1 - sideways * sideways) * (back ? 1 : -1);
  const slideReach = Math.sqrt(Math.max(0, BODY.legLength * BODY.legLength - hipY * hipY));
  for (let side = -1; side <= 1; side += 2) {
    const jx = hipX + side * BODY.hipHalfWidth;
    // Posizione nel ciclo: l'appoggio è centrato a metà ciclo per la gamba sinistra, mezzo ciclo dopo per la destra.
    let u = a.phase / TWO_PI + (side < 0 ? 0 : 0.5);
    u -= Math.floor(u);
    const start = 0.5 - stance / 2;
    let along: number;
    let lift = 0;
    if (u >= start && u < start + stance) {
      along = 1 - (2 * (u - start)) / stance;
    } else {
      let t = u - start - stance;
      if (t < 0) t += 1;
      t /= 1 - stance;
      along = 2 * smooth01(t) - 1;
      lift = Math.sin(Math.PI * t);
    }
    let fx = jx + stepX * along * reach;
    if (side * (fx - hipX) < BODY.stepMinSide) fx = hipX + side * BODY.stepMinSide;
    let fy = lift * stepLift;
    let fz = hipZ + stepZ * along * reach;
    // In aria.
    if (a.air > 0) {
      const foot = side < 0 ? BODY.jumpFrontFoot : BODY.jumpBackFoot;
      const ax = jx + side * BODY.fallSpread * a.fall;
      const ay = hipY - lerp(foot[1], BODY.fallFoot[1], a.fall);
      const az = hipZ + lerp(side < 0 ? -foot[0] : foot[0], -BODY.fallFoot[0], a.fall);
      fx = lerp(fx, ax, a.air);
      fy = lerp(fy, ay, a.air);
      fz = lerp(fz, az, a.air);
    }
    // In scivolata.
    if (a.slide > 0) {
      fx = lerp(fx, jx + side * Math.sin(BODY.slideLegSpread) * BODY.legLength, a.slide);
      fy = lerp(fy, 0, a.slide);
      fz = lerp(fz, hipZ - slideReach, a.slide);
    }
    const bend = jointBend(legLength / 2, distance(jx, hipY, hipZ, fx, fy, fz));
    writeLimb(
      parts,
      side < 0 ? PART_LEG_LEFT : PART_LEG_RIGHT,
      jx,
      hipY,
      hipZ,
      fx,
      fy,
      fz,
      1,
      0,
      0,
      BODY.legHalfWidth,
      legHalfDepth,
      -bend,
      knee,
    );
  }

  // Braccia.
  const armSwing = Math.sin(a.phase) * BODY.runArmSwing * a.run;
  const grip = a.weapon >= 0 ? grips[a.weapon] : undefined;
  out.armed = grip !== undefined;
  if (!grip) {
    // Mani libere: le braccia pendono lungo il busto e oscillano in corsa, al contrario delle gambe.
    for (let side = -1; side <= 1; side += 2) {
      rotZX(swing, 0, side * armSwing);
      multiply(limb, torso, swing);
      const top = torsoLength;
      writePart(
        parts,
        side < 0 ? PART_ARM_LEFT : PART_ARM_RIGHT,
        hipX + torso[0]! * side * BODY.shoulderX + torso[3]! * top,
        hipY + torso[1]! * side * BODY.shoulderX + torso[4]! * top,
        hipZ + torso[2]! * side * BODY.shoulderX + torso[5]! * top,
        limb,
        BODY.armHalfWidth,
        torsoLength / 2,
        BODY.armHalfDepth,
        0,
        -torsoLength / 2,
        0,
      );
    }
    computeBounds(out);
    return out;
  }

  // Arma: nello spazio della mira, abbassata in estrazione, in corsa (se non si spara) e in ricarica.
  const carry = a.run * (1 - a.ready);
  let weaponPitch =
    a.pitch - BODY.drawLower * a.draw - BODY.carryLower * carry - BODY.reloadLower * a.reloadWeight - BODY.landLower * land;
  let push = 0;
  if (grip.melee) {
    weaponPitch -= BODY.meleeSwingPitch * a.fire;
    push = -BODY.meleeThrust * a.fire;
  } else {
    weaponPitch += BODY.fireKickPitch * a.fire;
    push = BODY.fireKickBack * a.fire;
  }
  rotXZ(aim, weaponPitch, BODY.reloadRoll * a.reloadWeight);
  const bob = Math.sin(a.phase * 2) * BODY.runBob * a.run + Math.sin((a.clock / ANIM.breathPeriod) * TWO_PI) * BODY.breath;
  const pump = Math.sin(a.phase) * BODY.carryPump * carry;
  const ox = BODY.weaponOffset[0];
  const oy = BODY.weaponOffset[1] + bob;
  const oz = BODY.weaponOffset[2] + push + pump;
  const aimY = neckY - BODY.aimBelowNeck;
  const wx = aim[0]! * ox + aim[3]! * oy + aim[6]! * oz;
  const wy = aimY + aim[1]! * ox + aim[4]! * oy + aim[7]! * oz;
  const wz = aim[2]! * ox + aim[5]! * oy + aim[8]! * oz;
  const weapon = out.weapon;
  worldPoint(weapon, 0, wx, wy, wz);
  worldVector(weapon, 3, aim[0]!, aim[1]!, aim[2]!);
  worldVector(weapon, 6, aim[3]!, aim[4]!, aim[5]!);
  worldVector(weapon, 9, aim[6]!, aim[7]!, aim[8]!);

  const shoulderY = torsoLength - BODY.shoulderBelowTop;
  for (let side = -1; side <= 1; side += 2) {
    const sx = hipX + torso[0]! * side * BODY.shoulderX + torso[3]! * shoulderY;
    const sy = hipY + torso[1]! * side * BODY.shoulderX + torso[4]! * shoulderY;
    const sz = hipZ + torso[2]! * side * BODY.shoulderX + torso[5]! * shoulderY;
    let hx: number;
    let hy: number;
    let hz: number;
    if (side > 0) {
      // Mano destra sull'impugnatura.
      const [gx, gy, gz] = grip.right;
      hx = wx + aim[0]! * gx + aim[3]! * gy + aim[6]! * gz;
      hy = wy + aim[1]! * gx + aim[4]! * gy + aim[7]! * gz;
      hz = wz + aim[2]! * gx + aim[5]! * gy + aim[8]! * gz;
    } else {
      // Mano sinistra: sull'arma, verso il caricatore in ricarica, libera in corsa con l'arma bassa.
      rotZX(swing, 0, -armSwing);
      multiply(limb, torso, swing);
      const fx = sx - limb[3]! * BODY.freeArmLength;
      const fy = sy - limb[4]! * BODY.freeArmLength;
      const fz = sz - limb[5]! * BODY.freeArmLength;
      if (grip.melee) {
        hx = fx;
        hy = fy;
        hz = fz;
      } else {
        const [gx, gy, gz] = grip.left;
        const [rx, ry, rz] = BODY.reloadHand;
        const r = Math.sin(Math.PI * a.reload) * a.reloadWeight;
        const lx = gx + (rx - gx) * r;
        const ly = gy + (ry - gy) * r;
        const lz = gz + (rz - gz) * r;
        hx = wx + aim[0]! * lx + aim[3]! * ly + aim[6]! * lz;
        hy = wy + aim[1]! * lx + aim[4]! * ly + aim[7]! * lz;
        hz = wz + aim[2]! * lx + aim[5]! * ly + aim[8]! * lz;
        hx += (fx - hx) * carry;
        hy += (fy - hy) * carry;
        hz += (fz - hz) * carry;
      }
    }
    // Il gomito sporge verso +Z dell'arto (in basso con l'arma in mano) quando la mano è vicina alla spalla.
    writeLimb(
      parts,
      side < 0 ? PART_ARM_LEFT : PART_ARM_RIGHT,
      sx,
      sy,
      sz,
      hx,
      hy,
      hz,
      aim[0]!,
      aim[1]!,
      aim[2]!,
      BODY.armHalfWidth,
      BODY.armHalfDepth,
      jointBend(BODY.armBone, distance(sx, sy, sz, hx, hy, hz)),
      0,
    );
  }
  computeBounds(out);
  return out;
}

function computeBounds(out: BodyPose): void {
  const parts = out.parts;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < PART_COUNT; i++) {
    const o = i * PART_STRIDE;
    const hx = parts[o + POSE_HALF]!;
    const hy = parts[o + POSE_HALF + 1]!;
    const hz = parts[o + POSE_HALF + 2]!;
    for (let axis = 0; axis < 3; axis++) {
      const extent =
        Math.abs(parts[o + POSE_AXIS_X + axis]!) * hx +
        Math.abs(parts[o + POSE_AXIS_Y + axis]!) * hy +
        Math.abs(parts[o + POSE_AXIS_Z + axis]!) * hz;
      const c = parts[o + POSE_CENTER + axis]!;
      if (axis === 0) {
        minX = Math.min(minX, c - extent);
        maxX = Math.max(maxX, c + extent);
      } else if (axis === 1) {
        minY = Math.min(minY, c - extent);
        maxY = Math.max(maxY, c + extent);
      } else {
        minZ = Math.min(minZ, c - extent);
        maxZ = Math.max(maxZ, c + extent);
      }
    }
  }
  out.min[0] = minX;
  out.min[1] = minY;
  out.min[2] = minZ;
  out.max[0] = maxX;
  out.max[1] = maxY;
  out.max[2] = maxZ;
}

// -----------------------------------------------------------------------------------------------
// Colpi contro la posa
// -----------------------------------------------------------------------------------------------

export interface BodyHit {
  hit: boolean;
  /** Distanza del primo punto del corpo toccato dal raggio. */
  t: number;
  region: HitRegion;
  /** Parte colpita (PART_HEAD ... PART_LEG_RIGHT), -1 se nessuna. */
  part: number;
}

export function createBodyHit(): BodyHit {
  return { hit: false, t: 0, region: 'torso', part: -1 };
}

/** Distanza d'ingresso del raggio nel box allineato agli assi, oppure -1. */
function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  min: Float64Array,
  max: Float64Array,
  maxT: number,
): number {
  let tMin = 0;
  let tMax = maxT;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = min[axis]!;
    const hi = max[axis]!;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  return tMin;
}

/** Distanza d'ingresso del raggio nella parte `index` (box orientato), oppure -1. */
function rayPart(
  parts: Float64Array,
  index: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  const o = index * PART_STRIDE;
  const rx = ox - parts[o + POSE_CENTER]!;
  const ry = oy - parts[o + POSE_CENTER + 1]!;
  const rz = oz - parts[o + POSE_CENTER + 2]!;
  let tMin = 0;
  let tMax = maxT;
  for (let axis = 0; axis < 3; axis++) {
    const a = o + POSE_AXIS_X + axis * 3;
    const ax = parts[a]!;
    const ay = parts[a + 1]!;
    const az = parts[a + 2]!;
    const origin = rx * ax + ry * ay + rz * az;
    const direction = dx * ax + dy * ay + dz * az;
    const half = parts[o + POSE_HALF + axis]!;
    if (Math.abs(direction) < 1e-12) {
      if (origin < -half || origin > half) return -1;
      continue;
    }
    let t1 = (-half - origin) / direction;
    let t2 = (half - origin) / direction;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  return tMin;
}

/**
 * Prima parte del corpo colpita dal raggio entro maxT (direzione normalizzata, coordinate di mondo).
 * Se il raggio attraversa un braccio o una gamba e poi entra nel busto o nella testa, conta il
 * busto o la testa: le braccia che reggono l'arma davanti al petto non fanno da scudo.
 * `t` resta il primo punto toccato (serve per scegliere il bersaglio più vicino e per gli effetti).
 */
export function raycastPose(
  pose: BodyPose,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: BodyHit,
): BodyHit {
  out.hit = false;
  out.t = maxT;
  out.part = -1;
  if (rayAabb(ox, oy, oz, dx, dy, dz, pose.min, pose.max, maxT) < 0) return out;
  let first = Infinity;
  let firstPart = -1;
  let core = Infinity;
  let corePart = -1;
  for (let i = 0; i < PART_COUNT; i++) {
    const t = rayPart(pose.parts, i, ox, oy, oz, dx, dy, dz, maxT);
    if (t < 0) continue;
    if (t < first) {
      first = t;
      firstPart = i;
    }
    if ((i === PART_HEAD || i === PART_TORSO) && t < core) {
      core = t;
      corePart = i;
    }
  }
  if (firstPart < 0) return out;
  const part = corePart >= 0 ? corePart : firstPart;
  out.hit = true;
  out.t = first;
  out.part = part;
  out.region = PART_REGIONS[part]!;
  return out;
}

/** Il punto (x, y, z) è dentro la parte `index`? (Per i test e gli strumenti.) */
export function poseContains(pose: BodyPose, index: number, x: number, y: number, z: number): boolean {
  const parts = pose.parts;
  const o = index * PART_STRIDE;
  const rx = x - parts[o + POSE_CENTER]!;
  const ry = y - parts[o + POSE_CENTER + 1]!;
  const rz = z - parts[o + POSE_CENTER + 2]!;
  for (let axis = 0; axis < 3; axis++) {
    const a = o + POSE_AXIS_X + axis * 3;
    const local = rx * parts[a]! + ry * parts[a + 1]! + rz * parts[a + 2]!;
    if (Math.abs(local) > parts[o + POSE_HALF + axis]! + 1e-9) return false;
  }
  return true;
}
