/**
 * Prova del codice condiviso in Node, senza browser: è la base del server autoritativo
 * della Fase 6. Carica ogni mappa, simula un giocatore per qualche secondo e stampa l'esito.
 */
import { readFileSync, readdirSync } from 'node:fs';
import {
  CollisionWorld,
  TICK_RATE,
  createInput,
  createPlayerState,
  horizontalSpeed,
  parseMap,
  simulateTick,
  spawnPlayer,
} from '@blockstrike/shared';

const mapsDir = new URL('../../content/maps/', import.meta.url);
let failures = 0;

for (const file of readdirSync(mapsDir).filter((name) => name.endsWith('.json'))) {
  try {
    const map = parseMap(JSON.parse(readFileSync(new URL(file, mapsDir), 'utf8')), file);
    const world = CollisionWorld.fromBlocks(map.blocks);
    const player = createPlayerState();
    spawnPlayer(player, map.spawns[0]!);
    const input = createInput();
    input.yaw = player.yaw;
    input.forward = 1;
    input.jump = true;

    const seconds = 5;
    const started = performance.now();
    for (let i = 0; i < TICK_RATE * seconds; i++) simulateTick(player, input, world);
    const elapsed = performance.now() - started;

    console.log(
      `${file}: ${map.blocks.length} blocchi, ${seconds} s simulati in ${elapsed.toFixed(1)} ms, ` +
        `posizione (${player.x.toFixed(2)}, ${player.y.toFixed(2)}, ${player.z.toFixed(2)}), ` +
        `velocità ${horizontalSpeed(player).toFixed(2)} m/s`,
    );
  } catch (error) {
    failures++;
    console.error(error instanceof Error ? error.message : error);
  }
}

process.exitCode = failures > 0 ? 1 : 0;
