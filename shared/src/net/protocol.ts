/**
 * Protocollo binario tra client e server.
 *
 * - Client → server, una volta per tick: il comando numerato (seq) con il tick del server a cui il
 *   client stava disegnando gli altri giocatori (viewTick), per la compensazione del lag.
 * - Server → client, 30 volte al secondo: lo stato completo del proprio giocatore (per la
 *   riconciliazione: stessi numeri a 64 bit), quello compatto degli altri (per l'interpolazione),
 *   razzi e granate, i dati della partita e gli eventi di ogni tick dall'ultimo invio.
 */
import { ANIM } from '../constants.ts';
import type { ActionType, EventBuffer } from '../events.ts';
import type { Combatant, Projectile, WeaponState } from '../match.ts';
import { createPlayerState, type PlayerInput, type PlayerState } from '../player.ts';
import { createAnimState, type AnimState, type HitRegion } from '../pose.ts';
import type { ByteReader, ByteWriter } from './codec.ts';

export const MSG_INPUT = 'input';
export const MSG_SNAPSHOT = 'snap';
export const MSG_WELCOME = 'welcome';
export const MSG_ROSTER = 'roster';
export const MSG_CHAT = 'chat';
export const MSG_CLASS = 'class';

const TWO_PI = Math.PI * 2;
const REGIONS: readonly HitRegion[] = ['head', 'torso', 'arm', 'leg'];
const ACTIONS: readonly ActionType[] = ['reload', 'reloadEnd', 'switch', 'dryFire', 'throw', 'bounce', 'respawn'];

// -----------------------------------------------------------------------------------------------
// Comandi
// -----------------------------------------------------------------------------------------------

const BUTTON_JUMP = 1;
const BUTTON_CROUCH = 2;
const BUTTON_FIRE = 4;
const BUTTON_ADS = 8;
const BUTTON_RELOAD = 16;
const BUTTON_GRENADE = 32;

/**
 * Porta il comando ai valori che viaggiano in rete. Il client lo applica prima di predire, così
 * client e server simulano esattamente gli stessi numeri.
 */
export function quantizeInput(input: PlayerInput): void {
  input.yaw = Number.isFinite(input.yaw) ? input.yaw : 0;
  input.pitch = Number.isFinite(input.pitch) ? input.pitch : 0;
  input.forward = Math.max(-1, Math.min(1, Math.round(Number.isFinite(input.forward) ? input.forward : 0)));
  input.right = Math.max(-1, Math.min(1, Math.round(Number.isFinite(input.right) ? input.right : 0)));
  input.weaponSlot = Math.max(0, Math.min(255, Math.trunc(Number.isFinite(input.weaponSlot) ? input.weaponSlot : 0)));
}

export interface InputFrame {
  seq: number;
  /** Tick del server (frazionario) a cui il client vedeva gli altri. */
  viewTick: number;
  input: PlayerInput;
}

export function writeInput(w: ByteWriter, seq: number, viewTick: number, input: Readonly<PlayerInput>): void {
  w.u32(seq);
  w.f64(viewTick);
  w.f64(input.yaw);
  w.f64(input.pitch);
  w.i8(input.forward);
  w.i8(input.right);
  w.u8(
    (input.jump ? BUTTON_JUMP : 0) |
      (input.crouch ? BUTTON_CROUCH : 0) |
      (input.fire ? BUTTON_FIRE : 0) |
      (input.ads ? BUTTON_ADS : 0) |
      (input.reload ? BUTTON_RELOAD : 0) |
      (input.grenade ? BUTTON_GRENADE : 0),
  );
  w.u8(input.weaponSlot);
}

