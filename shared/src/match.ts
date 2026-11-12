/**
 * Una partita: combattenti (giocatori e bot), armi, colpi, proiettili, danni, morti e rinascite.
 * Gira identica sul client e, nella Fase 6, sul server autoritativo.
 */
import { createBotState, resetBotState, updateBot, type BotMode, type BotState } from './bots.ts';
import { BOT, COMBAT, MOVE, PLAYER, TICK_DT } from './constants.ts';
import { EventBuffer, MAX_PELLETS, SHOT_BODY, SHOT_MISS, SHOT_WORLD, type ActionType } from './events.ts';
import { createBodyHit, raycastBody, type HitRegion } from './hitboxes.ts';
import type { MapData } from './map.ts';
import { DEG_TO_RAD, clamp } from './math.ts';
import { buildNavGraph, type NavGraph } from './navigation.ts';
import {
  createInput,
  createPlayerState,
  horizontalSpeed,
  playerEyeHeight,
  playerHeight,
  simulateTick,
  spawnPlayer,
  type PlayerInput,
  type PlayerState,
} from './player.ts';
import { createRandom, random, type RandomState } from './random.ts';
import { createRayHit, lineOfSight, raycastWorld } from './raycast.ts';
import {
  KILLED_BY_FALL,
  KILLED_BY_GRENADE,
  damageFalloff,
  recoilPatternIndex,
  regionMultiplier,
  type CombatContent,
  type ProjectileDef,
  type ThrowableDef,
  type WeaponDef,
} from './weapons.ts';
import { CollisionWorld } from './world.ts';

export interface WeaponState {
  /** Indice dell'arma in mano in Match.weapons. */
  current: number;
  previous: number;
  /** Colpi nel caricatore, per ogni arma. */
  ammo: number[];
  /** Tempo prima del prossimo colpo. */
  fireCooldown: number;
  /** Tempo residuo della ricarica (0 = non si sta ricaricando). */
  reloadTimer: number;
  /** Tempo residuo per estrarre l'arma. */
  drawTimer: number;
  /** Dispersione accumulata sparando (gradi). */
  bloom: number;
  /** Spostamento della mira dovuto al rinculo (radianti). */
  recoilPitch: number;
  recoilYaw: number;
  shotIndex: number;
  sinceShot: number;
  /** Quanto si sta mirando, da 0 a 1. */
  adsAmount: number;
  triggerHeld: boolean;
  reloadHeld: boolean;
  grenadeHeld: boolean;
  grenades: number;
  grenadeCooldown: number;
  random: RandomState;
}

export interface Combatant {
  readonly id: number;
  readonly name: string;
  readonly player: PlayerState;
  readonly weapon: WeaponState;
  /** Comandi del tick corrente: li scrive il client (giocatore) o l'IA (bot). */
  readonly input: PlayerInput;
  readonly bot: BotState | null;
  health: number;
  alive: boolean;
  respawnTimer: number;
  /** Invulnerabilità residua dopo la rinascita. */
  protection: number;
  kills: number;
  deaths: number;
  lastAttacker: number;
  lastDamageTime: number;
  killedBy: number;
  killedByWeapon: number;
}

export interface Projectile {
  active: boolean;
  /** Cambia a ogni lancio: il client lo usa per capire che è un proiettile nuovo. */
  serial: number;
  owner: number;
  /** Arma che l'ha lanciato, oppure KILLED_BY_GRENADE. */
  weapon: number;
  def: ProjectileDef;
  x: number;
  y: number;
  z: number;
  /** Posizione al tick precedente, per l'interpolazione. */
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  resting: boolean;
}

export function createWeaponState(seed: number, content: CombatContent, current = 0): WeaponState {
  return {
    current,
    previous: current,
    ammo: content.weapons.map((def) => def.magazine),
    fireCooldown: 0,
    reloadTimer: 0,
    drawTimer: 0,
    bloom: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    shotIndex: 0,
    sinceShot: 1,
    adsAmount: 0,
    triggerHeld: false,
    reloadHeld: false,
    grenadeHeld: false,
    grenades: content.grenade.count,
    grenadeCooldown: 0,
    random: createRandom(seed),
  };
}

