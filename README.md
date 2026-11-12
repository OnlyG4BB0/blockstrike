# BLOCKSTRIKE

Sparatutto in prima persona da browser, grafica low-poly a blocchi, movimento veloce.
Nome provvisorio.

**Stato: Fase 2 completata — sparatoria contro i bot.**

## Avvio

```bash
npm install
npm run dev
```

Poi apri http://localhost:5173 e premi **Gioca**. Con il menu aperto la partita è in pausa.

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Avvia il client in sviluppo |
| `npm test` | Esegue i test (Vitest) |
| `npm run typecheck` | Controlla i tipi di tutti i pacchetti |
| `npm run build` | Build di produzione del client in `client/dist` |
| `npm run smoke` | Simula movimento e una partita tra bot in Node, senza browser |

## Comandi di gioco

| Tasto | Azione |
|---|---|
| W A S D | Muoversi |
| Spazio | Saltare; tenendolo premuto si salta di nuovo appena si tocca terra |
| Shift o C | Accovacciarsi; correndo si scivola; in aria si raccolgono le gambe |
| Clic sinistro | Sparare |
| Clic destro | Mirare (zoom, meno dispersione, più lenti) |
| R | Ricaricare (si ricarica da soli a caricatore vuoto) |
| 1 – 5, rotella | Cambiare arma; Q torna all'arma precedente |
| G | Lanciare una granata (2 per vita) |
| Tab | Punteggi |
| K | Tornare a un punto di partenza |
| Esc | Menu e impostazioni |

## Armi

| Tasto | Arma | Note |
|---|---|---|
| 1 | Fucile d'assalto | automatico; 2 colpi alla testa o 5 al busto |
| 2 | Cecchino | preciso solo mirando; uccide con un colpo al busto |
| 3 | Fucile a pompa | 8 pallini, letale da vicino, poco da lontano |
| 4 | Pistola | semiautomatica |
| 5 | Lanciarazzi | danno ad area; spinge anche chi spara (salto con il razzo) |

Granate: rimbalzano ed esplodono dopo 2,2 secondi. Un muro tra esplosione e bersaglio blocca il danno.
Dopo la rinascita si è protetti per 1,5 secondi, o finché non si spara.

Nel menu: numero di bot (0–7) e comportamento (combattono, girano senza sparare, fermi),
volume, numeri di danno.

## Struttura

```
client/    rendering (Three.js), input, arma in prima persona, effetti, suoni, HUD, menu
shared/    simulazione: movimento, collisioni, armi, colpi, proiettili, danni, bot, formato mappe
server/    per ora la prova in Node; il server di gioco arriva nella Fase 6
content/   dati di gioco: mappe JSON
```

- **Simulazione condivisa**, a passo fisso di 60 Hz e deterministica: stessi input e stesso seme,
  stesso risultato. La partita (`shared/src/match.ts`) gestisce combattenti, armi, proiettili,
  danni, morti e rinascite, e produce eventi (spari, colpi, uccisioni, esplosioni) che il client
  trasforma in effetti, suoni e segnali. Nella Fase 6 girerà sul server.
- **Hitbox** (`shared/src/hitboxes.ts`): testa, busto, braccia, gambe, ruotate con lo sguardo;
  il modello dei bot usa le stesse misure.
- **Armi** in `shared/src/weapons.ts`, con la forma dei futuri file JSON della Fase 3.
- **Bot** (`shared/src/bots.ts`): navigano su un grafo di punti definiti nella mappa (`waypoints`),
  reagiscono con ritardo, mirano con un errore che si riduce, sparano a raffiche.
- **Suoni** generati al volo con la Web Audio API: nessun file audio.
- Le mappe sono file JSON in `content/maps/`, con blocchi (`box`), rampe (`ramp`), punti di
  rinascita e punti di navigazione. Una mappa non valida dà un errore che indica file e campo.

## Note sull'ambiente

- **Node**: consigliato Node 24 LTS. Con Node 23 tutto funziona, ma npm avvisa che Vitest 5
  non lo supporta ufficialmente.
- **`.npmrc`** contiene `legacy-peer-deps=true`: npm 10.9 va in errore risolvendo le dipendenze
  di Vitest nei workspace. Con npm 11 si può togliere.
