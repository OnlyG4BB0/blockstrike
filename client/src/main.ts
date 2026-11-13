import './style.css';
import { ContentError, GAME_MODES, parseMap, type GameMode, type MapData } from '@blockstrike/shared';
import { loadGameContent } from './content.ts';
import { Game } from './game/Game.ts';
import { NetSession, serverUrl, type OnlineKind } from './net/NetSession.ts';
import { loadSettings } from './settings.ts';
import { byId } from './ui/dom.ts';

/** Tutte le mappe di content/maps (id = nome del file). */
const mapFiles = import.meta.glob('../../content/maps/*.json', { eager: true, import: 'default' });

function mapFor(id: string): MapData | undefined {
  const entry = Object.entries(mapFiles).find(([path]) => path.endsWith(`/${id}.json`));
  return entry ? parseMap(entry[1], `content/maps/${id}.json`) : undefined;
}

declare global {
  interface Window {
    /** Accesso al gioco dalla console, solo in sviluppo. */
    blockstrike?: Game;
  }
}

/** Schermata di errore all'avvio: per i contenuti non validi elenca ogni problema con file e campo. */
function showFatalError(error: unknown): void {
  const problems = error instanceof ContentError ? error.problems : [error instanceof Error ? error.message : String(error)];
  const panel = document.createElement('div');
  panel.id = 'fatal-error';
  panel.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:#0d1017;color:#f4f1ea;font:600 15px system-ui;overflow:auto';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:820px;border-left:4px solid #ff4d4d;padding:14px 18px;background:#1a1f2b;line-height:1.5';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:800;margin-bottom:8px';
  title.textContent =
    error instanceof ContentError
      ? `Il gioco non può partire: ${problems.length === 1 ? 'un file non è valido' : `${problems.length} problemi nei file`}`
      : 'Il gioco non può partire';
  const list = document.createElement('ul');
  list.style.cssText = 'margin:0;padding-left:20px;font:13px/1.6 ui-monospace,Consolas,monospace';
  for (const problem of problems) {
    const item = document.createElement('li');
    item.textContent = problem;
    list.append(item);
  }
  box.append(title, list);
  panel.append(box);
  document.body.append(panel);
  console.error(error);
}

/** Passa online o torna all'allenamento ricaricando la pagina con i parametri giusti. */
function navigate(params: Record<string, string>): void {
  const query = new URLSearchParams(params);
  const ping = new URLSearchParams(location.search).get('ping');
  if (ping) query.set('ping', ping);
  location.search = query.toString();
}

async function main(): Promise<void> {
  const content = loadGameContent();
  const params = new URLSearchParams(location.search);
  const code = (params.get('stanza') ?? '').toUpperCase();
  const online = params.get('online');
  let session: NetSession | null = null;
  let status = '';
  if (code || online) {
    const settings = loadSettings();
    const kind: OnlineKind = code ? 'code' : online === 'crea' ? 'create' : 'quick';
    const modeParam = params.get('modalita') ?? settings.onlineMode;
    const mode: GameMode = GAME_MODES.includes(modeParam as GameMode) ? (modeParam as GameMode) : 'ffa';
    byId('online-status').textContent = 'Collegamento al server...';
    try {
      session = await NetSession.connect(
        serverUrl(),
        {
          kind,
          mode,
          code,
          name: settings.playerName || 'Giocatore',
          classId: settings.classId,
          skin: settings.characterSkin,
          ping: Number(params.get('ping') ?? 0) || 0,
        },
        content,
        mapFor,
      );
    } catch (error) {
      status = `Online non disponibile: ${error instanceof Error ? error.message : String(error)}. Sei in allenamento.`;
    }
  }
  const map = session ? mapFor(session.mapId)! : mapFor('arena-prova')!;
  const game = new Game(byId('app'), map, content, session);
  byId('online-status').textContent = status;
  game.onOnline = (action, mode, roomCode) => {
    if (action === 'code') navigate({ stanza: roomCode });
    else navigate({ online: action === 'create' ? 'crea' : 'rapida', modalita: mode });
  };
  game.onLeaveRoom = () => {
    session?.leave();
    navigate({});
  };
  game.start();
  if (import.meta.env.DEV) window.blockstrike = game;
}

main().catch(showFatalError);
