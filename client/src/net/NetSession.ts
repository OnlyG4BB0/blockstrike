/**
 * Collegamento al server di gioco (Colyseus). La logica sta in ClientCore (shared): qui solo il
 * trasporto, la scelta della stanza e il ritardo simulato per le prove (`?ping=150`: metà
 * all'andata, metà al ritorno).
 */
import { SEPARATE_SERVER } from '../target.ts';
import { chooseServerUrl } from './address.ts';
import { Client, type Room } from '@colyseus/sdk';
import {
  ClientCore,
  MSG_CHAT,
  MSG_CLASS,
  MSG_INPUT,
  MSG_ROSTER,
  MSG_SNAPSHOT,
  MSG_WELCOME,
  type GameContent,
  type GameMode,
  type MapData,
  type RosterEntry,
} from '@blockstrike/shared';

export type OnlineKind = 'quick' | 'create' | 'code';

export interface OnlineRequest {
  kind: OnlineKind;
  mode: GameMode;
  code: string;
  name: string;
  classId: string;
  skin: string;
  /** Mappa per una stanza nuova (l'ingresso rapido in una stanza esistente usa la sua). */
  map: string;
  /** Ritardo simulato andata e ritorno (ms), 0 = nessuno. */
  ping: number;
}

export interface ChatMessage {
  id: number;
  name: string;
  text: string;
}

interface Welcome {
  id: number;
  tick: number;
  name: string;
  classIndex: number;
  mode: GameMode;
  map: string;
  code: string;
  roster: RosterEntry[];
}

/**
 * Indirizzo del server di gioco:
 * - VITE_SERVER_URL, se impostato quando si compila il client (client ospitato altrove);
 * - in sviluppo, lo stesso host della pagina sulla porta 2567;
 * - nel client compilato, la stessa origine della pagina (il server serve anche il client).
 */
/**
 * Indirizzo del server: quello scelto nelle impostazioni, poi VITE_SERVER_URL, poi la pagina stessa
 * (sito servito dal server di gioco). Nell'app Android la pagina non è un server: null se manca.
 */
export function serverUrl(userAddress: string): string | null {
  return chooseServerUrl({
    user: userAddress,
    configured: (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '',
    page: SEPARATE_SERVER ? null : location,
    dev: import.meta.env.DEV,
  });
}

export class NetSession {
  readonly core: ClientCore;
  readonly code: string;
  readonly mode: GameMode;
  readonly mapId: string;
  onChat: (message: ChatMessage) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private readonly room: Room;
  private readonly delay: number;

  private constructor(room: Room, core: ClientCore, welcome: Welcome, delay: number) {
    this.room = room;
    this.core = core;
    this.code = welcome.code;
    this.mode = welcome.mode;
    this.mapId = welcome.map;
    this.delay = delay;
  }

  /**
   * Entra in una stanza e aspetta il benvenuto. `mapFor` dà la mappa indicata dal server.
   */
  static async connect(
    url: string,
    request: OnlineRequest,
    content: GameContent,
    mapFor: (id: string) => MapData | undefined,
  ): Promise<NetSession> {
    const client = new Client(url);
    const options = { name: request.name, classId: request.classId, skin: request.skin, mode: request.mode, map: request.map };
    let room: Room;
    if (request.kind === 'code') room = await client.joinById(request.code.trim().toUpperCase(), options);
    else if (request.kind === 'create') room = await client.create('privata', options);
    else room = await client.joinOrCreate('partita', options);

    const delay = Math.max(0, request.ping) / 2;
    const later = (action: () => void) => (delay > 0 ? window.setTimeout(action, delay) : action());
    let core: ClientCore | null = null;
    let session: NetSession | null = null;
    const early: Uint8Array[] = [];
    let roster: RosterEntry[] = [];

    const welcome = await new Promise<Welcome>((resolve, reject) => {
      room.onMessage(MSG_WELCOME, (message: Welcome) => resolve(message));
      room.onMessage(MSG_SNAPSHOT, (bytes: Uint8Array) =>
        later(() => {
          if (core) core.receive(bytes);
          else early.push(bytes);
        }),
      );
      room.onMessage(MSG_ROSTER, (entries: RosterEntry[]) =>
        later(() => {
          roster = entries;
          core?.setRoster(entries);
        }),
      );
      room.onMessage(MSG_CHAT, (message: ChatMessage) => later(() => session?.onChat(message)));
      room.onLeave((code: number) => {
        if (session) session.onClose(code === 1000 ? 'Sei uscito dalla stanza.' : `Collegamento chiuso (${code}).`);
        else reject(new Error(`Collegamento chiuso (${code})`));
      });
    });

    const map = mapFor(welcome.map);
    if (!map) {
      await room.leave();
      throw new Error(`La mappa "${welcome.map}" del server non c'è in questo client.`);
    }
    core = new ClientCore(map, content);
    core.welcome(welcome.id, welcome.tick, welcome.name, welcome.classIndex);
    core.setRoster(roster.length > 0 ? roster : welcome.roster);
    for (const bytes of early) core.receive(bytes);
    session = new NetSession(room, core, welcome, delay);
    return session;
  }

  sendInput(bytes: Uint8Array): void {
    if (this.delay > 0) window.setTimeout(() => this.room.sendBytes(MSG_INPUT, bytes), this.delay);
    else this.room.sendBytes(MSG_INPUT, bytes);
  }

  sendChat(text: string): void {
    this.room.send(MSG_CHAT, text);
  }

  sendClass(classId: string): void {
    this.room.send(MSG_CLASS, classId);
  }

  leave(): void {
    void this.room.leave();
  }
}