function refillWeaponState(w: WeaponState, content: CombatContent): void {
  for (let i = 0; i < content.weapons.length; i++) w.ammo[i] = content.weapons[i]!.magazine;
  w.fireCooldown = 0;
  w.reloadTimer = 0;
  w.drawTimer = 0;
  w.bloom = 0;
  w.recoilPitch = 0;
  w.recoilYaw = 0;
  w.shotIndex = 0;
  w.sinceShot = 1;
  w.adsAmount = 0;
  w.grenades = content.grenade.count;
  w.grenadeCooldown = 0;
}

/** Dispersione attuale dell'arma in mano (gradi): serve anche al client per il mirino. */
export function currentSpread(c: Combatant, def: WeaponDef): number {
  const p = c.player;
  const w = c.weapon;
  const moving = clamp(horizontalSpeed(p) / MOVE.runSpeed, 0, 1);
  const spread = def.spread.base + def.spread.moving * moving + (p.grounded ? 0 : def.spread.air) + w.bloom;
  return spread * (1 + (def.spread.ads - 1) * w.adsAmount);
}

// Oggetti riutilizzati dai calcoli dei colpi.
const rayHit = createRayHit();
const bodyHit = createBodyHit();
const aim = { x: 0, y: 0, z: 0 };

/** Direzione di tiro da yaw/pitch, deviata a caso entro un cono di `spread` radianti. */
function aimDirection(yaw: number, pitch: number, spread: number, rng: RandomState): void {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  let x = -sy * cp;
  let y = sp;
  let z = -cy * cp;
  if (spread > 0) {
    const k = Math.tan(spread * Math.sqrt(random(rng)));
    const phi = Math.PI * 2 * random(rng);
    const a = Math.cos(phi) * k;
    const b = Math.sin(phi) * k;
    // Destra = (cos yaw, 0, -sin yaw); su = (sin yaw sin pitch, cos pitch, cos yaw sin pitch).
    x += cy * a + sy * sp * b;
    y += cp * b;
    z += -sy * a + cy * sp * b;
    const length = Math.hypot(x, y, z);
    x /= length;
    y /= length;
    z /= length;
  }
  aim.x = x;
  aim.y = y;
  aim.z = z;
}

