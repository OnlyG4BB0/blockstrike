import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const contentDir = fileURLToPath(new URL('../content', import.meta.url));

/**
 * I contenuti stanno fuori dalla cartella del client: Vite li osserva solo se lo si chiede.
 * Così aggiungere o togliere un file in /content (una nuova arma, una skin) ricarica la pagina.
 */
function watchContent(): Plugin {
  return {
    name: 'blockstrike-content',
    configureServer(server) {
      server.watcher.add(contentDir);
      const reload = (file: string) => {
        if (file.startsWith(contentDir) && file.endsWith('.json')) server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

/**
 * App installabile: a ogni build scrive dist/sw.js dal modello in pwa/sw.template.js, con la
 * versione (impronta dei file) e l'elenco di tutto ciò che serve per giocare senza rete.
 */
function serviceWorker(): Plugin {
  const template = fileURLToPath(new URL('./pwa/sw.template.js', import.meta.url));
  const publicDir = fileURLToPath(new URL('./public', import.meta.url));
  return {
    name: 'blockstrike-service-worker',
    apply: 'build',
    // Dopo gli altri plugin: così l'elenco comprende anche le pagine HTML.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      const extra = (readdirSync(publicDir, { recursive: true }) as string[])
        .map((file) => file.split('\\').join('/'))
        .filter((file) => statSync(join(publicDir, file)).isFile());
      const hash = createHash('sha256');
      hash.update(readFileSync(template));
      for (const file of [...built].sort()) hash.update(file);
      for (const file of [...extra].sort()) hash.update(readFileSync(join(publicDir, file)));
      const files = ['./', ...built, ...extra];
      const source = readFileSync(template, 'utf8')
        .replace("'__VERSIONE__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__FILE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Build per l'app Android (scripts/build-android.mjs): il gioco va dentro l'APK, niente service worker. */
const android = process.env.VITE_TARGET === 'android';
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const outDir = fileURLToPath(new URL(android ? './dist-android' : './dist', import.meta.url));

/**
 * Sul sito l'APK (fatto da scripts/build-android.mjs) si scarica da download/blockstrike.apk. Si
 * copia alla fine, dopo il service worker: i visitatori del sito non lo salvano in automatico.
 */
function androidDownload(): Plugin {
  const apk = fileURLToPath(new URL('../android/build/blockstrike.apk', import.meta.url));
  const patches = fileURLToPath(new URL('../content/patches.json', import.meta.url));
  return {
    name: 'blockstrike-apk',
    apply: 'build',
    closeBundle() {
      if (android) return;
      const hasApk = existsSync(apk);
      if (hasApk) {
        mkdirSync(join(outDir, 'download'), { recursive: true });
        copyFileSync(apk, join(outDir, 'download', 'blockstrike.apk'));
      }
      // version.json: l'app Android lo legge per sapere se c'è un APK più nuovo (sempre fresco:
      // non è nell'elenco del service worker).
      const latest = (JSON.parse(readFileSync(patches, 'utf8')) as { patches: { version: string; title?: string; notes?: string[] }[] })
        .patches.find((p) => p.version === version);
      const info = { version, title: latest?.title ?? '', notes: latest?.notes ?? [], apk: hasApk ? 'download/blockstrike.apk' : null };
      writeFileSync(join(outDir, 'version.json'), `${JSON.stringify(info, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  // Percorsi relativi: il client compilato funziona in qualunque cartella di un sito statico.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [watchContent(), ...(android ? [] : [serviceWorker(), androidDownload()])],
  server: {
    port: 5173,
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // Due pagine: il gioco e l'editor di mappe.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
      },
    },
  },
});
