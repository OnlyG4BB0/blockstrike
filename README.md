# BLOCKSTRIKE

Sparatutto in prima persona da browser, grafica low-poly a blocchi, movimento veloce.
Nome provvisorio.

**Stato: Fase 1 completata — prototipo di movimento.**

## Avvio

```bash
npm install
npm run dev
```

Poi apri http://localhost:5173 e premi **Gioca**.

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Avvia il client in sviluppo |
| `npm test` | Esegue i test (Vitest) |
| `npm run typecheck` | Controlla i tipi di tutti i pacchetti |
| `npm run build` | Build di produzione del client in `client/dist` |
| `npm run smoke` | Esegue la simulazione condivisa in Node, senza browser |

## Comandi di gioco

| Tasto | Azione |
|---|---|
| W A S D | Muoversi |
| Spazio | Saltare; tenendolo premuto si salta di nuovo appena si tocca terra |
| Shift o C | Accovacciarsi; correndo si scivola; in aria si raccolgono le gambe |
| K | Tornare al punto di partenza |
| Esc | Menu e impostazioni |

Per andare veloce: salta appena tocchi terra e, in aria, tieni A o D girando il mouse
dalla stessa parte. Atterra accovacciato per scivolare; in discesa la scivolata accelera.
La cima della rampa arancione lancia in alto, e saltando in cima si arriva alla piattaforma.

## Struttura

```
client/    rendering (Three.js), input, HUD, menu
shared/    simulazione del movimento, collisioni, formato mappe, costanti (usato da client e server)
server/    per ora solo la prova in Node; il server di gioco arriva nella Fase 6
content/   dati di gioco: mappe JSON
```

- La simulazione è in `shared/src/player.ts`, a passo fisso di 60 Hz e deterministica: stessi input,
  stesso risultato. Il client disegna a qualsiasi frequenza interpolando tra due tick.
- Tutti i valori del movimento stanno in `shared/src/constants.ts`.
- Le mappe sono file JSON in `content/maps/`, con blocchi (`box`) e rampe (`ramp`).
  Una mappa non valida dà un errore che indica file e campo.

## Note sull'ambiente

- **Node**: consigliato Node 24 LTS. Con Node 23 tutto funziona, ma npm avvisa che Vitest 5
  non lo supporta ufficialmente.
- **`.npmrc`** contiene `legacy-peer-deps=true`: npm 10.9 va in errore risolvendo le dipendenze
  di Vitest nei workspace. Con npm 11 si può togliere.