/** Distanza d'ingresso di un raggio in un box allineato agli assi, oppure -1. */
function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxT: number,
): number {
  let tMin = 0;
  let tMax = maxT;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = axis === 0 ? minX : axis === 1 ? minY : minZ;
    const hi = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
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

export interface MatchOptions {
  /** Seme dei numeri casuali: stessa partita, stessi risultati. */
  seed?: number;
}

export class Match implements CombatContent {
  readonly map: MapData;
  readonly world: CollisionWorld;
  readonly nav: NavGraph;
  /** Armi disponibili, nell'ordine dei tasti numerici. */
  readonly weapons: readonly WeaponDef[];
  readonly grenade: ThrowableDef;
  readonly combatants: Combatant[] = [];
  readonly projectiles: Projectile[] = [];
  readonly events = new EventBuffer();
  botMode: BotMode = 'fight';
  time = 0;
  tickCount = 0;

  private readonly random: RandomState;
  private nextId = 0;
  private projectileSerial = 0;
  // Danno accumulato dai pallini di un colpo, per bersaglio (indice in combatants).
  private readonly pendingDamage: number[] = [];
  private readonly pendingHead: boolean[] = [];
  private readonly pendingRegion: HitRegion[] = [];
  private readonly pendingPoint: number[] = [];

  constructor(map: MapData, content: CombatContent, options: MatchOptions = {}) {
    if (content.weapons.length === 0) throw new Error('Una partita ha bisogno di almeno un\'arma.');
    this.map = map;
    this.weapons = content.weapons;
    this.grenade = content.grenade;
    this.world = CollisionWorld.fromBlocks(map.blocks);
    this.nav = buildNavGraph(this.world, map.waypoints);
    this.random = createRandom(options.seed ?? 1);
    for (let i = 0; i < COMBAT.maxProjectiles; i++) {
      this.projectiles.push({
        active: false,
        serial: 0,
        owner: -1,
        weapon: 0,
        def: content.grenade.projectile,
        x: 0,
        y: 0,
        z: 0,
        px: 0,
        py: 0,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        resting: false,
      });
    }
  }

  /** Aggiunge un combattente e lo fa nascere subito. */
  addCombatant(name: string, options: { bot?: boolean; weapon?: number } = {}): Combatant {
    const id = this.nextId++;
    const weapon = Math.min(Math.max(0, options.weapon ?? 0), this.weapons.length - 1);
    const seed = (Math.imul(id + 1, 0x9e3779b1) ^ this.random.seed) >>> 0;
    const preferredRange = this.weapons[weapon]!.bot?.preferredRange ?? 15;
    const c: Combatant = {
      id,
      name,
      player: createPlayerState(),
      weapon: createWeaponState(seed, this, weapon),
      input: createInput(),
      bot: options.bot ? createBotState(seed ^ 0x5bd1e995, preferredRange) : null,
      health: COMBAT.maxHealth,
      alive: false,
      respawnTimer: 0,
      protection: 0,
      kills: 0,
      deaths: 0,
      lastAttacker: -1,
      lastDamageTime: -Infinity,
      killedBy: -1,
      killedByWeapon: 0,
    };
    this.combatants.push(c);
    this.respawn(c);
    return c;
  }

  removeCombatant(id: number): void {
    const index = this.combatants.findIndex((c) => c.id === id);
    if (index >= 0) this.combatants.splice(index, 1);
  }

  getCombatant(id: number): Combatant | undefined {
    for (const c of this.combatants) if (c.id === id) return c;
    return undefined;
  }

  /** Porta il numero di bot a `count`, aggiungendone o togliendone. */
  setBotCount(count: number): void {
    let bots = this.combatants.filter((c) => c.bot !== null);
    while (bots.length > count) {
      this.removeCombatant(bots[bots.length - 1]!.id);
      bots = bots.slice(0, -1);
    }
    // I bot usano a turno le armi che lo prevedono nei loro dati ("bot" nel JSON).
    const usable = this.weapons.flatMap((def, index) => (def.bot ? [index] : []));
    for (let i = bots.length; i < count; i++) {
      const name = BOT.names[i % BOT.names.length]!;
      const weapon = usable.length > 0 ? usable[i % usable.length]! : 0;
      this.addCombatant(`Bot ${name}`, { bot: true, weapon });
    }
  }

  /** Fa rinascere subito (tasto K): non conta come morte. */
  forceRespawn(c: Combatant): void {
    this.respawn(c);
  }

  tick(dt: number = TICK_DT): void {
    this.events.clear();
    this.time += dt;
    this.tickCount++;
    for (const c of this.combatants) {
      if (!c.alive) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0) this.respawn(c);
        continue;
      }
      if (c.bot) updateBot(c, this, dt);
      this.step(c, dt);
    }
    this.updateProjectiles(dt);
  }

  // -------------------------------------------------------------------------------------------
  // Combattenti
  // -------------------------------------------------------------------------------------------

  private step(c: Combatant, dt: number): void {
    const w = c.weapon;
    const p = c.player;
    c.protection = Math.max(0, c.protection - dt);
    this.updateWeapon(c, dt);
    const def = this.weapons[w.current]!;
    p.speedScale = def.moveSpeedFactor * (1 + (def.ads.moveFactor - 1) * w.adsAmount);
    simulateTick(p, c.input, this.world, dt);
    this.handleFire(c);
    this.handleGrenade(c, dt);
    if (p.y < this.map.killY) {
      // Caduta: il punto va a chi ha colpito per ultimo, se è successo da poco.
      const recent = c.lastAttacker >= 0 && this.time - c.lastDamageTime < 3;
      this.kill(c, recent ? c.lastAttacker : c.id, KILLED_BY_FALL, false);
    }
  }

  private updateWeapon(c: Combatant, dt: number): void {
    const w = c.weapon;
    const input = c.input;
    const slot = Math.trunc(input.weaponSlot);
    if (slot >= 1 && slot <= this.weapons.length && slot - 1 !== w.current) this.switchWeapon(c, slot - 1);
    const def = this.weapons[w.current]!;

    if (w.drawTimer > 0) w.drawTimer = Math.max(0, w.drawTimer - dt);

    const reloadPressed = input.reload && !w.reloadHeld;
    w.reloadHeld = input.reload;
    if (reloadPressed && w.drawTimer <= 0) this.startReload(c);
    if (w.reloadTimer > 0) {
      w.reloadTimer -= dt;
      if (w.reloadTimer <= 0) {
        w.reloadTimer = 0;
        w.ammo[w.current] = def.magazine;
        this.action(c, 'reloadEnd');
      }
    }

    const canAim = input.ads && w.reloadTimer <= 0 && w.drawTimer <= 0 && def.kind !== 'melee';
    const adsStep = dt / Math.max(def.ads.time, 1e-3);
    w.adsAmount = clamp(w.adsAmount + (canAim ? adsStep : -adsStep), 0, 1);

    w.sinceShot += dt;
    if (w.fireCooldown > 0) w.fireCooldown -= dt;
    if (w.sinceShot > COMBAT.bloomRecoveryDelay) w.bloom = Math.max(0, w.bloom - def.spread.recovery * dt);
    const decay = Math.exp(-def.recoil.recovery * dt);
    w.recoilPitch *= decay;
    w.recoilYaw *= decay;
    if (w.sinceShot > COMBAT.recoilResetTime) w.shotIndex = 0;
  }

  private switchWeapon(c: Combatant, index: number): void {
    const w = c.weapon;
    w.previous = w.current;
    w.current = index;
    w.drawTimer = this.weapons[index]!.drawTime;
    w.reloadTimer = 0;
    w.adsAmount = 0;
    w.bloom = 0;
    w.shotIndex = 0;
    w.fireCooldown = 0;
    this.action(c, 'switch');
  }

  private startReload(c: Combatant): void {
    const w = c.weapon;
    const def = this.weapons[w.current]!;
    if (def.magazine === 0 || w.reloadTimer > 0 || w.ammo[w.current]! >= def.magazine) return;
    w.reloadTimer = def.reloadTime;
    this.action(c, 'reload');
  }

  private handleFire(c: Combatant): void {
    const w = c.weapon;
    const input = c.input;
    const def = this.weapons[w.current]!;
    const pressed = input.fire && !w.triggerHeld;
    w.triggerHeld = input.fire;
    const blocked = w.drawTimer > 0 || w.reloadTimer > 0;
    if (!input.fire || blocked || (!def.auto && !pressed)) {
      // Senza sparare il tempo non si accumula: niente raffiche "di riserva".
      if (w.fireCooldown < 0) w.fireCooldown = 0;
      return;
    }
    if (w.fireCooldown > 0) return;
    // Caricatore 0 = munizioni infinite (armi corpo a corpo).
    const infinite = def.magazine === 0;
    if (!infinite && w.ammo[w.current]! <= 0) {
      if (pressed) this.action(c, 'dryFire');
      this.startReload(c);
      return;
    }

    if (!infinite) w.ammo[w.current]!--;
    w.fireCooldown += 60 / def.fireRate;
    c.protection = 0;

    // La mira include il rinculo accumulato finora; il colpo appena sparato sposta i successivi.
    const p = c.player;
    const yaw = p.yaw + w.recoilYaw;
    const pitch = clamp(p.pitch + w.recoilPitch, -PLAYER.pitchLimit, PLAYER.pitchLimit);
    const spread = currentSpread(c, def) * DEG_TO_RAD;
    if (def.kind === 'hitscan') this.fireHitscan(c, def, yaw, pitch, spread);
    else if (def.kind === 'projectile') this.fireProjectile(c, def, yaw, pitch, spread);
    else this.fireMelee(c, def, yaw, pitch);

    w.bloom = Math.min(def.spread.max, w.bloom + def.spread.perShot);
    const kick = def.recoil.pattern[recoilPatternIndex(def.recoil.pattern.length, w.shotIndex)]!;
    const recoilScale = (1 + (def.recoil.ads - 1) * w.adsAmount) * DEG_TO_RAD;
    w.recoilPitch += kick[0] * recoilScale;
    w.recoilYaw -= kick[1] * recoilScale;
    w.shotIndex++;
    w.sinceShot = 0;
    if (!infinite && w.ammo[w.current] === 0) this.startReload(c);
  }

  /**
   * Colpo corpo a corpo: cinque raggi corti (centro e quattro a ventaglio, entro `radius`), vince il
   * bersaglio più vicino. Colpire alle spalle moltiplica il danno.
   */
  private fireMelee(c: Combatant, def: WeaponDef, yaw: number, pitch: number): void {
    const melee = def.melee!;
    const p = c.player;
    const ox = p.x;
    const oy = p.y + playerEyeHeight(p);
    const oz = p.z;
    const shot = this.events.shots.add();
    shot.shooter = c.id;
    shot.weapon = c.weapon.current;
    shot.ox = ox;
    shot.oy = oy;
    shot.oz = oz;
    shot.pellets = 1;

    const fan = Math.atan2(melee.radius, melee.reach);
    let bestT = Infinity;
    let victim = -1;
    let region: HitRegion = 'torso';
    let worldT = Infinity;
    for (let ray = 0; ray < 5; ray++) {
      // Il raggio centrale ha la precedenza: quelli a ventaglio servono solo se manca il bersaglio.
      if (ray === 1 && victim >= 0) break;
      const dYaw = ray === 1 ? fan : ray === 2 ? -fan : 0;
      const dPitch = ray === 3 ? fan : ray === 4 ? -fan : 0;
      aimDirection(yaw + dYaw, pitch + dPitch, 0, c.weapon.random);
      raycastWorld(this.world, ox, oy, oz, aim.x, aim.y, aim.z, melee.reach, rayHit);
      if (ray === 0 && rayHit.hit) {
        worldT = rayHit.t;
        shot.normals[0] = rayHit.nx;
        shot.normals[1] = rayHit.ny;
        shot.normals[2] = rayHit.nz;
        shot.targets[0] = rayHit.solid;
      }
      for (let j = 0; j < this.combatants.length; j++) {
        const target = this.combatants[j]!;
        if (target === c || !target.alive) continue;
        if (!raycastBody(target.player, ox, oy, oz, aim.x, aim.y, aim.z, Math.min(rayHit.t, bestT), bodyHit).hit) continue;
        bestT = bodyHit.t;
        victim = j;
        region = bodyHit.region;
        shot.ends[0] = ox + aim.x * bestT;
        shot.ends[1] = oy + aim.y * bestT;
        shot.ends[2] = oz + aim.z * bestT;
      }
    }

    if (victim < 0) {
      aimDirection(yaw, pitch, 0, c.weapon.random);
      const t = Math.min(worldT, melee.reach);
      shot.ends[0] = ox + aim.x * t;
      shot.ends[1] = oy + aim.y * t;
      shot.ends[2] = oz + aim.z * t;
      shot.results[0] = worldT <= melee.reach ? SHOT_WORLD : SHOT_MISS;
      if (shot.results[0] === SHOT_MISS) shot.targets[0] = -1;
      return;
    }

    const target = this.combatants[victim]!;
    shot.results[0] = SHOT_BODY;
    shot.targets[0] = target.id;
    // Alle spalle: il bersaglio guarda nella stessa direzione in cui si colpisce.
    const t = target.player;
    let dx = t.x - p.x;
    let dz = t.z - p.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const facing = -Math.sin(t.yaw) * dx - Math.cos(t.yaw) * dz;
    const backstab = facing > 0.5;
    const damage = def.damage * regionMultiplier(def, region) * (backstab ? melee.backstabMultiplier : 1);
    this.applyDamage(target, c.id, damage, region, shot.ends[0]!, shot.ends[1]!, shot.ends[2]!, c.weapon.current, region === 'head');
  }

  private fireHitscan(c: Combatant, def: WeaponDef, yaw: number, pitch: number, spread: number): void {
    const p = c.player;
    const w = c.weapon;
    const ox = p.x;
    const oy = p.y + playerEyeHeight(p);
    const oz = p.z;
    const shot = this.events.shots.add();
    shot.shooter = c.id;
    shot.weapon = w.current;
    shot.ox = ox;
    shot.oy = oy;
    shot.oz = oz;
    shot.pellets = Math.min(def.pellets, MAX_PELLETS);

    const count = this.combatants.length;
    for (let j = 0; j < count; j++) {
      this.pendingDamage[j] = 0;
      this.pendingHead[j] = false;
    }

    for (let i = 0; i < shot.pellets; i++) {
      aimDirection(yaw, pitch, spread, w.random);
      const dx = aim.x;
      const dy = aim.y;
      const dz = aim.z;
      raycastWorld(this.world, ox, oy, oz, dx, dy, dz, COMBAT.hitscanRange, rayHit);
      let range = rayHit.t;
      let victim = -1;
      let region: HitRegion = 'torso';
      for (let j = 0; j < count; j++) {
        const target = this.combatants[j]!;
        if (target === c || !target.alive) continue;
        if (!raycastBody(target.player, ox, oy, oz, dx, dy, dz, range, bodyHit).hit) continue;
        range = bodyHit.t;
        victim = j;
        region = bodyHit.region;
      }

      const k = i * 3;
      shot.ends[k] = ox + dx * range;
      shot.ends[k + 1] = oy + dy * range;
      shot.ends[k + 2] = oz + dz * range;
      if (victim >= 0) {
        shot.results[i] = SHOT_BODY;
        shot.targets[i] = this.combatants[victim]!.id;
        const damage = def.damage * regionMultiplier(def, region) * damageFalloff(def, range);
        if (this.pendingDamage[victim] === 0) {
          this.pendingRegion[victim] = region;
          this.pendingPoint[victim * 3] = shot.ends[k]!;
          this.pendingPoint[victim * 3 + 1] = shot.ends[k + 1]!;
          this.pendingPoint[victim * 3 + 2] = shot.ends[k + 2]!;
        }
        this.pendingDamage[victim]! += damage;
        if (region === 'head') this.pendingHead[victim] = true;
      } else if (rayHit.hit) {
        shot.results[i] = SHOT_WORLD;
        shot.targets[i] = rayHit.solid;
        shot.normals[k] = rayHit.nx;
        shot.normals[k + 1] = rayHit.ny;
        shot.normals[k + 2] = rayHit.nz;
      } else {
        shot.results[i] = SHOT_MISS;
        shot.targets[i] = -1;
      }
    }

    for (let j = 0; j < count; j++) {
      const amount = this.pendingDamage[j]!;
      if (amount <= 0) continue;
      const head = this.pendingHead[j]!;
      this.applyDamage(
        this.combatants[j]!,
        c.id,
        amount,
        head ? 'head' : this.pendingRegion[j]!,
        this.pendingPoint[j * 3]!,
        this.pendingPoint[j * 3 + 1]!,
        this.pendingPoint[j * 3 + 2]!,
        w.current,
        head,
      );
    }
  }

  private fireProjectile(c: Combatant, def: WeaponDef, yaw: number, pitch: number, spread: number): void {
    const p = c.player;
    const shot = this.events.shots.add();
    shot.shooter = c.id;
    shot.weapon = c.weapon.current;
    shot.ox = p.x;
    shot.oy = p.y + playerEyeHeight(p);
    shot.oz = p.z;
    shot.pellets = 0;
    aimDirection(yaw, pitch, spread, c.weapon.random);
    this.launch(c, def.projectile!, c.weapon.current, def.projectile!.speed, 0, 0);
  }

  private handleGrenade(c: Combatant, dt: number): void {
    const w = c.weapon;
    w.grenadeCooldown = Math.max(0, w.grenadeCooldown - dt);
    const pressed = c.input.grenade && !w.grenadeHeld;
    w.grenadeHeld = c.input.grenade;
    if (!pressed || w.grenades <= 0 || w.grenadeCooldown > 0 || w.drawTimer > 0) return;
    w.grenades--;
    w.grenadeCooldown = this.grenade.cooldown;
    c.protection = 0;
    aimDirection(c.player.yaw, c.player.pitch, 0, w.random);
    const g = this.grenade;
    this.launch(c, g.projectile, KILLED_BY_GRENADE, g.projectile.speed, g.throwUp, g.inheritVelocity);
    this.action(c, 'throw');
  }

  /** Lancia un proiettile nella direzione in `aim`, partendo poco davanti agli occhi. */
  private launch(c: Combatant, def: ProjectileDef, weapon: number, speed: number, extraUp: number, inherit: number): void {
    const p = c.player;
    const ex = p.x;
    const ey = p.y + playerEyeHeight(p);
    const ez = p.z;
    const dx = aim.x;
    const dy = aim.y;
    const dz = aim.z;
    raycastWorld(this.world, ex, ey, ez, dx, dy, dz, COMBAT.projectileSpawnDistance, rayHit);
    const start = rayHit.hit ? Math.max(0, rayHit.t - def.radius) : COMBAT.projectileSpawnDistance;

    const pr = this.allocateProjectile();
    pr.active = true;
    pr.serial = ++this.projectileSerial;
    pr.owner = c.id;
    pr.weapon = weapon;
    pr.def = def;
    pr.x = ex + dx * start;
    pr.y = ey + dy * start;
    pr.z = ez + dz * start;
    pr.px = pr.x;
    pr.py = pr.y;
    pr.pz = pr.z;
    pr.vx = dx * speed + p.vx * inherit;
    pr.vy = dy * speed + extraUp + p.vy * inherit;
    pr.vz = dz * speed + p.vz * inherit;
    pr.age = 0;
    pr.resting = false;
  }

  private allocateProjectile(): Projectile {
    let oldest = this.projectiles[0]!;
    for (const pr of this.projectiles) {
      if (!pr.active) return pr;
      if (pr.age > oldest.age) oldest = pr;
    }
    return oldest;
  }

  // -------------------------------------------------------------------------------------------
  // Proiettili ed esplosioni
  // -------------------------------------------------------------------------------------------

  private updateProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (!pr.active) continue;
      pr.px = pr.x;
      pr.py = pr.y;
      pr.pz = pr.z;
      pr.age += dt;
      const def = pr.def;
      if ((def.fuse > 0 && pr.age >= def.fuse) || pr.age >= def.lifetime) {
        this.explode(pr, pr.x, pr.y, pr.z);
        continue;
      }
      if (pr.resting) continue;

      pr.vy -= def.gravity * dt;
      const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
      if (speed < 1e-6) continue;
      const distance = speed * dt;
      const dx = pr.vx / speed;
      const dy = pr.vy / speed;
      const dz = pr.vz / speed;
      raycastWorld(this.world, pr.x, pr.y, pr.z, dx, dy, dz, distance + def.radius, rayHit);
      const wallT = rayHit.hit ? Math.max(0, rayHit.t - def.radius) : Infinity;

      if (def.kind === 'rocket') {
        // Impatto diretto su un corpo (box di collisione allargato dal raggio del razzo).
        let bodyT = Infinity;
        for (const target of this.combatants) {
          if (!target.alive || target.id === pr.owner) continue;
          const t = target.player;
          const r = PLAYER.radius + def.radius;
          const hit = rayAabb(
            pr.x,
            pr.y,
            pr.z,
            dx,
            dy,
            dz,
            t.x - r,
            t.y - def.radius,
            t.z - r,
            t.x + r,
            t.y + playerHeight(t) + def.radius,
            t.z + r,
            Math.min(distance, bodyT),
          );
          if (hit >= 0) bodyT = hit;
        }
        const impactT = Math.min(wallT, bodyT);
        if (impactT <= distance) {
          let x = pr.x + dx * impactT;
          let y = pr.y + dy * impactT;
          let z = pr.z + dz * impactT;
          if (wallT <= bodyT && rayHit.hit) {
            // Un po' fuori dal muro, così la linea di vista dell'esplosione non parte da dentro.
            x += rayHit.nx * 0.05;
            y += rayHit.ny * 0.05;
            z += rayHit.nz * 0.05;
          }
          this.explode(pr, x, y, z);
          continue;
        }
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        pr.z += pr.vz * dt;
        continue;
      }

      // Granata: rimbalza sui solidi.
      if (rayHit.hit && wallT <= distance) {
        const nx = rayHit.nx;
        const ny = rayHit.ny;
        const nz = rayHit.nz;
        pr.x = rayHit.x + nx * def.radius;
        pr.y = rayHit.y + ny * def.radius;
        pr.z = rayHit.z + nz * def.radius;
        const vn = pr.vx * nx + pr.vy * ny + pr.vz * nz;
        const tx = pr.vx - vn * nx;
        const ty = pr.vy - vn * ny;
        const tz = pr.vz - vn * nz;
        pr.vx = tx * def.friction - vn * def.bounce * nx;
        pr.vy = ty * def.friction - vn * def.bounce * ny;
        pr.vz = tz * def.friction - vn * def.bounce * nz;
        if (Math.abs(vn) > 2) this.actionAt(pr.owner, 'bounce', pr.x, pr.y, pr.z);
        if (ny > 0.6 && Math.hypot(pr.vx, pr.vy, pr.vz) < 1.2) {
          pr.resting = true;
          pr.vx = 0;
          pr.vy = 0;
          pr.vz = 0;
        }
        continue;
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.z += pr.vz * dt;
    }
  }

  private explode(pr: Projectile, x: number, y: number, z: number): void {
    pr.active = false;
    pr.x = x;
    pr.y = y;
    pr.z = z;
    const def = pr.def;
    const event = this.events.explosions.add();
    event.owner = pr.owner;
    event.weapon = pr.weapon;
    event.x = x;
    event.y = y;
    event.z = z;
    event.radius = def.splashRadius;

    for (const target of this.combatants) {
      if (!target.alive) continue;
      const p = target.player;
      const h = playerHeight(p);
      // Distanza dal punto più vicino del corpo.
      const cx = clamp(x, p.x - PLAYER.radius, p.x + PLAYER.radius);
      const cy = clamp(y, p.y, p.y + h);
      const cz = clamp(z, p.z - PLAYER.radius, p.z + PLAYER.radius);
      const distance = Math.hypot(x - cx, y - cy, z - cz);
      if (distance >= def.splashRadius) continue;
      const tx = p.x;
      const ty = p.y + h * 0.55;
      const tz = p.z;
      if (!lineOfSight(this.world, x, y, z, tx, ty, tz)) continue;

      const falloff = 1 - (distance / def.splashRadius) * (1 - def.minSplashFactor);
      const self = target.id === pr.owner;
      // Spinta: lontano dal centro, con una componente verso l'alto.
      let kx = tx - x;
      let ky = ty - y;
      let kz = tz - z;
      let length = Math.hypot(kx, ky, kz);
      if (length < 1e-6) {
        kx = 0;
        ky = 1;
        kz = 0;
        length = 1;
      }
      kx /= length;
      ky = ky / length + COMBAT.explosionUpwardBias;
      kz /= length;
      length = Math.hypot(kx, ky, kz);
      const impulse = (def.knockback * falloff * (self ? def.selfKnockbackFactor : 1)) / length;
      p.vx += kx * impulse;
      p.vy += ky * impulse;
      p.vz += kz * impulse;
      if (p.vy > 0) p.grounded = false;

      const damage = def.splashDamage * falloff * (self ? def.selfDamageFactor : 1);
      this.applyDamage(target, pr.owner, damage, 'torso', cx, cy, cz, pr.weapon, false);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Danni, morti, rinascite
  // -------------------------------------------------------------------------------------------

  private applyDamage(
    target: Combatant,
    attackerId: number,
    amount: number,
    region: HitRegion,
    x: number,
    y: number,
    z: number,
    weapon: number,
    headshot: boolean,
  ): void {
    if (!target.alive || amount <= 0 || target.protection > 0) return;
    const dealt = Math.min(amount, target.health);
    target.health -= amount;
    if (attackerId !== target.id) {
      target.lastAttacker = attackerId;
      target.lastDamageTime = this.time;
    }
    const killed = target.health <= 0;
    const hit = this.events.hits.add();
    hit.attacker = attackerId;
    hit.target = target.id;
    hit.damage = dealt;
    hit.region = region;
    hit.headshot = headshot;
    hit.killed = killed;
    hit.x = x;
    hit.y = y;
    hit.z = z;
    if (killed) this.kill(target, attackerId, weapon, headshot);
  }

  private kill(victim: Combatant, killerId: number, weapon: number, headshot: boolean): void {
    victim.alive = false;
    victim.health = 0;
    victim.respawnTimer = COMBAT.respawnTime;
    victim.deaths++;
    victim.killedBy = killerId;
    victim.killedByWeapon = weapon;
    victim.weapon.triggerHeld = false;
    if (killerId !== victim.id) {
      const killer = this.getCombatant(killerId);
      if (killer) killer.kills++;
    }
    const event = this.events.kills.add();
    event.killer = killerId;
    event.victim = victim.id;
    event.weapon = weapon;
    event.headshot = headshot;
  }

  private respawn(c: Combatant): void {
    const spawn = this.map.spawns[this.chooseSpawn(c)]!;
    spawnPlayer(c.player, spawn);
    c.health = COMBAT.maxHealth;
    c.alive = true;
    c.respawnTimer = 0;
    c.protection = COMBAT.spawnProtection;
    c.lastAttacker = -1;
    c.lastDamageTime = -Infinity;
    refillWeaponState(c.weapon, this);
    c.input.yaw = c.player.yaw;
    c.input.pitch = 0;
    if (c.bot) resetBotState(c.bot);
    this.action(c, 'respawn');
  }

  /** Il punto di rinascita più lontano dai nemici vivi (con un po' di caso a parità). */
  private chooseSpawn(c: Combatant): number {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < this.map.spawns.length; i++) {
      const [x, y, z] = this.map.spawns[i]!.pos;
      let nearest = Infinity;
      for (const other of this.combatants) {
        if (other === c || !other.alive) continue;
        nearest = Math.min(nearest, Math.hypot(other.player.x - x, other.player.y - y, other.player.z - z));
      }
      const score = (nearest === Infinity ? 0 : nearest) + random(this.random) * 2;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private action(c: Combatant, type: ActionType): void {
    this.actionAt(c.id, type, c.player.x, c.player.y, c.player.z);
  }

  private actionAt(combatant: number, type: ActionType, x: number, y: number, z: number): void {
    const event = this.events.actions.add();
    event.combatant = combatant;
    event.type = type;
    event.x = x;
    event.y = y;
    event.z = z;
  }
}
