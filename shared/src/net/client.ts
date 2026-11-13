/**
 * Logica del client in rete, senza trasporto: un comando per tick in uscita, pacchetti di stato in
 * ingresso.
 *
 * - Predizione: il proprio giocatore avanza subito con lo stesso codice del server. Per ogni comando
 *   si tiene lo stato predetto; quando il server conferma il comando N si confronta: se coincide non
 *   si fa nulla, altrimenti (spinta di un'esplosione, comando scartato) si riparte dallo stato del
 *   server e si rieseguono i comandi successivi.
 * - Interpolazione: gli altri si disegnano NET.interpolationDelay tick nel passato, tra due pacchetti.
 *   Il tick a cui li si vede viaggia con ogni comando: il server riavvolge le hitbox fino a lì.
 * - Eventi: quelli che riguardano il giocatore (colpi dati e subiti, morte) si mostrano subito, gli
 *   altri quando l'interpolazione arriva al loro tick, insieme a corpi e razzi.
 */
import { NET } from '../constants.ts';
import type { ActionType } from '../events.ts';
import type { MapData } from '../map.ts';
import { Match, type Combatant } from '../match.ts';
import { copyPlayerState, createInput, createPlayerState, type PlayerInput, type PlayerState } from '../player.ts';
import { copyAnimState, lerpAnimState, poseBody } from '../pose.ts';
import { KILLED_BY_GRENADE, type CombatContent } from '../weapons.ts';
import { ByteReader, ByteWriter } from './codec.ts';
import {
  captureWeapon,
  createMatchInfo,
  createProjectileSnapshot,
  createRemoteSnapshot,
  createSnapshot,
  createWeaponCore,
  quantizeInput,
  readEvents,
  readSnapshot,
  restoreWeapon,
  sameState,
  stateDifference,
  writeInput,
  type EventFilter,
  type MatchInfo,
  type ProjectileSnapshot,
  type RemoteSnapshot,
  type WeaponCore,
} from './protocol.ts';
import type { RosterEntry } from './server.ts';

const INPUT_HISTORY = 256;
const FRAME_HISTORY = 32;

interface Predicted {
  seq: number;
  input: PlayerInput;
  /** Stato dopo il comando (valido se `predicted`). */
  predicted: boolean;
  player: PlayerState;
  weapon: WeaponCore;
}

interface Frame {
  tick: number;
  remoteCount: number;
  remotes: RemoteSnapshot[];
  projectileCount: number;
  projectiles: ProjectileSnapshot[];
}

interface PendingEvents {
  tick: number;
  bytes: Uint8Array;
}

/** Predicati: dove si mostrano gli eventi del server. */
const PREDICTED_ACTIONS: readonly ActionType[] = ['reload', 'reloadEnd', 'switch', 'dryFire', 'throw'];

export class ClientCore {
  readonly match: Match;
  readonly info: MatchInfo = createMatchInfo();
  readonly roster = new Map<number, RosterEntry>();
  readonly stats = { snapshots: 0, mismatches: 0, replays: 0, respawns: 0, lastMismatch: '', rtt: 0 };
  local: Combatant | null = null;
  /** Stima del tick del server (frazionaria), avanza di uno a ogni tick del client. */
  serverTick = 0;
  /** Ultimo comando confermato dal server. */
  ackSeq = 0;
  /** Tick del server a cui sono davvero disegnati gli altri (viaggia con i comandi). */
  viewTick = 0;
  /** Orologio in millisecondi (per misurare il ping); nei test si usa un tempo finto. */
  now: () => number = () => Date.now();

  private seq = 0;
  private started = false;
  private readonly sentAt = new Float64Array(INPUT_HISTORY);
  private readonly predictions: Predicted[] = [];
  private readonly frames: Frame[] = [];
  private frameCount = 0;
  private readonly immediate: PendingEvents[] = [];
  private readonly delayed: PendingEvents[] = [];
  private readonly snapshot = createSnapshot();
  private readonly reader = new ByteReader();
  private readonly eventReader = new ByteReader();
  private readonly writer = new ByteWriter(64);
  private readonly seen = new Set<number>();

  private readonly immediateFilter: EventFilter;
  private readonly delayedFilter: EventFilter;

