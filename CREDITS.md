# Riconoscimenti

## Suoni e musica

Tutti i suoni e la musica sono **generati dal gioco**: nessun file audio esterno.

- **Effetti** (spari, ricariche, passi, impatti, esplosioni, gore, annunci): descritti nei file
  `content/sounds/*.json` come livelli di rumore filtrato e di toni. All'avvio vengono sintetizzati
  con la Web Audio API (`OfflineAudioContext`), convertiti in WAV in memoria e riprodotti con
  Howler.js, con la posizione nello spazio (`client/src/audio/AudioSystem.ts`).
- **Musica del menu**: un giro di 8 battute in la minore generato in `client/src/audio/music.ts`
  (basso, arpeggio a onda quadra, accordi e batteria di rumore filtrato).

Sono opera originale di questo progetto e si possono usare con la stessa licenza del codice.

## Grafica

Modelli, mappe, personaggi, skin e texture sono costruiti in codice o descritti nei file JSON di
`content/`: blocchi colorati, nessuna immagine esterna. Le texture dei blocchi e delle macchie di
sangue sono disegnate al volo su un canvas.

## Caratteri

Il gioco usa i caratteri di sistema (Segoe UI, system-ui, Roboto, Arial): nessun carattere incluso.

## Librerie

| Libreria | Uso | Licenza |
|---|---|---|
| [three.js](https://threejs.org) | rendering 3D | MIT |
| [Howler.js](https://howlerjs.com) | audio posizionale | MIT |
| [Colyseus](https://colyseus.io) (`@colyseus/core`, `@colyseus/ws-transport`, `@colyseus/sdk`) | server di gioco e client di rete | MIT |
| [Express](https://expressjs.com) | richiesta da Colyseus per il trasporto WebSocket | MIT |
| [Vite](https://vite.dev) | build e server di sviluppo | MIT |
| [Vitest](https://vitest.dev) | test | MIT |
| [TypeScript](https://www.typescriptlang.org) | linguaggio | Apache-2.0 |
