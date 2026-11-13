/**
 * Server di gioco: Colyseus su WebSocket. Porta da GAME_PORT, altrimenti PORT (predefinita 2567).
 * Con CLIENT_DIR (per esempio client/dist) serve anche il client compilato sulla stessa porta.
 * Stanze "partita" (pubbliche, ingresso rapido per modalità) e "privata" (solo con il codice).
 */
import { ContentError } from '@blockstrike/shared';
import { startServer } from './app.ts';

const port = Number(process.env.GAME_PORT ?? process.env.PORT ?? 2567);
try {
  const clientDir = process.env.CLIENT_DIR || undefined;
  const server = await startServer(port, { clientDir });
  console.log(`Server BLOCKSTRIKE in ascolto su ws://localhost:${port}`);
  if (clientDir) console.log(`Gioco su http://localhost:${port} (client da ${clientDir})`);
  const stop = () => {
    void server.gracefullyShutdown(false).then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(error instanceof ContentError ? error.message : error);
  process.exitCode = 1;
}