  constructor(map: MapData, content: CombatContent) {
    this.match = new Match(map, content, { authoritative: false });
    for (let i = 0; i < INPUT_HISTORY; i++) {
      this.predictions.push({ seq: -1, input: createInput(), predicted: false, player: createPlayerState(), weapon: createWeaponCore() });
    }
    for (let i = 0; i < FRAME_HISTORY; i++) this.frames.push({ tick: -1, remoteCount: 0, remotes: [], projectileCount: 0, projectiles: [] });
    const mine = (id: number) => this.local !== null && id === this.local.id;
    // Subito: ciò che riguarda il giocatore (i suoi spari e le sue azioni sono già predetti).
    this.immediateFilter = {
      shot: () => false,
      hit: (attacker, target) => mine(attacker) || mine(target),
      kill: (killer, victim) => mine(killer) || mine(victim),
      explosion: () => false,
      action: (combatant, type) => mine(combatant) && type === 'respawn',
    };
    // Al tick dell'interpolazione: tutto il resto.
    this.delayedFilter = {
      shot: (shooter) => !mine(shooter),
      hit: (attacker, target) => !mine(attacker) && !mine(target),
      kill: (killer, victim) => !mine(killer) && !mine(victim),
      explosion: () => true,
      action: (combatant, type) => !(mine(combatant) && (PREDICTED_ACTIONS.includes(type) || type === 'respawn')),
    };
  }

  /** Tick del server a cui si disegnano gli altri. */
  get renderTick(): number {
    return this.serverTick - NET.interpolationDelay;
  }

  /** Benvenuto dal server: id del proprio combattente e tick corrente. */
  welcome(id: number, tick: number, name: string, classIndex: number): Combatant {
    this.serverTick = tick;
    this.started = true;
    this.local = this.match.addCombatant(name, { driver: 'input', id, classIndex });
    return this.local;
  }

