import './style.css';
import { parseMap } from '@blockstrike/shared';
import arena from '../../content/maps/arena-prova.json';
import { Game } from './game/Game.ts';
import { byId } from './ui/dom.ts';

declare global {
  interface Window {
    /** Accesso al gioco dalla console, solo in sviluppo. */
    blockstrike?: Game;
  }
}

function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:#0d1017;color:#f4f1ea;font:600 16px system-ui';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:640px;border-left:4px solid #ff4d4d;padding:12px 16px;background:#1a1f2b';
  box.textContent = `Il gioco non può partire: ${message}`;
  panel.append(box);
  document.body.append(panel);
  console.error(error);
}

try {
  const map = parseMap(arena, 'content/maps/arena-prova.json');
  const game = new Game(byId('app'), map);
  game.start();
  if (import.meta.env.DEV) window.blockstrike = game;
} catch (error) {
  showFatalError(error);
}
