/**
 * Logica del server autoritativo, senza trasporto: byte in ingresso, byte in uscita, un tick alla
 * volta. La stanza Colyseus (server/src/GameRoom.ts) è solo un adattatore; i test la usano così com'è.
 *
 * - I giocatori umani avanzano di un passo per ogni comando ricevuto (al massimo
 *   NET.inputsPerTick per tick): lo stato dopo il comando N è identico su client e server.
 *   Senza comandi in coda il giocatore non avanza. I comandi accettati non possono superare i
 *   tick passati più un piccolo margine: è il controllo sulla velocità (niente "speed hack").
 * - Cadenza di fuoco, munizioni e linea di tiro sono quelle della simulazione: il client manda solo
 *   comandi, mai posizioni o danni.
 * - Compensazione del lag: quando un giocatore spara, gli altri vengono riportati alla posa che
 *   aveva sullo schermo (storia delle pose per tick), entro il ritardo d'interpolazione più
 *   NET.maxRewind tick di latenza.
 */
import { MATCH_RULES, NET, TICK_DT } from '../constants.ts';
import type { MapData } from '../map.ts';
import type { NavGraph } from '../navigation.ts';
import { Match, type Combatant, type FireHooks } from '../match.ts';
import { createInput } from '../player.ts';
import { copyAnimState, createAnimState, lerpAnimState, poseBody, type AnimState } from '../pose.ts';
import type { CombatContent } from '../weapons.ts';
import { ByteReader, ByteWriter } from './codec.ts';
import { createMatchInfo, readInput, writeEvents, writeSnapshot, type InputFrame, type MatchInfo, type TickEvents } from './protocol.ts';

export type GameMode = 'ffa' | 'tdm' | 'ctf';
export const GAME_MODES: readonly GameMode[] = ['ffa', 'tdm', 'ctf'];

export interface ServerOptions {
  mode?: GameMode;
  seed?: number;
  /** Combattenti minimi: i bot riempiono i posti vuoti (0 = nessun bot). */
  fillTo?: number;
  /** Disattivabile solo per i test (per mostrare che senza si sbaglia). */
  lagCompensation?: boolean;
  /** Grafo di navigazione dei bot già calcolato per la mappa. */
  nav?: NavGraph;
}

export interface PlayerProfile {
  name: string;
  classIndex: number;
  skin: string;
}

export interface RosterEntry {
  id: number;
  name: string;
  skin: string;
  bot: boolean;
  team: number;
}

interface Slot {
  session: string;
  c: Combatant;
  skin: string;
  queue: InputFrame[];
  head: number;
  size: number;
  lastQueuedSeq: number;
  accepted: number;
  joinTick: number;
  ackSeq: number;
  viewTick: number;
  lastEventTick: number;
  lastChat: number;
}

interface History {
  ticks: Int32Array;
  alive: Uint8Array;
  anims: AnimState[];
}

/** Bandiera di una squadra (cattura la bandiera). */
interface FlagState {
  team: number;
  homeX: number;
  homeY: number;
  homeZ: number;
  /** 0 = alla base, 1 = portata, 2 = a terra. */
  state: number;
  carrier: number;
  x: number;
  y: number;
  z: number;
  returnTimer: number;
}

/** Altezza a cui si porta la bandiera sopra i piedi. */
const FLAG_CARRY_HEIGHT = 2.2;

