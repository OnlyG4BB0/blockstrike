# BLOCKSTRIKE

Sparatutto in prima persona da browser, grafica low-poly a blocchi, movimento veloce.
Nome provvisorio.

**Stato: Fase 3 completata — armi definite da file JSON.**

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
| `npm run smoke` | Controlla i contenuti e simula una partita tra bot in Node, senza browser |

## Comandi di gioco

| Tasto | Azione |
|---|---|
| W A S D | Muoversi |
| Spazio | Saltare; tenendolo premuto si salta di nuovo appena si tocca terra |
| Shift o C | Accovacciarsi; correndo si scivola; in aria si raccolgono le gambe |
| Clic sinistro | Sparare (con il coltello: colpire) |
| Clic destro | Mirare (zoom, meno dispersione, più lenti) |
| R | Ricaricare (si ricarica da soli a caricatore vuoto) |
| 1 – 9, rotella | Cambiare arma; Q torna all'arma precedente |
| G | Lanciare una granata (2 per vita) |
| Tab | Punteggi |
| K | Tornare a un punto di partenza |
| Esc | Menu, impostazioni e skin |

## Armi

| Tasto | Arma | Note |
|---|---|---|
| 1 | Fucile d'assalto | automatico, mirino a punto rosso; 2 colpi alla testa o 5 al busto |
| 2 | Mitraglietta | 15 colpi al secondo, precisa anche in movimento, poca gittata |
| 3 | Mitragliatrice leggera | 100 colpi, lenta da spostare e da ricaricare |
| 4 | Fucile a pompa | 8 pallini, letale da vicino |
| 5 | Cecchino | preciso solo mirando; uccide con un colpo al busto |
| 6 | Pistola | semiautomatica |
| 7 | Revolver | un colpo alla testa uccide, rinculo forte |
| 8 | Lanciarazzi | danno ad area; spinge anche chi spara (salto con il razzo) |
| 9 | Coltello | due colpi di fronte, uno alle spalle; con il coltello si corre più veloci |

Granate: rimbalzano ed esplodono dopo 2,2 secondi. Dopo la rinascita si è protetti per 1,5 secondi,
o finché non si spara.

## Contenuti: armi, modelli, skin e suoni

Tutto quello che riguarda le armi sta in file JSON dentro `content/`:

```
content/weapons/        un file per arma: valori di gioco, modello, suoni
content/weapon-models/  modelli a blocchi (anche quelli di razzo e granata)
content/skins/          colori alternativi delle parti di un modello
content/sounds/         suoni, descritti come livelli di rumore filtrato e toni
content/equipment/      la granata
content/maps/           le mappe
```

**Aggiungere un'arma** non richiede codice: basta un nuovo file in `content/weapons/`.
In sviluppo la pagina si ricarica da sola e l'arma compare nell'elenco, nella posizione data da `order`.
Esempio minimo (i campi non indicati prendono un valore predefinito):

```json
{
  "id": "carabina",
  "name": "Carabina",
  "order": 1.5,
  "type": "hitscan",
  "damage": 34,
  "headMultiplier": 2,
  "fireRate": 300,
  "magazine": 10,
  "reloadTime": 1.6,
  "model": "assault_rifle",
  "sounds": { "fire": "revolver" }
}
```

- `type`: `hitscan` (colpo istantaneo), `projectile` (con `projectile`, come il lanciarazzi) o
  `melee` (con `melee`, come il coltello: niente munizioni).
- `model` e `sounds` indicano file esistenti in `content/weapon-models` e `content/sounds`.
- `bot` (`{ "preferredRange": 15 }`) permette ai bot di usare l'arma.
- `gore` (smembramento, esplosione in pezzi) è già nei file e verrà usato nella Fase 5.
- Nei modelli, le parti con `role` hanno un'animazione propria: `magazine` (esce in ricarica),
  `slide` (indietro a ogni colpo), `pump`, `bolt`, `cylinder`.
- Una skin cambia il colore delle parti per nome: `{ "weapon": "pistol", "colors": { "slide": "#d4af37" } }`.
  Si sceglie nel menu, sezione «Skin delle armi».

**Errori**: un file non valido ferma il gioco all'avvio con l'elenco completo dei problemi,
ciascuno con file e campo, per esempio `content/weapons/smg.json: "fireRate" deve essere un numero`.
Vengono controllati anche i riferimenti tra file (modelli, suoni, parti delle skin) e gli id duplicati.
`npm test` e `npm run smoke` fanno gli stessi controlli.

## Struttura del codice

```
client/    rendering (Three.js), input, arma in prima persona, effetti, suoni, HUD, menu
shared/    simulazione: movimento, collisioni, armi, colpi, proiettili, danni, bot, contenuti
server/    per ora la prova in Node; il server di gioco arriva nella Fase 6
content/   dati di gioco (vedi sopra)
```

- **Simulazione condivisa**, a passo fisso di 60 Hz e deterministica: stessi input e stesso seme,
  stesso risultato. La partita (`shared/src/match.ts`) gestisce combattenti, armi, proiettili,
  danni, morti e rinascite, e produce eventi che il client trasforma in effetti, suoni e segnali.
- **Contenuti** (`shared/src/content.ts`): lettura e controllo dei file JSON. Nel browser i file
  sono inclusi da Vite (`client/src/content.ts`), in Node si leggono dal disco.
- **Hitbox** (`shared/src/hitboxes.ts`): testa, busto, braccia, gambe, ruotate con lo sguardo.
- **Bot** (`shared/src/bots.ts`): navigano sui punti della mappa, reagiscono con ritardo, mirano
  con un errore che si riduce, sparano a raffiche.

## Note sull'ambiente

- **Node**: consigliato Node 24 LTS. Con Node 23 tutto funziona, ma npm avvisa che Vitest 5
  non lo supporta ufficialmente.
- **`.npmrc`** contiene `legacy-peer-deps=true`: npm 10.9 va in errore risolvendo le dipendenze
  di Vitest nei workspace. Con npm 11 si può togliere.