export function readInput(r: ByteReader, out: InputFrame): InputFrame {
  out.seq = r.u32();
  out.viewTick = r.f64();
  const input = out.input;
  input.yaw = r.f64();
  input.pitch = r.f64();
  input.forward = r.i8();
  input.right = r.i8();
  const buttons = r.u8();
  input.jump = (buttons & BUTTON_JUMP) !== 0;
  input.crouch = (buttons & BUTTON_CROUCH) !== 0;
  input.fire = (buttons & BUTTON_FIRE) !== 0;
  input.ads = (buttons & BUTTON_ADS) !== 0;
  input.reload = (buttons & BUTTON_RELOAD) !== 0;
  input.grenade = (buttons & BUTTON_GRENADE) !== 0;
  input.weaponSlot = r.u8();
  quantizeInput(input);
  return out;
}

// -----------------------------------------------------------------------------------------------
// Stato del proprio giocatore (riconciliazione)
// -----------------------------------------------------------------------------------------------

/** Lo stato dell'arma che influisce sulla simulazione. */
export interface WeaponCore {
  current: number;
  previous: number;
  ammo: number[];
  fireCooldown: number;
  reloadTimer: number;
  drawTimer: number;
  bloom: number;
  recoilPitch: number;
  recoilYaw: number;
  shotIndex: number;
  sinceShot: number;
  adsAmount: number;
  triggerHeld: boolean;
  reloadHeld: boolean;
  grenadeHeld: boolean;
  grenades: number;
  grenadeCooldown: number;
  seed: number;
}

export function createWeaponCore(): WeaponCore {
  return {
    current: 0,
    previous: 0,
    ammo: [],
    fireCooldown: 0,
    reloadTimer: 0,
    drawTimer: 0,
    bloom: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    shotIndex: 0,
    sinceShot: 0,
    adsAmount: 0,
    triggerHeld: false,
    reloadHeld: false,
    grenadeHeld: false,
    grenades: 0,
    grenadeCooldown: 0,
    seed: 0,
  };
}

/** Copia la parte che conta dello stato dell'arma (in un senso o nell'altro). */
export function captureWeapon(out: WeaponCore, w: Readonly<WeaponState>): void {
  out.current = w.current;
  out.previous = w.previous;
  out.ammo.length = w.ammo.length;
  for (let i = 0; i < w.ammo.length; i++) out.ammo[i] = w.ammo[i]!;
  out.fireCooldown = w.fireCooldown;
  out.reloadTimer = w.reloadTimer;
  out.drawTimer = w.drawTimer;
  out.bloom = w.bloom;
  out.recoilPitch = w.recoilPitch;
  out.recoilYaw = w.recoilYaw;
  out.shotIndex = w.shotIndex;
  out.sinceShot = w.sinceShot;
  out.adsAmount = w.adsAmount;
  out.triggerHeld = w.triggerHeld;
  out.reloadHeld = w.reloadHeld;
  out.grenadeHeld = w.grenadeHeld;
  out.grenades = w.grenades;
  out.grenadeCooldown = w.grenadeCooldown;
  out.seed = w.random.seed;
}

export function restoreWeapon(w: WeaponState, from: Readonly<WeaponCore>): void {
  w.current = from.current;
  w.previous = from.previous;
  for (let i = 0; i < w.ammo.length && i < from.ammo.length; i++) w.ammo[i] = from.ammo[i]!;
  w.fireCooldown = from.fireCooldown;
  w.reloadTimer = from.reloadTimer;
  w.drawTimer = from.drawTimer;
  w.bloom = from.bloom;
  w.recoilPitch = from.recoilPitch;
  w.recoilYaw = from.recoilYaw;
  w.shotIndex = from.shotIndex;
  w.sinceShot = from.sinceShot;
  w.adsAmount = from.adsAmount;
  w.triggerHeld = from.triggerHeld;
  w.reloadHeld = from.reloadHeld;
  w.grenadeHeld = from.grenadeHeld;
  w.grenades = from.grenades;
  w.grenadeCooldown = from.grenadeCooldown;
  w.random.seed = from.seed;
}

