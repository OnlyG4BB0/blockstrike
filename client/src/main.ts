import './style.css';
import { ContentError, parseMap } from '@blockstrike/shared';
import arena from '../../content/maps/arena-prova.json';
import { loadGameContent } from './content.ts';
import { Game } from './game/Game.ts';
import { byId } from './ui/dom.ts';

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

try {
  const content = loadGameContent();
  const map = parseMap(arena, 'content/maps/arena-prova.json');
  const game = new Game(byId('app'), map, content);
  game.start();
  if (import.meta.env.DEV) window.blockstrike = game;
} catch (error) {
  showFatalError(error);
}
