import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

export default defineConfig({
  // Percorsi relativi: il client compilato funziona in qualunque cartella di un sito statico.
  base: './',
  plugins: [watchContent(), serviceWorker()],
  server: {
    port: 5173,
  },
  build: {
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
