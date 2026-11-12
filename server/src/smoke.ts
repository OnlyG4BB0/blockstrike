/**
 * Prova del codice condiviso in Node, senza browser: è la base del server autoritativo
 * della Fase 6. Per ogni mappa simula un giocatore e poi una partita tra bot.
 */
import { readFileSync, readdirSync } from 'node:fs';
import {
  CollisionWorld,
  Match,
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

    // Movimento.
    const world = CollisionWorld.fromBlocks(map.blocks);
    const player = createPlayerState();
    spawnPlayer(player, map.spawns[0]!);
    const input = createInput();
    input.yaw = player.yaw;
    input.forward = 1;
    input.jump = true;
    let started = performance.now();
    for (let i = 0; i < TICK_RATE * 5; i++) simulateTick(player, input, world);
    console.log(
      `${file}: ${map.blocks.length} blocchi; 5 s di movimento in ${(performance.now() - started).toFixed(1)} ms, ` +
        `velocità finale ${horizontalSpeed(player).toFixed(2)} m/s`,
    );

    // Partita tra bot.
    const match = new Match(map, { seed: 1 });
    match.setBotCount(6);
    const seconds = 60;
    let shots = 0;
    let hits = 0;
    let kills = 0;
    started = performance.now();
    for (let i = 0; i < TICK_RATE * seconds; i++) {
      match.tick();
      shots += match.events.shots.count;
      hits += match.events.hits.count;
      kills += match.events.kills.count;
    }
    const elapsed = performance.now() - started;
    console.log(
      `${file}: partita di ${seconds} s con 6 bot simulata in ${elapsed.toFixed(0)} ms ` +
        `(${((elapsed / (TICK_RATE * seconds)) * 1000).toFixed(0)} µs per tick): ` +
        `${shots} spari, ${hits} colpi a segno, ${kills} uccisioni`,
    );
    for (const c of [...match.combatants].sort((a, b) => b.kills - a.kills)) {
      console.log(`  ${c.name.padEnd(10)} uccisioni ${c.kills}  morti ${c.deaths}`);
    }
  } catch (error) {
    failures++;
    console.error(error instanceof Error ? error.message : error);
  }
}

process.exitCode = failures > 0 ? 1 : 0;