/** I campi del movimento che servono a ripartire esattamente da uno stato. */
const PLAYER_NUMBERS = [
  'x',
  'y',
  'z',
  'vx',
  'vy',
  'vz',
  'yaw',
  'pitch',
  'groundGradX',
  'groundGradZ',
  'jumpBuffer',
  'coyoteTime',
  'slideBoostCooldown',
  'speedScale',
  'jumpVelocity',
] as const;
const PLAYER_FLAGS = ['grounded', 'crouched', 'sliding', 'prevJump', 'prevCrouch'] as const;
const WEAPON_NUMBERS = [
  'fireCooldown',
  'reloadTimer',
  'drawTimer',
  'bloom',
  'recoilPitch',
  'recoilYaw',
  'sinceShot',
  'adsAmount',
  'grenadeCooldown',
] as const;

/** Uguaglianza esatta di due stati predetti: client e server eseguono lo stesso codice. */
/**
 * Scarto ammesso tra predizione e server: browser e Node possono differire all'ultima cifra
 * (funzioni matematiche diverse); sotto questa soglia non si corregge.
 */
export const STATE_TOLERANCE = 1e-6;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= STATE_TOLERANCE;
}

export function sameState(a: Readonly<PlayerState>, aw: Readonly<WeaponCore>, b: Readonly<PlayerState>, bw: Readonly<WeaponCore>): boolean {
  for (const key of PLAYER_NUMBERS) if (!near(a[key], b[key])) return false;
  for (const key of PLAYER_FLAGS) if (a[key] !== b[key]) return false;
  for (const key of WEAPON_NUMBERS) if (!near(aw[key], bw[key])) return false;
  if (aw.current !== bw.current || aw.previous !== bw.previous || aw.shotIndex !== bw.shotIndex) return false;
  if (aw.triggerHeld !== bw.triggerHeld || aw.reloadHeld !== bw.reloadHeld || aw.grenadeHeld !== bw.grenadeHeld) return false;
  if (aw.grenades !== bw.grenades || aw.seed !== bw.seed || aw.ammo.length !== bw.ammo.length) return false;
  for (let i = 0; i < aw.ammo.length; i++) if (aw.ammo[i] !== bw.ammo[i]) return false;
  return true;
}

/** Primo campo diverso tra due stati (per i dati di debug), o '' se coincidono. */
export function stateDifference(a: Readonly<PlayerState>, aw: Readonly<WeaponCore>, b: Readonly<PlayerState>, bw: Readonly<WeaponCore>): string {
  for (const key of PLAYER_NUMBERS) if (!near(a[key], b[key])) return `${key} ${a[key]} → ${b[key]}`;
  for (const key of PLAYER_FLAGS) if (a[key] !== b[key]) return `${key} ${a[key]} → ${b[key]}`;
  for (const key of WEAPON_NUMBERS) if (!near(aw[key], bw[key])) return `arma.${key} ${aw[key]} → ${bw[key]}`;
  if (aw.current !== bw.current) return `arma.current ${aw.current} → ${bw.current}`;
  if (aw.seed !== bw.seed) return 'arma.seed';
  for (let i = 0; i < aw.ammo.length; i++) if (aw.ammo[i] !== bw.ammo[i]) return `arma.ammo[${i}] ${aw.ammo[i]} → ${bw.ammo[i]}`;
  return sameState(a, aw, b, bw) ? '' : 'arma (altro)';
}

export interface LocalSnapshot {
  id: number;
  alive: boolean;
  health: number;
  maxHealth: number;
  protection: number;
  respawnTimer: number;
  classIndex: number;
  team: number;
  killedBy: number;
  killedByWeapon: number;
  kills: number;
  deaths: number;
  streak: number;
  loadout: number[];
  player: PlayerState;
  weapon: WeaponCore;
}

export function createLocalSnapshot(): LocalSnapshot {
  return {
    id: -1,
    alive: false,
    health: 0,
    maxHealth: 0,
    protection: 0,
    respawnTimer: 0,
    classIndex: -1,
    team: 0,
    killedBy: -1,
    killedByWeapon: 0,
    kills: 0,
    deaths: 0,
    streak: 0,
    loadout: [],
    player: createPlayerState(),
    weapon: createWeaponCore(),
  };
}

const scratchWeapon = createWeaponCore();

