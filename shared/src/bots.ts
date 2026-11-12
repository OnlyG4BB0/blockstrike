/**
 * Bot semplici: girano tra i punti di navigazione, notano i nemici che vedono, reagiscono con
 * un ritardo, mirano con un errore che si riduce col tempo, sparano a raffiche e si spostano di lato.
 * Producono gli stessi comandi di un giocatore: il resto della simulazione è identico.
 */
import { BOT, PLAYER } from './constants.ts';
import type { Combatant, Match } from './match.ts';
import { DEG_TO_RAD, clamp } from './math.ts';
import { nearestNode } from './navigation.ts';
import { playerEyeHeight, playerHeight } from './player.ts';
import { createRandom, random, randomInt, randomRange, type RandomState } from './random.ts';
import { lineOfSight } from './raycast.ts';
import { WEAPONS } from './weapons.ts';

/** fight = combattono; roam = girano senza sparare; idle = fermi. */
export type BotMode = 'fight' | 'roam' | 'idle';

export interface BotState {
  random: RandomState;
  /** Punto di navigazione verso cui si sta andando (-1 = da scegliere). */
  node: number;
  previousNode: number;
  checkTimer: number;
  checkX: number;
  checkZ: number;
  stuckTime: number;
  /** Combattente preso di mira (-1 = nessuno). */
  target: number;
  aimHead: boolean;
  reaction: number;
  aimErrorYaw: number;
  aimErrorPitch: number;
  strafe: number;
  strafeTimer: number;
  burstTimer: number;
  bursting: boolean;
  semiTimer: number;
  perceptionTimer: number;
  preferredRange: number;
}

export function createBotState(seed: number, weapon: number): BotState {
  return {
    random: createRandom(seed),
    node: -1,
    previousNode: -1,
    checkTimer: BOT.stuckCheckInterval,
    checkX: 0,
    checkZ: 0,
    stuckTime: 0,
    target: -1,
    aimHead: false,
    reaction: 0,
    aimErrorYaw: 0,
    aimErrorPitch: 0,
    strafe: 0,
    strafeTimer: 0,
    burstTimer: 0,
    bursting: false,
    semiTimer: 0,
    perceptionTimer: 0,
    preferredRange: BOT.preferredRange[weapon] ?? 15,
  };
}

export function resetBotState(b: BotState): void {
  b.node = -1;
  b.previousNode = -1;
  b.stuckTime = 0;
  b.checkTimer = BOT.stuckCheckInterval;
  b.target = -1;
  b.bursting = false;
  b.burstTimer = 0;
  b.perceptionTimer = 0;
}

const DEG = DEG_TO_RAD;
const TWO_PI = Math.PI * 2;

function wrapAngle(angle: number): number {
  return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
}

/** Differenza a - b ridotta tra -π e π. */
function angleDiff(a: number, b: number): number {
  return wrapAngle(a - b);
}

function turnToward(current: number, target: number, maxStep: number): number {
  return wrapAngle(current + clamp(angleDiff(target, current), -maxStep, maxStep));
}

/** Yaw per guardare nella direzione (dx, dz). */
function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Calcola i comandi del bot per questo tick. */
export function updateBot(c: Combatant, match: Match, dt: number): void {
  const b = c.bot;
  if (!b) return;
  const p = c.player;
  const input = c.input;
  input.forward = 0;
  input.right = 0;
  input.jump = false;
  input.crouch = false;
  input.fire = false;
  input.ads = false;
  input.reload = false;
  input.grenade = false;
  input.weaponSlot = 0;
  input.yaw = p.yaw;
  input.pitch = p.pitch;
  if (match.botMode === 'idle') return;

  b.perceptionTimer -= dt;
  if (b.perceptionTimer <= 0) {
    b.perceptionTimer = BOT.perceptionInterval;
    perceive(c, match);
  }
  const target = b.target >= 0 ? match.getCombatant(b.target) : undefined;
  if (target && target.alive && match.botMode === 'fight') {
    engage(c, target, dt);
  } else {
    b.target = -1;
    patrol(c, match, dt);
  }
}