  setRoster(entries: readonly RosterEntry[]): void {
    this.roster.clear();
    for (const entry of entries) {
      this.roster.set(entry.id, entry);
      const c = this.match.getCombatant(entry.id);
      if (c) {
        c.name = entry.name;
        c.team = entry.team;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pacchetti dal server
  // -------------------------------------------------------------------------------------------

  receive(bytes: Uint8Array): void {
    const snap = readSnapshot(this.reader.reset(bytes), this.snapshot);
    this.stats.snapshots++;
    // Orologio: si segue il tick del server senza scatti.
    const error = snap.tick - this.serverTick;
    if (!this.started || Math.abs(error) > NET.clockSnap) this.serverTick = snap.tick;
    else this.serverTick += error * NET.clockCorrection;
    this.started = true;

    const info = snap.info;
    this.info.mode = info.mode;
    this.info.phase = info.phase;
    this.info.timeLeft = info.timeLeft;
    this.info.scoreLimit = info.scoreLimit;
    this.info.scoreA = info.scoreA;
    this.info.scoreB = info.scoreB;
    this.info.winner = info.winner;
    this.info.flags.length = info.flags.length;
    for (let i = 0; i < info.flags.length; i++) this.info.flags[i] = { ...info.flags[i]! };

    if (snap.hasLocal && this.local) this.reconcile(snap.ackSeq);
    // Ping: dal comando inviato alla sua conferma (comprende l'attesa in coda sul server).
    if (snap.ackSeq > this.ackSeq) {
      const sent = this.sentAt[snap.ackSeq % INPUT_HISTORY]!;
      if (sent > 0) {
        const rtt = this.now() - sent;
        this.stats.rtt = this.stats.rtt === 0 ? rtt : this.stats.rtt + (rtt - this.stats.rtt) * 0.1;
      }
    }
    this.ackSeq = snap.ackSeq;

    // Fotogramma per l'interpolazione.
    const frame = this.frames[this.frameCount % FRAME_HISTORY]!;
    this.frameCount++;
    frame.tick = snap.tick;
    frame.remoteCount = snap.remoteCount;
    while (frame.remotes.length < snap.remoteCount) frame.remotes.push(createRemoteSnapshot());
    for (let i = 0; i < snap.remoteCount; i++) {
      const from = snap.remotes[i]!;
      const to = frame.remotes[i]!;
      const anim = to.anim;
      Object.assign(to, from);
      to.anim = anim;
      copyAnimState(anim, from.anim);
    }
    frame.projectileCount = snap.projectileCount;
    while (frame.projectiles.length < snap.projectileCount) frame.projectiles.push(createProjectileSnapshot());
    for (let i = 0; i < snap.projectileCount; i++) Object.assign(frame.projectiles[i]!, snap.projectiles[i]!);

    for (let i = 0; i < snap.eventCount; i++) {
      const pending = { tick: snap.eventTicks[i]!, bytes: snap.eventBytes[i]! };
      this.immediate.push(pending);
      this.delayed.push(pending);
    }
  }

  /** Confronta lo stato del server con la predizione; se diverge riparte da lì. */
  private reconcile(ack: number): void {
    const c = this.local!;
    const s = this.snapshot.local;
    c.health = s.health;
    c.maxHealth = s.maxHealth;
    c.protection = s.protection;
    c.respawnTimer = s.respawnTimer;
    c.team = s.team;
    c.killedBy = s.killedBy;
    c.killedByWeapon = s.killedByWeapon;
    c.kills = s.kills;
    c.deaths = s.deaths;
    c.streak = s.streak;
    // Classe cambiata alla rinascita: vita, velocità, salto e armi dalla classe.
    if (c.classIndex !== s.classIndex) this.match.applyClass(c, s.classIndex);
    if (!s.alive) {
      c.alive = false;
      return;
    }
    const entry = this.predictions[ack % INPUT_HISTORY]!;
    const respawned = !c.alive;
    if (respawned) {
      this.stats.respawns++;
    } else if (entry.seq === ack && entry.predicted && sameState(entry.player, entry.weapon, s.player, s.weapon)) {
      // Predizione giusta: niente da fare.
      return;
    } else if (entry.seq === ack) {
      this.stats.mismatches++;
      this.stats.lastMismatch = entry.predicted
        ? stateDifference(entry.player, entry.weapon, s.player, s.weapon)
        : 'comando non predetto';
    }
    c.alive = true;
    copyPlayerState(c.player, s.player);
    restoreWeapon(c.weapon, s.weapon);
    // Rigioca i comandi non ancora confermati.
    for (let seq = ack + 1; seq <= this.seq; seq++) {
      const p = this.predictions[seq % INPUT_HISTORY]!;
      if (p.seq !== seq) continue;
      this.apply(p.input);
      this.match.stepCombatant(c);
      this.capture(p);
      this.stats.replays++;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  /** Un tick: predice il comando, aggiorna gli altri e gli eventi; restituisce il comando da inviare. */
  tick(input: PlayerInput): Uint8Array {
    this.serverTick += 1;
    this.match.beginTick();
    // Prima gli altri: gli spari di questo comando colpiscono ciò che si vede ora, e il server
    // riavvolge esattamente a questo tick.
    this.updateRemotes();
    quantizeInput(input);
    this.seq++;
    const entry = this.predictions[this.seq % INPUT_HISTORY]!;
    entry.seq = this.seq;
    Object.assign(entry.input, input);
    entry.predicted = false;
    const c = this.local;
    if (c && c.alive) {
      this.apply(input);
      this.match.stepCombatant(c);
      this.capture(entry);
    }
    this.playEvents();
    this.sentAt[this.seq % INPUT_HISTORY] = this.now();
    this.writer.reset();
    writeInput(this.writer, this.seq, this.viewTick, input);
    return this.writer.finish();
  }

  private apply(input: Readonly<PlayerInput>): void {
    const target = this.local!.input;
    target.yaw = input.yaw;
    target.pitch = input.pitch;
    target.forward = input.forward;
    target.right = input.right;
    target.jump = input.jump;
    target.crouch = input.crouch;
    target.fire = input.fire;
    target.ads = input.ads;
    target.reload = input.reload;
    target.grenade = input.grenade;
    target.weaponSlot = input.weaponSlot;
  }

  private capture(entry: Predicted): void {
    const c = this.local!;
    copyPlayerState(entry.player, c.player);
    captureWeapon(entry.weapon, c.weapon);
    entry.predicted = true;
  }

  /** Gli altri, interpolati tra i due pacchetti attorno a renderTick. */
  private updateRemotes(): void {
    if (this.frameCount === 0) return;
    const render = this.renderTick;
    let before: Frame | null = null;
    let after: Frame | null = null;
    for (let i = 0; i < Math.min(this.frameCount, FRAME_HISTORY); i++) {
      const f = this.frames[i]!;
      if (f.tick <= render && (!before || f.tick > before.tick)) before = f;
      if (f.tick > render && (!after || f.tick < after.tick)) after = f;
    }
    const base = before ?? after!;
    const t = before && after ? (render - before.tick) / (after.tick - before.tick) : 0;
    // Senza due pacchetti attorno a renderTick si mostra il più vicino: è quello il tick visto.
    this.viewTick = before && after ? render : base.tick;
    const match = this.match;
    this.seen.clear();
    for (let i = 0; i < base.remoteCount; i++) {
      const a = base.remotes[i]!;
      let b: RemoteSnapshot | null = null;
      if (after && before) {
        for (let j = 0; j < after.remoteCount; j++) {
          if (after.remotes[j]!.id === a.id) {
            b = after.remotes[j]!;
            break;
          }
        }
      }
      if (this.local && a.id === this.local.id) continue;
      this.seen.add(a.id);
      let c = match.getCombatant(a.id);
      if (!c) {
        const entry = this.roster.get(a.id);
        c = match.addCombatant(entry?.name ?? '?', { driver: 'remote', id: a.id, classIndex: a.classIndex, team: a.team });
      }
      if (b && b.alive && a.alive) lerpAnimState(c.anim, a.anim, b.anim, t);
      else copyAnimState(c.anim, a.anim);
      const p = c.player;
      p.x = c.anim.x;
      p.y = c.anim.y;
      p.z = c.anim.z;
      p.yaw = c.anim.yaw;
      p.pitch = c.anim.pitch;
      p.vx = a.vx;
      p.vy = a.vy;
      p.vz = a.vz;
      p.crouched = a.crouched;
      p.grounded = a.grounded;
      p.sliding = a.sliding;
      c.alive = a.alive;
      c.health = a.health;
      c.maxHealth = a.maxHealth;
      c.kills = a.kills;
      c.deaths = a.deaths;
      c.team = a.team;
      c.classIndex = a.classIndex;
      c.protection = a.protected ? 1 : 0;
      if (c.anim.weapon >= 0) c.weapon.current = c.anim.weapon;
      if (c.alive) poseBody(c.pose, c.anim, match.grips);
    }
    for (let i = match.combatants.length - 1; i >= 0; i--) {
      const c = match.combatants[i]!;
      if (c !== this.local && !this.seen.has(c.id)) match.removeCombatant(c.id);
    }

    // Razzi e granate, interpolati come i giocatori.
    for (const pr of match.projectiles) pr.active = false;
    let slot = 0;
    for (let i = 0; i < base.projectileCount && slot < match.projectiles.length; i++) {
      const a = base.projectiles[i]!;
      let b: ProjectileSnapshot | null = null;
      if (after && before) {
        for (let j = 0; j < after.projectileCount; j++) {
          if (after.projectiles[j]!.serial === a.serial) {
            b = after.projectiles[j]!;
            break;
          }
        }
      }
      const def = a.weapon === KILLED_BY_GRENADE ? match.grenade.projectile : match.weapons[a.weapon]?.projectile;
      if (!def) continue;
      const pr = match.projectiles[slot++]!;
      pr.active = true;
      pr.serial = a.serial;
      pr.owner = a.owner;
      pr.weapon = a.weapon;
      pr.def = def;
      const k = b ? t : 0;
      pr.x = a.x + ((b?.x ?? a.x) - a.x) * k;
      pr.y = a.y + ((b?.y ?? a.y) - a.y) * k;
      pr.z = a.z + ((b?.z ?? a.z) - a.z) * k;
      pr.px = pr.x;
      pr.py = pr.y;
      pr.pz = pr.z;
      pr.vx = a.vx;
      pr.vy = a.vy;
      pr.vz = a.vz;
    }
  }

  private playEvents(): void {
    const events = this.match.events;
    for (const pending of this.immediate) readEvents(this.eventReader.reset(pending.bytes), events, this.immediateFilter);
    this.immediate.length = 0;
    const render = this.renderTick;
    let played = 0;
    while (played < this.delayed.length && this.delayed[played]!.tick <= render) {
      readEvents(this.eventReader.reset(this.delayed[played]!.bytes), events, this.delayedFilter);
      played++;
    }
    if (played > 0) this.delayed.splice(0, played);
  }
}
