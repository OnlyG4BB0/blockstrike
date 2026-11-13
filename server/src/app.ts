/** Avvio del server di gioco, riusato dal programma principale e dalla prova di rete. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { Server } from '@colyseus/core';
import express from 'express';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CollisionWorld, navGraphFor, parseMap, type MapData, type NavGraph } from '@blockstrike/shared';
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

export interface StartOptions {
  /** Cartella del client compilato (client/dist) da servire sulla stessa porta; facoltativa. */
  clientDir?: string;
}

/** Carica contenuti e mappe (lancia ContentError se non sono validi) e avvia il server. */
export async function startServer(port: number, options: StartOptions = {}): Promise<Server> {
  const clientDir = options.clientDir;
  if (clientDir && !existsSync(clientDir)) throw new Error(`CLIENT_DIR: la cartella ${clientDir} non esiste`);
  const content = loadContentFromDisk();
  const maps = loadMaps();
  // I grafi dei bot si calcolano qui una volta: creare una stanza non blocca le altre.
  const navs = new Map<string, NavGraph>();
  for (const [id, map] of maps) {
    navs.set(
      id,
      navGraphFor(
        CollisionWorld.fromBlocks(map.blocks),
        map.waypoints,
        map.spawns.map((s) => s.pos),
      ),
    );
  }
  setResources({ content, maps, navs, defaultMap: maps.has('arena-prova') ? 'arena-prova' : [...maps.keys()][0]! });
  const server = new Server({
    transport: new WebSocketTransport(),
    gracefullyShutdown: false,
    // Con CLIENT_DIR il server serve anche il gioco: un solo indirizzo per pagina e partite.
    express: clientDir ? (app) => void app.use(express.static(clientDir)) : undefined,
  });
  server.define('partita', GameRoom).filterBy(['mode']);
  server.define('privata', GameRoom);
  await server.listen(port);
  return server;
}