function writeLocal(w: ByteWriter, c: Combatant): void {
  w.u16(c.id);
  w.u8(c.alive ? 1 : 0);
  w.f64(c.health);
  w.u16(c.maxHealth);
  w.f64(c.protection);
  w.f32(c.respawnTimer);
  w.i8(c.classIndex);
  w.u8(c.team);
  w.i16(c.killedBy);
  w.i8(c.killedByWeapon);
  w.u16(c.kills);
  w.u16(c.deaths);
  w.u8(Math.min(255, c.streak));
  w.u8(c.loadout.length);
  for (const index of c.loadout) w.u8(index);
  const p = c.player;
  for (const key of PLAYER_NUMBERS) w.f64(p[key]);
  let flags = 0;
  PLAYER_FLAGS.forEach((key, bit) => {
    if (p[key]) flags |= 1 << bit;
  });
  w.u8(flags);
  captureWeapon(scratchWeapon, c.weapon);
  const weapon = scratchWeapon;
  w.u8(weapon.current);
  w.u8(weapon.previous);
  w.u8(weapon.ammo.length);
  for (const ammo of weapon.ammo) w.u16(ammo);
  for (const key of WEAPON_NUMBERS) w.f64(weapon[key]);
  w.u16(weapon.shotIndex);
  w.u8((weapon.triggerHeld ? 1 : 0) | (weapon.reloadHeld ? 2 : 0) | (weapon.grenadeHeld ? 4 : 0));
  w.u8(weapon.grenades);
  w.u32(weapon.seed);
}

function readLocal(r: ByteReader, out: LocalSnapshot): void {
  out.id = r.u16();
  out.alive = r.u8() === 1;
  out.health = r.f64();
  out.maxHealth = r.u16();
  out.protection = r.f64();
  out.respawnTimer = r.f32();
  out.classIndex = r.i8();
  out.team = r.u8();
  out.killedBy = r.i16();
  out.killedByWeapon = r.i8();
  out.kills = r.u16();
  out.deaths = r.u16();
  out.streak = r.u8();
  out.loadout.length = r.u8();
  for (let i = 0; i < out.loadout.length; i++) out.loadout[i] = r.u8();
  const p = out.player;
  for (const key of PLAYER_NUMBERS) p[key] = r.f64();
  const flags = r.u8();
  PLAYER_FLAGS.forEach((key, bit) => {
    p[key] = (flags & (1 << bit)) !== 0;
  });
  const weapon = out.weapon;
  weapon.current = r.u8();
  weapon.previous = r.u8();
  weapon.ammo.length = r.u8();
  for (let i = 0; i < weapon.ammo.length; i++) weapon.ammo[i] = r.u16();
  for (const key of WEAPON_NUMBERS) weapon[key] = r.f64();
  weapon.shotIndex = r.u16();
  const held = r.u8();
  weapon.triggerHeld = (held & 1) !== 0;
  weapon.reloadHeld = (held & 2) !== 0;
  weapon.grenadeHeld = (held & 4) !== 0;
  weapon.grenades = r.u8();
  weapon.seed = r.u32();
}

// -----------------------------------------------------------------------------------------------
// Altri giocatori (interpolazione)
// -----------------------------------------------------------------------------------------------

export interface RemoteSnapshot {
  id: number;
  alive: boolean;
  bot: boolean;
  protected: boolean;
  crouched: boolean;
  grounded: boolean;
  sliding: boolean;
  team: number;
  classIndex: number;
  health: number;
  maxHealth: number;
  kills: number;
  deaths: number;
  vx: number;
  vy: number;
  vz: number;
  anim: AnimState;
}

export function createRemoteSnapshot(): RemoteSnapshot {
  return {
    id: 0,
    alive: false,
    bot: false,
    protected: false,
    crouched: false,
    grounded: false,
    sliding: false,
    team: 0,
    classIndex: -1,
    health: 0,
    maxHealth: 0,
    kills: 0,
    deaths: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    anim: createAnimState(),
  };
}