/** Sceglie il nemico visibile più vicino (preferendo quello già preso di mira). */
function perceive(c: Combatant, match: Match): void {
  const b = c.bot!;
  const p = c.player;
  const eyeY = p.y + playerEyeHeight(p);
  let best = -1;
  let bestScore = Infinity;
  if (match.botMode === 'fight') {
    for (const other of match.combatants) {
      if (other === c || !other.alive) continue;
      const o = other.player;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const distance = Math.hypot(dx, o.y - p.y, dz);
      if (distance > BOT.sightRange) continue;
      const recentAttacker = c.lastAttacker === other.id && match.time - c.lastDamageTime < BOT.investigateTime;
      if (distance > BOT.hearingRange && !recentAttacker) {
        if (Math.abs(angleDiff(yawTo(dx, dz), p.yaw)) > BOT.fieldOfView * DEG) continue;
      }
      const h = playerHeight(o);
      const visible =
        lineOfSight(match.world, p.x, eyeY, p.z, o.x, o.y + h - 0.17, o.z) ||
        lineOfSight(match.world, p.x, eyeY, p.z, o.x, o.y + h * 0.6, o.z);
      if (!visible) continue;
      const score = other.id === b.target ? distance * 0.7 : distance;
      if (score < bestScore) {
        bestScore = score;
        best = other.id;
      }
    }
  }
  if (best === b.target) return;
  b.target = best;
  if (best < 0) return;
  // Nuovo bersaglio: tempo di reazione ed errore di mira iniziale.
  b.reaction = randomRange(b.random, BOT.reactionMin, BOT.reactionMax);
  b.aimErrorYaw = randomRange(b.random, -1, 1) * BOT.initialAimError * DEG;
  b.aimErrorPitch = randomRange(b.random, -0.6, 0.6) * BOT.initialAimError * DEG;
  b.aimHead = random(b.random) < BOT.headAimChance;
  b.bursting = false;
  b.burstTimer = 0;
  b.semiTimer = 0;
}

function engage(c: Combatant, target: Combatant, dt: number): void {
  const b = c.bot!;
  const p = c.player;
  const input = c.input;
  const t = target.player;
  const h = playerHeight(t);
  const aimY = b.aimHead ? t.y + h - 0.17 : t.y + h * 0.6;
  const dx = t.x - p.x;
  const dy = aimY - (p.y + playerEyeHeight(p));
  const dz = t.z - p.z;
  const flat = Math.hypot(dx, dz);
  const distance = Math.hypot(flat, dy);
  const desiredYaw = yawTo(dx, dz);
  const desiredPitch = Math.atan2(dy, flat);

  // Mira: l'errore iniziale si riduce, resta un leggero tremolio.
  const settle = Math.exp(-BOT.aimSettleRate * dt);
  b.aimErrorYaw *= settle;
  b.aimErrorPitch *= settle;
  const jitter = BOT.aimJitter * DEG;
  const aimYaw = desiredYaw + b.aimErrorYaw + (random(b.random) - 0.5) * jitter;
  const aimPitch = desiredPitch + b.aimErrorPitch + (random(b.random) - 0.5) * jitter;
  input.yaw = turnToward(p.yaw, aimYaw, BOT.turnRate * dt);
  input.pitch = clamp(p.pitch + clamp(aimPitch - p.pitch, -BOT.turnRate * dt, BOT.turnRate * dt), -PLAYER.pitchLimit, PLAYER.pitchLimit);

  b.reaction -= dt;
  const cone = Math.max(BOT.fireCone * DEG, Math.atan2(0.45, distance));
  const aligned = Math.abs(angleDiff(input.yaw, desiredYaw)) < cone && Math.abs(input.pitch - desiredPitch) < cone;
  const def = WEAPONS[c.weapon.current]!;
  if (b.reaction <= 0 && aligned) {
    if (def.auto) {
      b.burstTimer -= dt;
      if (b.burstTimer <= 0) {
        b.bursting = !b.bursting;
        b.burstTimer = b.bursting
          ? randomRange(b.random, BOT.burstMin, BOT.burstMax)
          : randomRange(b.random, BOT.pauseMin, BOT.pauseMax);
      }
      input.fire = b.bursting;
    } else {
      b.semiTimer -= dt;
      if (b.semiTimer <= 0) {
        input.fire = true;
        b.semiTimer = 60 / def.fireRate + randomRange(b.random, BOT.semiDelayMin, BOT.semiDelayMax);
      }
    }
  }

  // Movimento: spostamenti laterali e distanza preferita dall'arma.
  b.strafeTimer -= dt;
  if (b.strafeTimer <= 0) {
    const r = random(b.random);
    b.strafe = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
    b.strafeTimer = randomRange(b.random, BOT.strafeMin, BOT.strafeMax);
  }
  input.right = b.strafe;
  if (flat > b.preferredRange * 1.3) input.forward = 1;
  else if (flat < b.preferredRange * 0.5) input.forward = -1;
  if (p.grounded && random(b.random) < BOT.jumpChancePerSecond * dt) input.jump = true;
}

