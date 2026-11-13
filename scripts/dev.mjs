/**
 * Sviluppo: avvia insieme il server di gioco (porta 2567) e il client Vite (porta 5173).
 * Ctrl+C li ferma entrambi; se uno dei due si chiude con un errore, si ferma anche l'altro.
 */
import { spawn } from 'node:child_process';

const tasks = [
  // La porta del server non deve seguire PORT (quella la usano gli strumenti per il client).
  { name: 'server', args: ['run', 'dev', '--workspace', '@blockstrike/server'], env: { GAME_PORT: process.env.GAME_PORT ?? '2567' } },
  { name: 'client', args: ['run', 'dev', '--workspace', '@blockstrike/client'] },
];

const children = tasks.map((task) => {
  const child = spawn('npm', task.args, { stdio: 'inherit', shell: true, env: { ...process.env, ...task.env } });
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`[dev] ${task.name} si è chiuso (codice ${code ?? '?'}): fermo anche il resto.`);
    stop(code ?? 1);
  });
  return child;
});

let stopping = false;

function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
