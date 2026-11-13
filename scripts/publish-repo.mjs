/**
 * Aggiorna il repository pubblico su GitHub: node scripts/publish-repo.mjs
 *
 * Copia il ramo attuale in una cartella temporanea, mette come autore di ogni commit l'indirizzo
 * noreply di GitHub (l'email personale non va in pubblico) e lo carica come main. La riscrittura dà
 * sempre gli stessi commit per la stessa storia, quindi ogni volta si aggiungono solo i nuovi.
 * La copia locale non cambia.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
const user = JSON.parse(read('gh', ['api', 'user']));
const email = `${user.id}+${user.login}@users.noreply.github.com`;
const remote = process.env.BLOCKSTRIKE_PAGES_REPO ?? `https://github.com/${user.login}/blockstrike.git`;
const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

const work = mkdtempSync(join(tmpdir(), 'blockstrike-repo-'));
try {
  const git = (...args) => execFileSync('git', args, { cwd: work, stdio: 'inherit', env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' } });
  execFileSync('git', ['clone', '-q', '--single-branch', '--branch', branch, ROOT, work], { stdio: 'inherit' });
  git('filter-branch', '-f', '--env-filter', `export GIT_AUTHOR_EMAIL="${email}"; export GIT_COMMITTER_EMAIL="${email}"`, '--', '--all');
  const authors = read('git', ['log', '--format=%ae%n%ce'], work).split('\n');
  if (authors.some((a) => a !== email)) throw new Error('È rimasta un\'email diversa da noreply: non pubblico niente.');
  git('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '-q', remote, 'HEAD:main');
  console.log(`Pubblicato ${branch} → ${remote} (main), autore ${email}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
