/**
 * Pubblica la pagina su GitHub Pages: node scripts/deploy-pages.mjs [wss://server]
 *
 * Compila il sito per un hosting statico (VITE_TARGET=pages): la pagina non è il server, quindi
 * l'indirizzo del server di gioco è quello passato qui (o in BLOCKSTRIKE_SERVER); senza, nel menu
 * compare il campo Server. Se c'è android/build/blockstrike.apk lo mette nel sito da scaricare.
 * Poi carica client/dist sul ramo gh-pages del remoto origin (sostituendolo: è solo la pagina).
 * L'autore del commit è l'indirizzo noreply di GitHub, non l'email personale.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = process.argv[2] ?? process.env.BLOCKSTRIKE_SERVER ?? '';
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm', ...options });
const read = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

if (server && !/^wss?:\/\//.test(server)) throw new Error(`Indirizzo del server non valido: ${server} (serve wss://…)`);
console.log(`== sito per GitHub Pages${server ? ` (server ${server})` : ' (server da scrivere nel menu)'}`);
run('npm', ['run', 'build', '--workspace', '@blockstrike/client'], {
  env: { ...process.env, VITE_TARGET: 'pages', VITE_SERVER_URL: server },
});
// Niente elaborazione Jekyll: i file vanno pubblicati così come sono.
writeFileSync(join(ROOT, 'client', 'dist', '.nojekyll'), '');

const source = read('git', ['rev-parse', '--short', 'HEAD']);
const user = JSON.parse(read('gh', ['api', 'user']));
const email = `${user.id}+${user.login}@users.noreply.github.com`;
// Il repository pubblico (non è l'origin di questa copia: la storia pubblicata ha l'autore noreply).
const remote = process.env.BLOCKSTRIKE_PAGES_REPO ?? `https://github.com/${user.login}/blockstrike.git`;

const work = mkdtempSync(join(tmpdir(), 'blockstrike-pages-'));
try {
  cpSync(join(ROOT, 'client', 'dist'), work, { recursive: true });
  const git = (...args) => run('git', args, { cwd: work });
  git('init', '-q', '-b', 'gh-pages');
  git('add', '-A');
  git('-c', `user.name=${user.login}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `Pagina da ${source}`);
  console.log('== pubblicazione sul ramo gh-pages');
  // Credenziali di GitHub CLI (gh auth login), solo per questo comando.
  git('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '-q', '--force', remote, 'gh-pages');
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Fatto: https://${user.login.toLowerCase()}.github.io/${remote.replace(/\.git$/, '').split('/').pop()}/`);
