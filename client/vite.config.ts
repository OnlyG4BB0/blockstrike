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

export default defineConfig({
  plugins: [watchContent()],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
