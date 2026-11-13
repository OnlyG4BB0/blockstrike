/**
 * Prova di rete con socket veri: avvia il server, collega due client (lo stesso codice del browser,
 * ClientCore con l'SDK di Colyseus), li fa muovere e sparare per qualche secondo e controlla che si
 * vedano, che la predizione regga e che il codice d'invito funzioni. Esce con 0 se va tutto bene.
 */
import { Client } from '@colyseus/sdk';
import {
  ClientCore,
  MSG_INPUT,
  MSG_ROSTER,
  MSG_SNAPSHOT,
  MSG_WELCOME,
  TICK_DT,
  createInput,
  type RosterEntry,
} from '@blockstrike/shared';
import { loadMaps, startServer } from './app.ts';
import { loadContentFromDisk } from './content.ts';

const PORT = 2599;
const SECONDS = 4;

interface Welcome {
  id: number;
  tick: number;
  name: string;
  classIndex: number;
  code: string;
  roster: RosterEntry[];
}

const server = await startServer(PORT);
const content = loadContentFromDisk();
const map = loadMaps().get('arena-prova')!;
const sdk = new Client(`ws://localhost:${PORT}`);

async function connect(name: string, join: () => Promise<Awaited<ReturnType<Client['create']>>>) {
  const room = await join();
  const core = new ClientCore(map, content);
  const welcome = await new Promise<Welcome>((resolve) => {
    room.onMessage(MSG_WELCOME, (message: Welcome) => resolve(message));
    room.onMessage(MSG_ROSTER, (roster: RosterEntry[]) => core.setRoster(roster));
    room.onMessage(MSG_SNAPSHOT, (bytes: Uint8Array) => core.receive(bytes));
  });
  core.welcome(welcome.id, welcome.tick, welcome.name, welcome.classIndex);
  core.setRoster(welcome.roster);
  return { name, room, core, welcome };
}

let failures = 0;
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'ok  ' : 'NO  '} ${message}`);
  if (!ok) failures++;
};

try {
  const a = await connect('Anna', () => sdk.create('privata', { mode: 'ffa', name: 'Anna' }));
  check(/^[A-Z2-9]{5}$/.test(a.welcome.code), `codice d'invito ${a.welcome.code}`);
  const b = await connect('Bruno', () => sdk.joinById(a.welcome.code, { name: 'Bruno' }));
  check(b.room.roomId === a.room.roomId, 'il secondo giocatore entra con il codice');

  // 60 tick al secondo per ogni client: Anna corre e salta, Bruno si sposta di lato.
  let tick = 0;
  await new Promise<void>((resolve) => {
    const started = performance.now();
    let done = 0;
    const timer = setInterval(() => {
      const target = Math.floor((performance.now() - started) / 1000 / TICK_DT);
      while (done < target) {
        done++;
        tick++;
        for (const player of [a, b]) {
          const input = createInput();
          if (player === a) {
            input.forward = 1;
            input.jump = tick % 45 < 2;
            input.yaw = tick / 90;
          } else {
            input.right = Math.floor(tick / 40) % 2 === 0 ? 1 : -1;
          }
          player.room.sendBytes(MSG_INPUT, player.core.tick(input));
        }
      }
      if (done >= SECONDS / TICK_DT) {
        clearInterval(timer);
        resolve();
      }
    }, 4);
  });

  for (const player of [a, b]) {
    const other = player === a ? b : a;
    const seen = player.core.match.getCombatant(other.welcome.id);
    check(seen !== undefined && seen.name === other.name, `${player.name} vede ${other.name}`);
    check(player.core.stats.snapshots > SECONDS * 25, `${player.name}: ${player.core.stats.snapshots} pacchetti di stato`);
    check(
      player.core.stats.mismatches <= 2,
      `${player.name}: ${player.core.stats.mismatches} correzioni della predizione (${player.core.stats.replays} comandi rigiocati)`,
    );
  }
  const bots = a.core.match.combatants.filter((c) => a.core.roster.get(c.id)?.bot).length;
  check(bots >= 1, `i bot riempiono la stanza (${bots})`);
  await a.room.leave();
  await b.room.leave();
} catch (error) {
  failures++;
  console.error(error);
}

await server.gracefullyShutdown(false);
console.log(failures === 0 ? 'Prova di rete superata.' : `Prova di rete: ${failures} problemi.`);
process.exitCode = failures === 0 ? 0 : 1;
