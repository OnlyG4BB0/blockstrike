# BLOCKSTRIKE

Sparatutto in prima persona da browser, grafica low-poly a blocchi, movimento veloce.
Nome provvisorio.

**Stato: Fase 4 completata — personaggi animati, classi e skin.**

## Avvio

```bash
npm install
npm run dev
```

Poi apri http://localhost:5173, scegli classe e aspetto e premi **Gioca**. Con il menu aperto la partita è in pausa.

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
| 1 – 3, rotella | Armi della classe; Q torna all'arma precedente |
| G | Lanciare una granata (2 per vita) |
| Tab | Punteggi |
| K | Tornare a un punto di partenza |
| Esc | Menu: classe, aspetto, impostazioni e skin delle armi |

## Classi

Ogni classe ha vita, velocità, altezza del salto e armi propri (tasti 1, 2, 3). Si sceglie nel menu,
con un'anteprima 3D del personaggio che ruota e mostra le animazioni. In allenamento la nuova classe
vale appena si torna a giocare.

| Classe | Vita | Velocità | Salto | Armi | Granate |
|---|---|---|---|---|---|
| Assaltatore | 100 | 100% | 1,20 m | fucile d'assalto, pistola, coltello | 2 |
| Cecchino | 85 | 96% | 1,30 m | cecchino, revolver, coltello | 1 |
| Demolitore | 120 | 92% | 1,15 m | lanciarazzi, fucile a pompa, coltello | 4 |
| Esploratore | 75 | 115% | 1,70 m | mitraglietta, pistola, coltello | 1 |
| Pesante | 150 | 82% | 1,05 m | mitragliatrice leggera, fucile a pompa, coltello | 2 |

I bot usano le classi a turno e impugnano la prima arma della classe che sanno usare (il cecchino
bot usa il revolver, il demolitore il fucile a pompa).

## Armi

I colpi necessari valgono contro 100 punti vita (Assaltatore).

| Arma | Note |
|---|---|
| Fucile d'assalto | automatico, mirino a punto rosso; 2 colpi alla testa o 5 al busto |
| Mitraglietta | 15 colpi al secondo, precisa anche in movimento, poca gittata |
| Mitragliatrice leggera | 100 colpi, lenta da spostare e da ricaricare |
| Fucile a pompa | 8 pallini, letale da vicino |
| Cecchino | preciso solo mirando; uccide con un colpo al busto |
| Pistola | semiautomatica |
| Revolver | un colpo alla testa uccide, rinculo forte |
| Lanciarazzi | danno ad area; spinge anche chi spara (salto con il razzo) |
| Coltello | due colpi di fronte, uno alle spalle; con il coltello si corre più veloci |

Granate: rimbalzano ed esplodono dopo 2,2 secondi. Dopo la rinascita si è protetti per 1,5 secondi,
o finché non si spara.

## Contenuti: armi, classi, modelli, skin e suoni

Tutto quello che riguarda le armi sta in file JSON dentro `content/`:

```
content/weapons/        un file per arma: valori di gioco, modello, suoni
content/classes/        un file per classe: vita, velocità, salto, armi
content/weapon-models/  modelli a blocchi (anche quelli di razzo e granata)
content/skins/          skin delle armi e dei personaggi
content/sounds/         suoni, descritti come livelli di rumore filtrato e toni
content/equipment/      la granata
content/maps/           le mappe
```

**Aggiungere un'arma** non richiede codice: basta un nuovo file in `content/weapons/`.
In sviluppo la pagina si ricarica da sola e l'arma compare nelle skin del menu; per usarla in partita
la si mette in una classe (`primary`, `secondary` o `melee`).
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

**Aggiungere una classe**: un file in `content/classes/`.

```json
{
  "id": "guastatore",
  "name": "Guastatore",
  "description": "Pompa e revolver, molto veloce.",
  "order": 6,
  "health": 90,
  "speed": 1.1,
  "jumpHeight": 1.4,
  "primary": "shotgun",
  "secondary": "revolver",
  "melee": "knife",
  "grenades": 2
}
```

`speed` moltiplica la velocità di corsa, `jumpHeight` è l'altezza raggiunta con un salto da fermi (m),
`grenades` è facoltativo (altrimenti vale `content/equipment/grenade.json`).

**Skin dei personaggi**: file in `content/skins/` con `"type": "character"`. Indicano il colore di
ognuna delle sei parti (`head`, `torso`, `armLeft`, `armRight`, `legLeft`, `legRight`) e, se si
vuole, dei dettagli (`hair`, `eyes`, `hands`, `feet`, `belt`). Gli accessori sono box attaccati a
una parte, con le coordinate della parte (origine nel collo per la testa, nel bacino per il busto;
y verso l'alto, z verso la schiena), al massimo 16 box per skin:

```json
{
  "type": "character",
  "id": "pescatore",
  "name": "Pescatore",
  "order": 9,
  "colors": { "head": "#e0b48a", "torso": "#f2c230", "armLeft": "#f2c230", "armRight": "#f2c230",
              "legLeft": "#2f6fb3", "legRight": "#2f6fb3" },
  "accessories": [
    { "name": "Cappello", "part": "head",
      "boxes": [ { "pos": [0, 0.37, 0], "size": [0.44, 0.06, 0.44], "color": "#f2c230" } ] }
  ]
}
```

Le skin delle armi hanno `"type": "weapon"` oppure, come nella Fase 3, nessun tipo e il campo `weapon`.

**Errori**: un file non valido ferma il gioco all'avvio con l'elenco completo dei problemi,
ciascuno con file e campo, per esempio `content/weapons/smg.json: "fireRate" deve essere un numero`.
Vengono controllati anche i riferimenti tra file (modelli, suoni, armi delle classi, parti delle skin)
e gli id duplicati.
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
- **Animazioni e hitbox** (`shared/src/pose.ts`): lo stato dell'animazione (corsa, salto, caduta,
  accovacciamento, scivolata, sparo, ricarica, estrazione, colpo subito) avanza con la simulazione e i
  pesi cambiano gradualmente, così le pose si mescolano senza scatti. Dalla stessa funzione nascono il
  personaggio disegnato e le hitbox: sei box orientati che seguono le parti animate. Il busto segue in
  parte la mira, testa e braccia la seguono del tutto; la testa contiene sempre il punto da cui si
  guarda. Un colpo che attraversa un braccio ed entra nel busto conta come colpo al busto. Con
  «Dati di debug» le hitbox si vedono in giallo sopra i personaggi.
- **Personaggi** (`client/src/render/CharacterRenderer.ts`): tutte le parti, i dettagli e gli
  accessori di tutti i personaggi sono un'unica mesh a istanze (una chiamata di disegno); l'arma in
  terza persona è posizionata dalla stessa posa.
- **Bot** (`shared/src/bots.ts`): navigano sui punti della mappa, reagiscono con ritardo, mirano
  con un errore che si riduce, sparano a raffiche.

## Note sull'ambiente

- **Node**: consigliato Node 24 LTS. Con Node 23 tutto funziona, ma npm avvisa che Vitest 5
  non lo supporta ufficialmente.
- **`.npmrc`** contiene `legacy-peer-deps=true`: npm 10.9 va in errore risolvendo le dipendenze
  di Vitest nei workspace. Con npm 11 si può togliere.