/** Pulisce un testo arrivato dalla rete: niente caratteri di controllo, lunghezza massima. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

const EVENT_LOG = 64;

export class ServerCore implements FireHooks {
  readonly match: Match;
  readonly mode: GameMode;
  readonly info: MatchInfo = createMatchInfo();
  readonly stats = { rewinds: 0, lastRewindTicks: 0, maxRewindTicks: 0, clampedRewinds: 0, droppedInputs: 0 };
  lagCompensation: boolean;
  /** Cambia quando cambiano i giocatori (nomi, squadre): l'adattatore rimanda l'elenco. */
  rosterVersion = 0;

  private readonly slots = new Map<string, Slot>();
  private readonly history = new Map<number, History>();
  private readonly eventLog: TickEvents[] = [];
  private readonly writer = new ByteWriter(4096);
  private readonly eventWriter = new ByteWriter(1024);
  private readonly reader = new ByteReader();
  private readonly lerped = createAnimState();
  private readonly rewound: Combatant[] = [];
  private readonly fillTo: number;
  private shooter: Slot | null = null;
  private endTimer = 0;

  constructor(map: MapData, content: CombatContent, options: ServerOptions = {}) {
    // Cattura la bandiera solo sulle mappe con le basi; altrimenti si gioca a squadre.
    const flags = map.flags ?? [];
    const requested = options.mode ?? 'ffa';
    this.mode = requested === 'ctf' && flags.length !== 2 ? 'tdm' : requested;
    this.fillTo = options.fillTo ?? MATCH_RULES.fillTo;
    this.lagCompensation = options.lagCompensation ?? true;
    this.match = new Match(map, content, { seed: options.seed ?? 1, nav: options.nav });
    this.match.fireHooks = this;
    if (this.mode === 'ctf') {
      for (const flag of flags) {
        const [x, y, z] = flag.pos;
        this.flags.push({ team: flag.team, homeX: x, homeY: y, homeZ: z, state: 0, carrier: -1, x, y, z, returnTimer: 0 });
      }
    }
    this.resetInfo();
    this.fillBots();
  }

  private readonly flags: FlagState[] = [];
  /** Punti delle squadre (indice = squadra). */
  private readonly teamScores = [0, 0, 0];

  /** Modalità a squadre: chi non ha squadra va in quella con meno giocatori; i bot riequilibrano. */
  private assignTeams(): void {
    const combatants = this.match.combatants;
    if (this.mode === 'ffa') {
      for (const c of combatants) c.team = 0;
      return;
    }
    const count = (team: number) => combatants.filter((c) => c.team === team).length;
    let changed = false;
    for (const c of combatants) {
      if (c.team === 1 || c.team === 2) continue;
      c.team = count(1) <= count(2) ? 1 : 2;
      changed = true;
    }
    for (let guard = 0; guard < combatants.length; guard++) {
      const big = count(1) - count(2) >= 2 ? 1 : count(2) - count(1) >= 2 ? 2 : 0;
      if (big === 0) break;
      const bot = combatants.find((c) => c.bot && c.team === big);
      if (!bot) break;
      bot.team = big === 1 ? 2 : 1;
      changed = true;
    }
    if (changed) this.rosterVersion++;
  }

  get tick(): number {
    return this.match.tickCount;
  }

  get playerCount(): number {
    return this.slots.size;
  }

  // -------------------------------------------------------------------------------------------
  // Giocatori
  // -------------------------------------------------------------------------------------------

  join(session: string, profile: PlayerProfile): Combatant {
    const name = cleanText(profile.name, NET.maxName) || 'Giocatore';
    const c = this.match.addCombatant(name, { driver: 'input', classIndex: profile.classIndex });
    const queue: InputFrame[] = [];
    for (let i = 0; i < NET.maxQueuedInputs; i++) queue.push({ seq: 0, viewTick: 0, input: createInput() });
    this.slots.set(session, {
      session,
      c,
      skin: cleanText(profile.skin, 40),
      queue,
      head: 0,
      size: 0,
      lastQueuedSeq: 0,
      accepted: 0,
      joinTick: this.tick,
      ackSeq: 0,
      viewTick: 0,
      lastEventTick: this.tick,
      lastChat: -Infinity,
    });
    this.fillBots();
    this.assignTeams();
    this.rosterVersion++;
    return c;
  }

  leave(session: string): void {
    const slot = this.slots.get(session);
    if (!slot) return;
    this.match.removeCombatant(slot.c.id);
    this.history.delete(slot.c.id);
    this.slots.delete(session);
    this.fillBots();
    this.assignTeams();
    this.rosterVersion++;
  }

  combatantOf(session: string): Combatant | undefined {
    return this.slots.get(session)?.c;
  }

  setClass(session: string, classIndex: unknown): void {
    const slot = this.slots.get(session);
    if (!slot || typeof classIndex !== 'number') return;
    this.match.setClass(slot.c, classIndex);
  }

  /** Messaggio di chat ripulito, o null se vuoto o troppo ravvicinato. */
  chat(session: string, text: unknown): { id: number; name: string; text: string } | null {
    const slot = this.slots.get(session);
    if (!slot) return null;
    const clean = cleanText(text, NET.maxChat);
    if (!clean || this.match.time - slot.lastChat < NET.chatInterval) return null;
    slot.lastChat = this.match.time;
    return { id: slot.c.id, name: slot.c.name, text: clean };
  }

  roster(): RosterEntry[] {
    const skins = new Map<number, string>();
    for (const slot of this.slots.values()) skins.set(slot.c.id, slot.skin);
    return this.match.combatants.map((c) => ({
      id: c.id,
      name: c.name,
      skin: skins.get(c.id) ?? '',
      bot: c.bot !== null,
      team: c.team,
    }));
  }

  /** Bot per arrivare a `fillTo` combattenti, senza superare i posti della stanza. */
  private fillBots(): void {
    if (this.fillTo <= 0) {
      this.match.setBotCount(0);
      return;
    }
    const wanted = Math.max(0, Math.min(NET.maxPlayers, this.fillTo) - this.slots.size);
    const before = this.match.combatants.length;
    this.match.setBotCount(wanted);
    if (this.match.combatants.length !== before) this.rosterVersion++;
    this.assignTeams();
  }

  // -------------------------------------------------------------------------------------------
  // Comandi
  // -------------------------------------------------------------------------------------------

  /** Comandi arrivati da un giocatore: controllati, messi in coda o scartati. */
  receiveInput(session: string, bytes: Uint8Array): void {
    const slot = this.slots.get(session);
    if (!slot) return;
    const reader = this.reader.reset(bytes);
    try {
      while (reader.remaining > 0) {
        const allowed = this.tick - slot.joinTick + NET.inputBurst;
        const full = slot.size >= slot.queue.length;
        const index = (slot.head + slot.size) % slot.queue.length;
        // Si legge comunque, per consumare i byte; il comando entra solo se è nuovo e consentito.
        const frame = full ? this.spare : slot.queue[index]!;
        readInput(reader, frame);
        if (frame.seq <= slot.lastQueuedSeq || !Number.isFinite(frame.viewTick)) continue;
        if (full || slot.accepted >= allowed) {
          this.stats.droppedInputs++;
          continue;
        }
        slot.lastQueuedSeq = frame.seq;
        slot.accepted++;
        slot.size++;
      }
    } catch {
      // Pacchetto malformato: si ignora il resto.
    }
  }

  private readonly spare: InputFrame = { seq: 0, viewTick: 0, input: createInput() };

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  update(): void {
    const match = this.match;
    match.beginTick(TICK_DT);
    const playing = this.info.phase === 0;
    for (const slot of this.slots.values()) {
      const c = slot.c;
      for (let n = 0; n < NET.inputsPerTick && slot.size > 0; n++) {
        const frame = slot.queue[slot.head]!;
        slot.head = (slot.head + 1) % slot.queue.length;
        slot.size--;
        slot.ackSeq = frame.seq;
        // Da morti (o a partita finita) il comando si conferma e si scarta.
        if (!c.alive || !playing) continue;
        const input = c.input;
        const from = frame.input;
        input.yaw = from.yaw;
        input.pitch = from.pitch;
        input.forward = from.forward;
        input.right = from.right;
        input.jump = from.jump;
        input.crouch = from.crouch;
        input.fire = from.fire;
        input.ads = from.ads;
        input.reload = from.reload;
        input.grenade = from.grenade;
        input.weaponSlot = from.weaponSlot;
        slot.viewTick = frame.viewTick;
        this.shooter = slot;
        match.stepCombatant(c, TICK_DT);
        this.shooter = null;
      }
    }
    if (playing) {
      match.stepScheduled(TICK_DT);
      match.endTick(TICK_DT);
    }
    this.updateRules();
    this.record();
    this.logEvents();
  }

  /** Stato per un giocatore (da inviare ogni NET.snapshotInterval tick). */
  snapshot(session: string): Uint8Array | null {
    const slot = this.slots.get(session);
    if (!slot) return null;
    const events = this.eventLog.filter((e) => e.tick > slot.lastEventTick);
    slot.lastEventTick = this.tick;
    this.writer.reset();
    writeSnapshot(this.writer, this.tick, slot.ackSeq, slot.c, this.match.combatants, this.match.projectiles, this.info, events);
    return this.writer.finish();
  }

  /** Ultimo comando elaborato di un giocatore. */
  ackOf(session: string): number {
    return this.slots.get(session)?.ackSeq ?? 0;
  }

  // -------------------------------------------------------------------------------------------
  // Compensazione del lag
  // -------------------------------------------------------------------------------------------

  beforeFire(shooter: Combatant): void {
    const slot = this.shooter;
    if (!this.lagCompensation || !slot || slot.c !== shooter) return;
    // Gli altri sono fermi alla fine del tick precedente (o a dopo il loro passo in questo tick).
    const latest = this.tick - 1;
    const oldest = latest - (NET.interpolationDelay + NET.maxRewind);
    let target = slot.viewTick;
    if (target < oldest) {
      target = oldest;
      this.stats.clampedRewinds++;
    }
    if (target >= latest) return;
    const rewind = latest - target;
    this.stats.rewinds++;
    this.stats.lastRewindTicks = rewind;
    this.stats.maxRewindTicks = Math.max(this.stats.maxRewindTicks, rewind);
    const from = Math.floor(target);
    const t = target - from;
    for (const other of this.match.combatants) {
      if (other === shooter || !other.alive) continue;
      const h = this.history.get(other.id);
      if (!h) continue;
      const a = from % NET.historyTicks;
      const b = (from + 1) % NET.historyTicks;
      if (h.ticks[a] !== from || !h.alive[a]) continue;
      if (h.ticks[b] === from + 1 && h.alive[b]) lerpAnimState(this.lerped, h.anims[a]!, h.anims[b]!, t);
      else copyAnimState(this.lerped, h.anims[a]!);
      poseBody(other.pose, this.lerped, this.match.grips);
      this.rewound.push(other);
    }
  }

  afterFire(): void {
    for (const other of this.rewound) poseBody(other.pose, other.anim, this.match.grips);
    this.rewound.length = 0;
  }

  /** Posa di ogni combattente alla fine del tick: è ciò che i client disegnano, con questo numero. */
  private record(): void {
    const tick = this.tick;
    const index = tick % NET.historyTicks;
    for (const c of this.match.combatants) {
      let h = this.history.get(c.id);
      if (!h) {
        h = {
          ticks: new Int32Array(NET.historyTicks).fill(-1),
          alive: new Uint8Array(NET.historyTicks),
          anims: Array.from({ length: NET.historyTicks }, createAnimState),
        };
        this.history.set(c.id, h);
      }
      h.ticks[index] = tick;
      h.alive[index] = c.alive ? 1 : 0;
      copyAnimState(h.anims[index]!, c.anim);
    }
  }

  private logEvents(): void {
    const e = this.match.events;
    if (e.shots.count + e.hits.count + e.kills.count + e.explosions.count + e.actions.count === 0) return;
    this.eventWriter.reset();
    writeEvents(this.eventWriter, e);
    this.eventLog.push({ tick: this.tick, bytes: this.eventWriter.finish() });
    if (this.eventLog.length > EVENT_LOG) this.eventLog.shift();
  }

  // -------------------------------------------------------------------------------------------
  // Regole della modalità
  // -------------------------------------------------------------------------------------------

  private resetInfo(): void {
    const rules = MATCH_RULES[this.mode];
    this.info.mode = GAME_MODES.indexOf(this.mode);
    this.info.phase = 0;
    this.info.timeLeft = rules.timeLimit;
    this.info.scoreLimit = rules.scoreLimit;
    this.info.scoreA = 0;
    this.info.scoreB = 0;
    this.info.winner = -1;
  }

  private updateRules(): void {
    const info = this.info;
    if (info.phase === 1) {
      // Durante la schermata finale il tempo che resta è quello della pausa.
      this.endTimer -= TICK_DT;
      info.timeLeft = Math.max(0, this.endTimer);
      if (this.endTimer <= 0) this.restart();
      return;
    }
    info.timeLeft = Math.max(0, info.timeLeft - TICK_DT);
    if (this.mode === 'ffa') {
      let best: Combatant | null = null;
      for (const c of this.match.combatants) if (!best || c.kills > best.kills) best = c;
      const top = best?.kills ?? 0;
      info.scoreA = top;
      if (top >= info.scoreLimit || info.timeLeft <= 0) this.finish(best ? best.id : -1);
      return;
    }
    if (this.mode === 'tdm') {
      // Un punto alla squadra per ogni nemico ucciso.
      const kills = this.match.events.kills;
      for (let i = 0; i < kills.count; i++) {
        const k = kills.get(i);
        const killer = this.match.getCombatant(k.killer);
        const victim = this.match.getCombatant(k.victim);
        if (killer && victim && killer.team > 0 && killer.team !== victim.team) this.teamScores[killer.team]!++;
      }
    } else {
      this.updateFlags();
    }
    info.scoreA = this.teamScores[1]!;
    info.scoreB = this.teamScores[2]!;
    if (info.scoreA >= info.scoreLimit || info.scoreB >= info.scoreLimit || info.timeLeft <= 0) {
      this.finish(info.scoreA > info.scoreB ? 1 : info.scoreB > info.scoreA ? 2 : -1);
    }
  }

  private finish(winner: number): void {
    this.info.phase = 1;
    this.info.winner = winner;
    this.endTimer = MATCH_RULES.endScreen;
  }

  /** Cattura la bandiera: prendere, perdere, riportare e catturare. */
  private updateFlags(): void {
    const match = this.match;
    const reach = MATCH_RULES.flagReach;
    for (const f of this.flags) {
      if (f.state === 1) {
        const carrier = match.getCombatant(f.carrier);
        if (!carrier || !carrier.alive) {
          f.state = 2;
          f.returnTimer = MATCH_RULES.flagReturnTime;
          match.addAction(f.carrier, 'flagDropped', f.x, f.y, f.z);
          f.carrier = -1;
          // Cade a terra dove stava il portatore.
          f.y = Math.max(f.homeY, f.y - FLAG_CARRY_HEIGHT);
        } else {
          f.x = carrier.player.x;
          f.y = carrier.player.y + FLAG_CARRY_HEIGHT;
          f.z = carrier.player.z;
        }
      } else if (f.state === 2) {
        f.returnTimer -= TICK_DT;
        if (f.returnTimer <= 0) this.flagHome(f, -1);
      }
    }
    for (const c of match.combatants) {
      if (!c.alive || c.team === 0) continue;
      const p = c.player;
      for (const f of this.flags) {
        if (f.state === 1) continue;
        const near = Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z) < reach + 1;
        if (!near) continue;
        if (f.team !== c.team) {
          f.state = 1;
          f.carrier = c.id;
          match.addAction(c.id, 'flagTaken', f.x, f.y, f.z);
        } else if (f.state === 2) {
          this.flagHome(f, c.id);
        }
      }
      // Cattura: la bandiera nemica portata alla propria base, con la propria bandiera a casa.
      const carried = this.flags.find((f) => f.state === 1 && f.carrier === c.id);
      const own = this.flags.find((f) => f.team === c.team);
      if (carried && own && own.state === 0 && Math.hypot(p.x - own.homeX, p.y - own.homeY, p.z - own.homeZ) < reach + 1) {
        this.teamScores[c.team]!++;
        match.addAction(c.id, 'flagCaptured', own.homeX, own.homeY, own.homeZ);
        carried.state = 0;
        carried.carrier = -1;
        carried.x = carried.homeX;
        carried.y = carried.homeY;
        carried.z = carried.homeZ;
      }
    }
    const flags = this.info.flags;
    flags.length = this.flags.length;
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i]!;
      const out = (flags[i] ??= { state: 0, carrier: -1, x: 0, y: 0, z: 0 });
      out.state = f.state;
      out.carrier = f.carrier;
      out.x = f.x;
      out.y = f.y;
      out.z = f.z;
    }
  }

  private flagHome(f: FlagState, by: number): void {
    f.state = 0;
    f.carrier = -1;
    f.x = f.homeX;
    f.y = f.homeY;
    f.z = f.homeZ;
    this.match.addAction(by, 'flagReturned', f.x, f.y, f.z);
  }

  /** Nuova partita: punteggi azzerati, tutti rinascono. */
  private restart(): void {
    this.resetInfo();
    this.teamScores.fill(0);
    for (const f of this.flags) {
      f.state = 0;
      f.carrier = -1;
      f.x = f.homeX;
      f.y = f.homeY;
      f.z = f.homeZ;
    }
    for (const c of this.match.combatants) {
      c.kills = 0;
      c.deaths = 0;
      c.streak = 0;
      c.multiKills = 0;
      this.match.forceRespawn(c);
    }
  }
}