function writeRemote(w: ByteWriter, c: Combatant): void {
  const p = c.player;
  const a = c.anim;
  w.u16(c.id);
  w.u8(
    (c.alive ? 1 : 0) |
      (c.bot ? 2 : 0) |
      (c.protection > 0 ? 4 : 0) |
      (p.crouched ? 8 : 0) |
      (p.grounded ? 16 : 0) |
      (p.sliding ? 32 : 0),
  );
  w.u8(c.team);
  w.i8(c.classIndex);
  w.f32(c.health);
  w.u16(c.maxHealth);
  w.u16(c.kills);
  w.u16(c.deaths);
  w.f32(a.x);
  w.f32(a.y);
  w.f32(a.z);
  w.f32(a.yaw);
  w.f32(a.pitch);
  w.f32(p.vx);
  w.f32(p.vy);
  w.f32(p.vz);
  w.i8(a.weapon);
  w.unit(a.crouch);
  w.unit(a.slide);
  w.unit(a.air);
  w.unit(a.fall);
  w.unit(a.run);
  w.signedUnit(a.lean);
  w.unit(a.ready);
  w.unit(a.fire);
  w.unit(a.reload);
  w.unit(a.reloadWeight);
  w.unit(a.draw);
  w.unit(a.flinch);
  w.u16(Math.round((a.phase / TWO_PI) * 65535) & 0xffff);
  w.u16(Math.round((a.clock / ANIM.clockWrap) * 65535) & 0xffff);
}

function readRemote(r: ByteReader, out: RemoteSnapshot): void {
  out.id = r.u16();
  const flags = r.u8();
  out.alive = (flags & 1) !== 0;
  out.bot = (flags & 2) !== 0;
  out.protected = (flags & 4) !== 0;
  out.crouched = (flags & 8) !== 0;
  out.grounded = (flags & 16) !== 0;
  out.sliding = (flags & 32) !== 0;
  out.team = r.u8();
  out.classIndex = r.i8();
  out.health = r.f32();
  out.maxHealth = r.u16();
  out.kills = r.u16();
  out.deaths = r.u16();
  const a = out.anim;
  a.x = r.f32();
  a.y = r.f32();
  a.z = r.f32();
  a.yaw = r.f32();
  a.pitch = r.f32();
  out.vx = r.f32();
  out.vy = r.f32();
  out.vz = r.f32();
  a.weapon = r.i8();
  a.crouch = r.unit();
  a.slide = r.unit();
  a.air = r.unit();
  a.fall = r.unit();
  a.run = r.unit();
  a.lean = r.signedUnit();
  a.ready = r.unit();
  a.fire = r.unit();
  a.reload = r.unit();
  a.reloadWeight = r.unit();
  a.draw = r.unit();
  a.flinch = r.unit();
  a.phase = (r.u16() / 65535) * TWO_PI;
  a.clock = (r.u16() / 65535) * ANIM.clockWrap;
}

// -----------------------------------------------------------------------------------------------
// Proiettili e dati della partita
// -----------------------------------------------------------------------------------------------

