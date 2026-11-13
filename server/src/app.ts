/** Avvio del server di gioco, riusato dal programma principale e dalla prova di rete. */
import { readFileSync, readdirSync } from 'node:fs';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { parseMap, type MapData } from '@blockstrike/shared';
import { loadContentFromDisk } from './content.ts';
import { GameRoom, setResources } from './GameRoom.ts';

const mapsDir = new URL('../../content/maps/', import.meta.url);

export function loadMaps(): Map<string, MapData> {
  const maps = new Map<string, MapData>();
  for (const file of readdirSync(mapsDir).filter((name) => name.endsWith('.json')).sort()) {
    const id = file.replace(/\.json$/, '');
    maps.set(id, parseMap(JSON.parse(readFileSync(new URL(file, mapsDir), 'utf8')), `content/maps/${file}`));
  }
  return maps;
}

/** Carica contenuti e mappe (lancia ContentError se non sono validi) e avvia il server. */
export async function startServer(port: number): Promise<Server> {
  const content = loadContentFromDisk();
  const maps = loadMaps();
  setResources({ content, maps, defaultMap: maps.has('arena-prova') ? 'arena-prova' : [...maps.keys()][0]! });
  const server = new Server({ transport: new WebSocketTransport(), gracefullyShutdown: false });
  server.define('partita', GameRoom).filterBy(['mode']);
  server.define('privata', GameRoom);
  await server.listen(port);
  return server;
}
