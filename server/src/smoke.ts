/**
 * Prova del codice condiviso in Node, senza browser: è la base del server autoritativo
 * della Fase 6. Per ogni mappa simula un giocatore e poi una partita tra bot.
 */
import { readFileSync, readdirSync } from 'node:fs';
import {
  CollisionWorld,
  ContentError,
  Match,
  TICK_RATE,
  createInput,
  createPlayerState,
  horizontalSpeed,
  parseMap,
  simulateTick,
  spawnPlayer,
} from '@blockstrike/shared';
import { loadContentFromDisk } from './content.ts';

const mapsDir = new URL('../../content/maps/', import.meta.url);
let failures = 0;

let content;
try {
  content = loadContentFromDisk();
  console.log(
    `Contenuti: ${content.weapons.length} armi (${content.weapons.map((w) => w.id).join(', ')}), ` +
      `${content.classes.length} classi (${content.classes.map((c) => c.id).join(", ")}), ` +
        `${content.models.size} modelli, ${content.skins.length} skin di armi, ${content.characterSkins.length} di personaggi, ${content.sounds.size} suoni`,
  );
} catch (error) {
  console.error(error instanceof ContentError ? error.message : error);
  process.exit(1);
}

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

    // Partita tra bot: due per classe.
    const bots = Math.max(6, content.classes.length * 2);
    const match = new Match(map, content, { seed: 1 });
    match.setBotCount(bots);
    // Per ogni bot: strada fatta e tempo più lungo passato fermo da vivo (bloccato?).
    const travelled = new Map<number, number>();
    const still = new Map<number, number>();
    const longestStill = new Map<number, number>();
    const seconds = 60;
    let shots = 0;
    let hits = 0;
    let kills = 0;
    started = performance.now();
    for (let i = 0; i < TICK_RATE * seconds; i++) {
      const before = match.combatants.map((c) => [c.player.x, c.player.z, c.alive] as const);
      match.tick();
      match.combatants.forEach((c, index) => {
        const [x, z, wasAlive] = before[index]!;
        if (!c.alive || !wasAlive) {
          still.set(c.id, 0);
          return;
        }
        const step = Math.hypot(c.player.x - x, c.player.z - z);
        travelled.set(c.id, (travelled.get(c.id) ?? 0) + step);
        const stopped = step < 0.002 ? (still.get(c.id) ?? 0) + 1 / TICK_RATE : 0;
        still.set(c.id, stopped);
        longestStill.set(c.id, Math.max(longestStill.get(c.id) ?? 0, stopped));
      });
      shots += match.events.shots.count;
      hits += match.events.hits.count;
      kills += match.events.kills.count;
    }
    const elapsed = performance.now() - started;
    console.log(
      `${file}: partita di ${seconds} s con ${bots} bot simulata in ${elapsed.toFixed(0)} ms ` +
        `(${((elapsed / (TICK_RATE * seconds)) * 1000).toFixed(0)} µs per tick): ` +
        `${shots} spari, ${hits} colpi a segno, ${kills} uccisioni`,
    );
    for (const c of [...match.combatants].sort((a, b) => b.kills - a.kills)) {
      const className = content.classes[c.classIndex]?.name ?? "-";
      console.log(
        `  ${c.name.padEnd(10)} ${className.padEnd(12)} uccisioni ${String(c.kills).padStart(2)}  morti ${String(c.deaths).padStart(2)}  ` +
          `strada ${(travelled.get(c.id) ?? 0).toFixed(0).padStart(4)} m  fermo al massimo ${(longestStill.get(c.id) ?? 0).toFixed(1)} s`,
      );
    }
  } catch (error) {
    failures++;
    console.error(error instanceof Error ? error.message : error);
  }
}

process.exitCode = failures > 0 ? 1 : 0;
