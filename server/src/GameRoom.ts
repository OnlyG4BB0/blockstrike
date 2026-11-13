/**
 * Stanza Colyseus: solo un adattatore attorno a ServerCore (shared/src/net/server.ts), che contiene
 * tutta la logica e si prova senza socket. Qui: messaggi, ritmo dei tick, codici d'invito.
 */
import { Room, matchMaker, type Client } from '@colyseus/core';
import {
  GAME_MODES,
  MSG_CHAT,
  MSG_CLASS,
  MSG_INPUT,
  MSG_ROSTER,
  MSG_SNAPSHOT,
  MSG_WELCOME,
  NET,
  ServerCore,
  TICK_DT,
  type GameContent,
  type GameMode,
  type MapData,
  type NavGraph,
} from '@blockstrike/shared';

/** Contenuti e mappe caricati una volta all'avvio del server (vedi index.ts). */
export interface ServerResources {
  content: GameContent;
  maps: ReadonlyMap<string, MapData>;
  /** Grafi di navigazione dei bot, calcolati all'avvio per ogni mappa. */
  navs: ReadonlyMap<string, NavGraph>;
  defaultMap: string;
}

let resources: ServerResources | null = null;

export function setResources(value: ServerResources): void {
  resources = value;
}

/** Codici d'invito: lettere e cifre che non si confondono (niente O/0, I/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

export interface CreateOptions {
  mode?: string;
  map?: string;
  /** Stanza privata: si entra solo con il codice. */
  private?: boolean;
}

export interface JoinOptions {
  name?: string;
  classId?: string;
  skin?: string;
}

export class GameRoom extends Room {
  override maxClients = NET.maxPlayers;
  private core!: ServerCore;
  private content!: GameContent;
  private rosterSent = -1;
  private mapId = '';
  private last = 0;
  private pending = 0;

  override async onCreate(options: CreateOptions = {}): Promise<void> {
    if (!resources) throw new Error('Risorse del server non caricate');
    this.content = resources.content;
    const mode: GameMode = GAME_MODES.includes(options.mode as GameMode) ? (options.mode as GameMode) : 'ffa';
    this.mapId = resources.maps.has(options.map ?? '') ? options.map! : resources.defaultMap;
    const map = resources.maps.get(this.mapId)!;
    // Codice d'invito: è anche l'id della stanza (si entra con joinById).
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomCode();
      if (!(await matchMaker.getRoomById(code))) {
        this.roomId = code;
        break;
      }
    }
    this.core = new ServerCore(map, this.content, {
      mode,
      seed: (Math.random() * 0xffffffff) >>> 0,
      nav: resources.navs.get(this.mapId),
    });
    await this.setMetadata({ mode, map: map.name });

    this.onMessageBytes(MSG_INPUT, (client: Client, bytes: Uint8Array) => this.core.receiveInput(client.sessionId, bytes));
    this.onMessage(MSG_CLASS, (client: Client, classId: unknown) => {
      this.core.setClass(client.sessionId, this.classIndexOf(classId));
    });
    this.onMessage(MSG_CHAT, (client: Client, text: unknown) => {
      const message = this.core.chat(client.sessionId, text);
      if (message) this.broadcast(MSG_CHAT, message);
    });
    // Tick a passo fisso: il timer di Node non è preciso, si recupera il tempo passato.
    this.last = performance.now();
    this.setSimulationInterval(() => this.pump(), 1000 / 120);
    // Ogni 10 s, se è cambiato qualcosa: compensazione del lag e comandi scartati (per chi gestisce il server).
    let reported = '';
    this.clock.setInterval(() => {
      const st = this.core.stats;
      const line = `riavvolgimenti ${st.rewinds} (ultimo ${st.lastRewindTicks.toFixed(1)} tick, massimo ${st.maxRewindTicks.toFixed(1)}, tagliati ${st.clampedRewinds}), comandi scartati ${st.droppedInputs}`;
      if (line !== reported && this.clients.length > 0) console.log(`[${this.roomId}] ${line}`);
      reported = line;
    }, 10_000);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const c = this.core.join(client.sessionId, {
      name: typeof options.name === 'string' ? options.name : '',
      classIndex: this.classIndexOf(options.classId),
      skin: this.skinOf(options.skin),
    });
    client.send(MSG_WELCOME, {
      id: c.id,
      tick: this.core.tick,
      name: c.name,
      classIndex: c.classIndex,
      mode: this.core.mode,
      map: this.mapId,
      code: this.roomId,
      roster: this.core.roster(),
    });
  }

  override onLeave(client: Client): void {
    this.core.leave(client.sessionId);
  }

  /** Indice della classe, o -1 se l'id non esiste (il nucleo del server lo sostituisce o lo ignora). */
  private classIndexOf(id: unknown): number {
    return typeof id === 'string' ? this.content.classes.findIndex((c) => c.id === id) : -1;
  }

  /** Skin del personaggio se esiste, altrimenti nessuna: gli altri client ne mostrano una a caso. */
  private skinOf(id: unknown): string {
    return typeof id === 'string' && this.content.characterSkins.some((s) => s.id === id) ? id : '';
  }

  private pump(): void {
    const now = performance.now();
    this.pending = Math.min(this.pending + (now - this.last) / 1000, TICK_DT * 8);
    this.last = now;
    while (this.pending >= TICK_DT) {
      this.pending -= TICK_DT;
      this.core.update();
      if (this.core.tick % NET.snapshotInterval === 0) this.sendSnapshots();
    }
  }

  private sendSnapshots(): void {
    if (this.core.rosterVersion !== this.rosterSent) {
      this.rosterSent = this.core.rosterVersion;
      this.broadcast(MSG_ROSTER, this.core.roster());
    }
    for (const client of this.clients) {
      const bytes = this.core.snapshot(client.sessionId);
      if (bytes) client.sendBytes(MSG_SNAPSHOT, bytes);
    }
  }
}