function patrol(c: Combatant, match: Match, dt: number): void {
  const b = c.bot!;
  const p = c.player;
  const input = c.input;
  input.pitch = p.pitch + clamp(-p.pitch, -BOT.turnRate * dt, BOT.turnRate * dt);

  // Colpito da qualcuno che non si vede: ci si gira verso di lui.
  if (c.lastAttacker >= 0 && match.time - c.lastDamageTime < BOT.investigateTime) {
    const attacker = match.getCombatant(c.lastAttacker);
    if (attacker && attacker.alive && attacker !== c) {
      input.yaw = turnToward(p.yaw, yawTo(attacker.player.x - p.x, attacker.player.z - p.z), BOT.turnRate * dt);
      return;
    }
  }

  const def = WEAPONS[c.weapon.current]!;
  if (c.weapon.ammo[c.weapon.current]! < def.magazine * 0.4 && c.weapon.reloadTimer <= 0) input.reload = true;

  const graph = match.nav;
  if (graph.nodes.length === 0) {
    // Nessun punto di navigazione: vaga.
    input.yaw = wrapAngle(p.yaw + (random(b.random) - 0.5) * 4 * dt);
    input.forward = 1;
    checkStuck(c, dt);
    return;
  }
  if (b.node < 0) {
    b.node = nearestNode(match.world, graph, p.x, p.y, p.z);
    b.previousNode = -1;
  }
  let node = graph.nodes[b.node]!;
  let dx = node[0] - p.x;
  let dz = node[2] - p.z;
  let distance = Math.hypot(dx, dz);
  if (distance < BOT.waypointReach) {
    const links = graph.links[b.node]!;
    let next = b.node;
    if (links.length > 0) {
      next = links[randomInt(b.random, links.length)]!;
      if (next === b.previousNode && links.length > 1) {
        const index = links.indexOf(next);
        next = links[(index + 1 + randomInt(b.random, links.length - 1)) % links.length]!;
      }
    }
    b.previousNode = b.node;
    b.node = next;
    node = graph.nodes[b.node]!;
    dx = node[0] - p.x;
    dz = node[2] - p.z;
    distance = Math.hypot(dx, dz);
  }
  const desiredYaw = yawTo(dx, dz);
  input.yaw = turnToward(p.yaw, desiredYaw, BOT.turnRate * dt * 0.6);
  if (Math.abs(angleDiff(input.yaw, desiredYaw)) < 1) input.forward = 1;
  // Qualche salto lungo i tratti lunghi, per non essere bersagli facili.
  if (p.grounded && distance > 8 && random(b.random) < 0.4 * dt) input.jump = true;

  if (checkStuck(c, dt)) {
    b.node = nearestNode(match.world, graph, p.x, p.y, p.z);
    b.previousNode = -1;
  }
}

/** Se il bot non avanza prova a saltare; restituisce true quando conviene cambiare percorso. */
function checkStuck(c: Combatant, dt: number): boolean {
  const b = c.bot!;
  const p = c.player;
  b.checkTimer -= dt;
  if (b.checkTimer > 0) return false;
  b.checkTimer = BOT.stuckCheckInterval;
  const moved = Math.hypot(p.x - b.checkX, p.z - b.checkZ);
  b.checkX = p.x;
  b.checkZ = p.z;
  if (moved >= BOT.stuckMinProgress || c.input.forward === 0) {
    b.stuckTime = 0;
    return false;
  }
  b.stuckTime += BOT.stuckCheckInterval;
  c.input.jump = true;
  if (b.stuckTime < BOT.giveUpTime) return false;
  b.stuckTime = 0;
  return true;
}