export interface ProjectileSnapshot {
  serial: number;
  owner: number;
  weapon: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export function createProjectileSnapshot(): ProjectileSnapshot {
  return { serial: 0, owner: 0, weapon: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
}

/** Stato della partita mostrato a tutti: modalità, fase, tempo, punteggi delle squadre. */
export interface MatchInfo {
  mode: number;
  /** 0 = in corso, 1 = finita (schermata finale). */
  phase: number;
  timeLeft: number;
  scoreLimit: number;
  scoreA: number;
  scoreB: number;
  /** Vincitore: id del giocatore (tutti contro tutti) o squadra; -1 = nessuno. */
  winner: number;
  /** Bandiere (cattura la bandiera): stato e posizione di ognuna. */
  flags: FlagSnapshot[];
}

export interface FlagSnapshot {
  /** 0 = alla base, 1 = portata da `carrier`, 2 = a terra. */
  state: number;
  carrier: number;
  x: number;
  y: number;
  z: number;
}

export function createMatchInfo(): MatchInfo {
  return { mode: 0, phase: 0, timeLeft: 0, scoreLimit: 0, scoreA: 0, scoreB: 0, winner: -1, flags: [] };
}

function writeInfo(w: ByteWriter, info: Readonly<MatchInfo>): void {
  w.u8(info.mode);
  w.u8(info.phase);
  w.f32(info.timeLeft);
  w.u16(info.scoreLimit);
  w.u16(info.scoreA);
  w.u16(info.scoreB);
  w.i16(info.winner);
  w.u8(info.flags.length);
  for (const flag of info.flags) {
    w.u8(flag.state);
    w.i16(flag.carrier);
    w.f32(flag.x);
    w.f32(flag.y);
    w.f32(flag.z);
  }
}

function readInfo(r: ByteReader, out: MatchInfo): void {
  out.mode = r.u8();
  out.phase = r.u8();
  out.timeLeft = r.f32();
  out.scoreLimit = r.u16();
  out.scoreA = r.u16();
  out.scoreB = r.u16();
  out.winner = r.i16();
  const count = r.u8();
  while (out.flags.length < count) out.flags.push({ state: 0, carrier: -1, x: 0, y: 0, z: 0 });
  out.flags.length = count;
  for (const flag of out.flags) {
    flag.state = r.u8();
    flag.carrier = r.i16();
    flag.x = r.f32();
    flag.y = r.f32();
    flag.z = r.f32();
  }
}

// -----------------------------------------------------------------------------------------------
// Eventi
// -----------------------------------------------------------------------------------------------

/** Scrive tutti gli eventi di un tick. */
export function writeEvents(w: ByteWriter, events: EventBuffer): void {
  w.u8(events.shots.count);
  for (let i = 0; i < events.shots.count; i++) {
    const s = events.shots.get(i);
    w.u16(s.shooter);
    w.i16(s.weapon);
    w.f32(s.ox);
    w.f32(s.oy);
    w.f32(s.oz);
    w.u8(s.pellets);
    for (let k = 0; k < s.pellets; k++) {
      w.f32(s.ends[k * 3]!);
      w.f32(s.ends[k * 3 + 1]!);
      w.f32(s.ends[k * 3 + 2]!);
      w.u8(s.results[k]!);
      w.i32(s.targets[k]!);
      w.signedUnit(s.normals[k * 3]!);
      w.signedUnit(s.normals[k * 3 + 1]!);
      w.signedUnit(s.normals[k * 3 + 2]!);
    }
  }
  w.u8(events.hits.count);
  for (let i = 0; i < events.hits.count; i++) {
    const h = events.hits.get(i);
    w.u16(h.attacker);
    w.u16(h.target);
    w.f32(h.damage);
    w.i8(h.part);
    w.u8(REGIONS.indexOf(h.region) | (h.headshot ? 4 : 0) | (h.killed ? 8 : 0) | (h.explosive ? 16 : 0));
    w.i16(h.weapon);
    w.f32(h.x);
    w.f32(h.y);
    w.f32(h.z);
    w.signedUnit(h.dx);
    w.signedUnit(h.dy);
    w.signedUnit(h.dz);
  }
  w.u8(events.kills.count);
  for (let i = 0; i < events.kills.count; i++) {
    const k = events.kills.get(i);
    w.u16(k.killer);
    w.u16(k.victim);
    w.i16(k.weapon);
    w.i8(k.part);
    w.u8((k.headshot ? 1 : 0) | (k.explosive ? 2 : 0) | (k.killerAirborne ? 4 : 0) | (k.victimAirborne ? 8 : 0));
    w.f32(k.x);
    w.f32(k.y);
    w.f32(k.z);
    w.signedUnit(k.dx);
    w.signedUnit(k.dy);
    w.signedUnit(k.dz);
    w.f32(k.distance);
    w.u8(Math.min(255, k.streak));
    w.u8(Math.min(255, k.multi));
    w.u16(k.victimDeaths);
  }
  w.u8(events.explosions.count);
  for (let i = 0; i < events.explosions.count; i++) {
    const e = events.explosions.get(i);
    w.u16(e.owner);
    w.i16(e.weapon);
    w.f32(e.x);
    w.f32(e.y);
    w.f32(e.z);
    w.f32(e.radius);
  }
  w.u8(events.actions.count);
  for (let i = 0; i < events.actions.count; i++) {
    const a = events.actions.get(i);
    w.u16(a.combatant);
    w.u8(ACTIONS.indexOf(a.type));
    w.f32(a.x);
    w.f32(a.y);
    w.f32(a.z);
  }
}

/** Quali eventi tenere mentre si leggono (gli altri si scartano). */
export interface EventFilter {
  shot(shooter: number): boolean;
  hit(attacker: number, target: number): boolean;
  kill(killer: number, victim: number): boolean;
  explosion(owner: number): boolean;
  action(combatant: number, type: ActionType): boolean;
}

/** Legge gli eventi di un tick aggiungendoli a `out` (quelli che il filtro tiene). */
export function readEvents(r: ByteReader, out: EventBuffer, filter: EventFilter): void {
  let count = r.u8();
  for (let i = 0; i < count; i++) {
    const s = out.shots.add();
    s.shooter = r.u16();
    s.weapon = r.i16();
    s.ox = r.f32();
    s.oy = r.f32();
    s.oz = r.f32();
    s.pellets = r.u8();
    for (let k = 0; k < s.pellets; k++) {
      s.ends[k * 3] = r.f32();
      s.ends[k * 3 + 1] = r.f32();
      s.ends[k * 3 + 2] = r.f32();
      s.results[k] = r.u8();
      s.targets[k] = r.i32();
      s.normals[k * 3] = r.signedUnit();
      s.normals[k * 3 + 1] = r.signedUnit();
      s.normals[k * 3 + 2] = r.signedUnit();
    }
    if (!filter.shot(s.shooter)) out.shots.count--;
  }
  count = r.u8();
  for (let i = 0; i < count; i++) {
    const h = out.hits.add();
    h.attacker = r.u16();
    h.target = r.u16();
    h.damage = r.f32();
    h.part = r.i8();
    const flags = r.u8();
    h.region = REGIONS[flags & 3]!;
    h.headshot = (flags & 4) !== 0;
    h.killed = (flags & 8) !== 0;
    h.explosive = (flags & 16) !== 0;
    h.weapon = r.i16();
    h.x = r.f32();
    h.y = r.f32();
    h.z = r.f32();
    h.dx = r.signedUnit();
    h.dy = r.signedUnit();
    h.dz = r.signedUnit();
    if (!filter.hit(h.attacker, h.target)) out.hits.count--;
  }
  count = r.u8();
  for (let i = 0; i < count; i++) {
    const k = out.kills.add();
    k.killer = r.u16();
    k.victim = r.u16();
    k.weapon = r.i16();
    k.part = r.i8();
    const flags = r.u8();
    k.headshot = (flags & 1) !== 0;
    k.explosive = (flags & 2) !== 0;
    k.killerAirborne = (flags & 4) !== 0;
    k.victimAirborne = (flags & 8) !== 0;
    k.x = r.f32();
    k.y = r.f32();
    k.z = r.f32();
    k.dx = r.signedUnit();
    k.dy = r.signedUnit();
    k.dz = r.signedUnit();
    k.distance = r.f32();
    k.streak = r.u8();
    k.multi = r.u8();
    k.victimDeaths = r.u16();
    if (!filter.kill(k.killer, k.victim)) out.kills.count--;
  }
  count = r.u8();
  for (let i = 0; i < count; i++) {
    const e = out.explosions.add();
    e.owner = r.u16();
    e.weapon = r.i16();
    e.x = r.f32();
    e.y = r.f32();
    e.z = r.f32();
    e.radius = r.f32();
    if (!filter.explosion(e.owner)) out.explosions.count--;
  }
  count = r.u8();
  for (let i = 0; i < count; i++) {
    const a = out.actions.add();
    a.combatant = r.u16();
    a.type = ACTIONS[r.u8()] ?? 'reload';
    a.x = r.f32();
    a.y = r.f32();
    a.z = r.f32();
    if (!filter.action(a.combatant, a.type)) out.actions.count--;
  }
}

// -----------------------------------------------------------------------------------------------
// Pacchetto di stato
// -----------------------------------------------------------------------------------------------

export interface Snapshot {
  tick: number;
  ackSeq: number;
  hasLocal: boolean;
  local: LocalSnapshot;
  remoteCount: number;
  remotes: RemoteSnapshot[];
  projectileCount: number;
  projectiles: ProjectileSnapshot[];
  info: MatchInfo;
  /** Eventi di ogni tick dall'ultimo pacchetto (byte da leggere con readEvents). */
  eventCount: number;
  eventTicks: number[];
  eventBytes: Uint8Array[];
}

export function createSnapshot(): Snapshot {
  return {
    tick: 0,
    ackSeq: 0,
    hasLocal: false,
    local: createLocalSnapshot(),
    remoteCount: 0,
    remotes: [],
    projectileCount: 0,
    projectiles: [],
    info: createMatchInfo(),
    eventCount: 0,
    eventTicks: [],
    eventBytes: [],
  };
}

/** Eventi già scritti di un tick, uguali per tutti i giocatori. */
export interface TickEvents {
  tick: number;
  bytes: Uint8Array;
}

export function writeSnapshot(
  w: ByteWriter,
  tick: number,
  ackSeq: number,
  local: Combatant | null,
  combatants: readonly Combatant[],
  projectiles: readonly Projectile[],
  info: Readonly<MatchInfo>,
  events: readonly TickEvents[],
): void {
  w.u32(tick);
  w.u32(ackSeq);
  w.u8(local ? 1 : 0);
  if (local) writeLocal(w, local);
  let remotes = 0;
  for (const c of combatants) if (c !== local) remotes++;
  w.u16(remotes);
  for (const c of combatants) if (c !== local) writeRemote(w, c);
  let active = 0;
  for (const pr of projectiles) if (pr.active) active++;
  w.u16(active);
  for (const pr of projectiles) {
    if (!pr.active) continue;
    w.u32(pr.serial);
    w.u16(pr.owner);
    w.i16(pr.weapon);
    w.f32(pr.x);
    w.f32(pr.y);
    w.f32(pr.z);
    w.f32(pr.vx);
    w.f32(pr.vy);
    w.f32(pr.vz);
  }
  writeInfo(w, info);
  w.u8(events.length);
  for (const e of events) {
    w.u32(e.tick);
    w.bytesOf(e.bytes);
  }
}

export function readSnapshot(r: ByteReader, out: Snapshot): Snapshot {
  out.tick = r.u32();
  out.ackSeq = r.u32();
  out.hasLocal = r.u8() === 1;
  if (out.hasLocal) readLocal(r, out.local);
  out.remoteCount = r.u16();
  while (out.remotes.length < out.remoteCount) out.remotes.push(createRemoteSnapshot());
  for (let i = 0; i < out.remoteCount; i++) readRemote(r, out.remotes[i]!);
  out.projectileCount = r.u16();
  while (out.projectiles.length < out.projectileCount) out.projectiles.push(createProjectileSnapshot());
  for (let i = 0; i < out.projectileCount; i++) {
    const pr = out.projectiles[i]!;
    pr.serial = r.u32();
    pr.owner = r.u16();
    pr.weapon = r.i16();
    pr.x = r.f32();
    pr.y = r.f32();
    pr.z = r.f32();
    pr.vx = r.f32();
    pr.vy = r.f32();
    pr.vz = r.f32();
  }
  readInfo(r, out.info);
  out.eventCount = r.u8();
  for (let i = 0; i < out.eventCount; i++) {
    out.eventTicks[i] = r.u32();
    // Copia: i byte del pacchetto possono essere riusati dal trasporto.
    out.eventBytes[i] = r.bytesOf().slice();
  }
  return out;
}
