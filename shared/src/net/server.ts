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
    this.mode = options.mode ?? 'ffa';
    this.fillTo = options.fillTo ?? MATCH_RULES.fillTo;
    this.lagCompensation = options.lagCompensation ?? true;
    this.match = new Match(map, content, { seed: options.seed ?? 1 });
    this.match.fireHooks = this;
    this.resetInfo();
    this.fillBots();
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
      this.endTimer -= TICK_DT;
      if (this.endTimer <= 0) this.restart();
      return;
    }
    info.timeLeft = Math.max(0, info.timeLeft - TICK_DT);
    let best: Combatant | null = null;
    for (const c of this.match.combatants) if (!best || c.kills > best.kills) best = c;
    const top = best?.kills ?? 0;
    info.scoreA = top;
    if (top >= info.scoreLimit || info.timeLeft <= 0) {
      info.phase = 1;
      info.winner = best ? best.id : -1;
      this.endTimer = MATCH_RULES.endScreen;
    }
  }

  /** Nuova partita: punteggi azzerati, tutti rinascono. */
  private restart(): void {
    this.resetInfo();
    for (const c of this.match.combatants) {
      c.kills = 0;
      c.deaths = 0;
      c.streak = 0;
      c.multiKills = 0;
      this.match.forceRespawn(c);
    }
  }
}
