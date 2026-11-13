/**
 * APK di BLOCKSTRIKE per Android: node scripts/build-android.mjs (serve Docker acceso).
 *
 * 1. Compila il gioco per l'app (client/dist-android): il gioco sta dentro l'APK.
 * 2. Prepara l'immagine con l'Android SDK (android/Dockerfile; la prima volta scarica circa 1 GB).
 * 3. La prima volta crea la chiave di firma in android/keystore/ (fuori da git: TENERNE UNA COPIA,
 *    senza non si possono più pubblicare aggiornamenti installabili sopra quelli vecchi).
 * 4. Costruisce e firma android/build/blockstrike.apk. La build del sito (npm run build) lo copia in
 *    download/blockstrike.apk.
 *
 * Variabile facoltativa: VITE_SERVER_URL = server predefinito dell'app (es. wss://gioco.example.com);
 * il giocatore può sempre cambiarlo dal menu.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = join(ROOT, 'android', 'keystore');
const ENV_FILE = join(KEYS, 'firma.env');
const IMAGE = 'blockstrike-android-sdk';
const run = (cmd, args, env = process.env) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env, shell: process.platform === 'win32' && cmd === 'npm' });
const work = `${ROOT.replace(/\\/g, '/')}:/work`;

console.log('== gioco per l\'app');
// L'app chiede al sito se c'è un APK più nuovo (version.json).
const site = process.env.VITE_UPDATE_URL ?? 'https://onlyg4bb0.github.io/blockstrike/';
run('npm', ['run', 'build', '--workspace', '@blockstrike/client'], { ...process.env, VITE_TARGET: 'android', VITE_UPDATE_URL: site });

console.log('== immagine con l\'Android SDK');
// Il Dockerfile arriva da stdin, senza contesto: la cartella con la chiave non va mai a Docker.
execFileSync('docker', ['build', '-t', IMAGE, '-'], {
  cwd: ROOT,
  input: readFileSync(join(ROOT, 'android', 'Dockerfile')),
  stdio: ['pipe', 'inherit', 'inherit'],
});

if (!existsSync(join(KEYS, 'blockstrike.jks'))) {
  console.log('== nuova chiave di firma (android/keystore, fuori da git: tienine una copia)');
  mkdirSync(KEYS, { recursive: true });
  if (!existsSync(ENV_FILE)) writeFileSync(ENV_FILE, `KS_PASS=${randomBytes(18).toString('base64url')}\n`, { mode: 0o600 });
  run('docker', [
    'run', '--rm', '-v', work, '--env-file', ENV_FILE, IMAGE,
    'keytool', '-genkeypair', '-keystore', '/work/android/keystore/blockstrike.jks', '-alias', 'blockstrike',
    '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000', '-dname', 'CN=BLOCKSTRIKE',
    '-storepass:env', 'KS_PASS', '-keypass:env', 'KS_PASS',
  ]);
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
// Cresce a ogni build (minuti dal 2024): Android installa un aggiornamento solo se il numero sale.
const code = Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 60000);
console.log(`== APK ${version} (${code})`);
run('docker', [
  'run', '--rm', '-v', work, '--env-file', ENV_FILE,
  '-e', `VERSION_CODE=${code}`, '-e', `VERSION_NAME=${version}`,
  IMAGE, 'bash', '/work/android/build.sh',
]);
console.log('APK pronto: android/build/blockstrike.apk (npm run build lo mette nel sito in download/).');
