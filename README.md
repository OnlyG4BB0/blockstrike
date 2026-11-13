# BLOCKSTRIKE

Sparatutto in prima persona da browser, grafica low-poly a blocchi, movimento veloce.
Nome provvisorio.

**Stato: Fase 8 completata — interfaccia, audio e rifinitura.**

## Avvio

```bash
npm install
npm run dev
```

`npm run dev` avvia insieme il server di gioco (ws://localhost:2567) e il client (http://localhost:5173).
Apri il client, scegli classe e aspetto e premi **Gioca** per l'allenamento contro i bot (con il menu
aperto è in pausa), oppure usa la sezione **Online** del menu.

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Avvia server di gioco e client in sviluppo |
| `npm run dev:client` / `npm run dev:server` | Solo il client / solo il server |
| `npm start` | Solo il server di gioco (porta da `GAME_PORT` o `PORT`, predefinita 2567) |
| `npm test` | Esegue i test (Vitest) |
| `npm run typecheck` | Controlla i tipi di tutti i pacchetti |
| `npm run build` | Build di produzione del client in `client/dist` |
| `npm run smoke` | Controlla i contenuti e simula una partita tra bot su ogni mappa, in Node |
| `npm run smoke:net` | Avvia il server e collega due client veri (socket), controlla che si vedano |

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
| Invio | Chat (online): Invio di nuovo per mandare, Esc per chiudere |
| K | Tornare a un punto di partenza |
| Esc | Menu: online, personaggio, impostazioni, comandi |

I tasti di movimento, salto, accovacciamento, ricarica, granata, arma precedente, ricomincia e
punteggi si cambiano nel menu (**Impostazioni → Tasti**: clic sull'azione, poi il tasto nuovo; Esc
annulla). I numeri restano per le armi.

## Menu, HUD e impostazioni

Il menu ha quattro schede: **Online**, **Personaggio** (classe e aspetto con l'anteprima 3D),
**Impostazioni** e **Comandi**; sopra ci sono sempre **Gioca**, la scelta della mappa e il link
all'editor.

**Impostazioni**:
- sensibilità e campo visivo;
- volume generale e della musica del menu;
- qualità grafica e livello di gore;
- numeri di danno, minimappa, campo visivo che si allarga in velocità, FPS e dati di debug;
- mirino personalizzabile, con anteprima: colore, lunghezza, spessore, distanza dal centro, punto e
  bordo;
- tasti;
- bot dell'allenamento e skin delle armi.

| Qualità | Pixel | Ombre | Particelle |
|---|---|---|---|
| bassa | 0,75 × | no | 600 |
| media | fino a 1,25 × | mappa 1024 | 1200 |
| alta | fino a 2 × | mappa 2048 | 2000 |

L'antialiasing (spento in qualità bassa) cambia al successivo avvio della pagina; il resto subito.

**HUD**:
- vita e munizioni;
- mirino che si allarga con la dispersione;
- segnali di colpo e numeri di danno;
- minimappa facoltativa, con il nord in alto: compagni sempre, nemici solo per 2,5 s dopo che hanno
  sparato, bandiere;
- segnale rosso attorno al mirino verso chi ha colpito;
- elenco delle uccisioni, punteggi (Tab), annunci, chat, tempo e punteggi online.

**Audio** con Howler.js:
- spari, ricariche, passi, impatti sui muri, esplosioni e gore nello spazio;
- colpi a segno, annunci e musica del menu, che sfuma quando si gioca.

Tutti i suoni sono generati dal gioco: vedi [CREDITS.md](CREDITS.md).

**Grafica**: nebbia, sole con ombre semplici (una mappa d'ombra per tutta la mappa), luce ambiente,
cielo a gradiente e luci della mappa.

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

## Mappe

| Mappa | Dimensioni | Carattere |
|---|---|---|
| Cortile | 40 × 40 m | piccola e frenetica: piattaforma centrale con quattro rampe, casse, ballatoi bassi |
| Corsie | 42 × 80 m | media a tre corsie: muri divisori con varchi, ballatoi alti sui lati, basi alle estremità |
| Torri | 96 × 96 m | grande e verticale: quattro torri a gradoni (4, 8 e 12 m), ponti a 8 m, piazza rialzata |
| Arena di prova | 66 × 66 m | la mappa delle prime fasi |

Tutte hanno punti di rinascita per squadra e le basi per «cattura la bandiera». La mappa si sceglie nel
menu accanto a **Gioca** (allenamento e stanze create); in una stanza online decide chi la crea.

**Formato** (`content/maps/*.json`): `blocks` (`pos` angolo minimo, `size`, `color`, `type` `box` o
`ramp` con `dir` verso cui sale), `spawns` (`pos`, `yaw` in gradi, `team` 1 o 2, 0 per tutti),
`flags` (due basi, `team` e `pos`), `lights` (al massimo 8: `pos`, `color`, `intensity`,
`distance`), `waypoints` facoltativi, cielo, nebbia, sole e luce ambiente. Le mappe nuove non hanno
`waypoints`: il grafo dei bot si calcola dalla geometria. I punti stanno su una griglia di 2 m sulle
strutture e di 4 m sul pavimento; due punti vicini sono collegati solo se una camminata simulata, con
salti se servono, va davvero dall'uno all'altro. Il server lo calcola una volta all'avvio per ogni mappa.

**Disegno**: tutti i blocchi statici sono fusi in un'unica mesh (una chiamata di disegno, più una per
l'ombra) qualunque sia il loro numero.

### Editor di mappe

`http://localhost:5173/editor.html` (link «Editor di mappe» nel menu).

| Comando | Cosa fa |
|---|---|
| Tasto destro + mouse | guarda intorno |
| W A S D · Q E | muoviti · scendi e sali (Maiusc più veloce) |
| Clic | seleziona blocco, rinascita, bandiera o luce |
| Frecce · PagSu PagGiù | sposta la selezione sulla griglia |
| Alt + frecce · Alt + PagSu PagGiù | ridimensiona il blocco |
| Ctrl+D · Canc | duplica · elimina |
| Ctrl+Z · Ctrl+Y | annulla · ripeti |

Il pannello a sinistra aggiunge blocchi, rampe, rinascite, bandiere e luci davanti alla visuale; quello a
destra modifica posizione, dimensioni, colore e tipo della selezione, oppure (senza selezione) cielo,
nebbia e luci della mappa. La mappa si salva da sola nel browser; **Esporta JSON** la scarica (da mettere
in `content/maps/` per includerla nel gioco), **Importa JSON** e **Apri** caricano una mappa. Ogni modifica
è controllata con lo stesso codice del gioco; **Prova** apre la mappa nel gioco con i bot
(`?mappa=editor`).

## Online

Dal menu, sezione **Online** (il nome si sceglie lì):

- **Partita veloce**: entra in una stanza pubblica della modalità scelta, o ne crea una.
- **Crea stanza**: stanza privata con un codice di 5 caratteri (per esempio `K5EX3`); «Copia invito»
  copia un link del tipo `http://localhost:5173/?stanza=K5EX3`.
- **Entra**: con il codice di un amico.

Modalità: **tutti contro tutti** (vince chi arriva a 25 uccisioni, 8 minuti), **deathmatch a squadre**
(Rossi contro Blu, 50 uccisioni, 10 minuti, niente fuoco amico) e **cattura la bandiera** (3 catture,
10 minuti; si prende la bandiera nemica e la si porta alla propria base mentre la propria è a casa; una
bandiera persa torna alla base dopo 20 secondi o se la tocca un compagno). Le stanze hanno fino a 12
giocatori; i bot del server riempiono i posti fino a 6. A fine partita c'è la classifica e dopo 10
secondi ne riparte un'altra. Si rinasce lontano dai nemici (nelle squadre dalla propria parte), con
1,5 secondi di protezione. La classe scelta nel menu vale dalla rinascita successiva.

**Ritardo simulato**: aggiungendo `&ping=150` all'indirizzo (per esempio
`?online=crea&modalita=ffa&ping=150`, oppure `?stanza=CODICE&ping=150`) il client ritarda di 75 ms
ogni messaggio in uscita e ogni messaggio in arrivo. Due schede dello stesso browser possono giocare
nella stessa stanza.

### Come funziona la rete

- **Server autoritativo** (Colyseus): simula la partita a 60 Hz e invia lo stato 30 volte al secondo.
  Tutta la logica sta in `shared/src/net/server.ts` (`ServerCore`); la stanza Colyseus
  (`server/src/GameRoom.ts`) fa solo da tramite.
- **Il client manda solo comandi numerati** (tasti, mira, arma), mai posizioni o danni. Il server
  esegue un passo di simulazione per ogni comando ricevuto (al massimo 3 per tick).
- **Controlli lato server**:
  - la cadenza di fuoco, le munizioni e la linea di tiro sono quelle della simulazione;
  - i comandi accettati non possono superare il tempo passato più un piccolo margine: mandarne di più
    non fa correre più veloci;
  - i testi (nomi, chat) sono ripuliti e la chat ha un limite di frequenza.
- **Predizione e riconciliazione** (`shared/src/net/client.ts`): il proprio giocatore si muove
  subito. Per ogni comando si tiene lo stato previsto e, quando il server lo conferma, si confronta. Se
  coincide non si fa nulla; se diverge (per esempio una spinta da un'esplosione) si riparte dallo stato
  del server e si rieseguono i comandi non ancora confermati. Lo scarto ammesso è 0,000001 m:
  browser e Node possono differire all'ultima cifra dei calcoli.
- **Interpolazione**: gli altri giocatori si vedono 100 ms nel passato, tra due pacchetti di stato.
  Gli eventi degli altri (spari, sangue, esplosioni) compaiono al loro tick, insieme ai corpi; quelli
  che riguardano il giocatore (colpi dati e subiti, morte) subito.
- **Compensazione del lag**: con ogni comando il client dice a quale tick del server stava vedendo
  gli altri. Quando quel comando spara, il server riporta le hitbox degli altri a quel momento (dalla
  storia delle pose di ogni tick) e poi le rimette a posto. Il limite di 200 ms vale per la latenza,
  in aggiunta ai 100 ms di interpolazione: il riavvolgimento massimo è quindi 300 ms. Con 150 ms di
  ping il server riavvolge circa 14 tick (230 ms).
- **Splatter** solo nel client: il server invia l'evento di morte con parte colpita, direzione, arma
  e numero di morti della vittima, che basta a dare lo stesso esito su tutti gli schermi.

**Prove** (in `shared/tests/net.test.ts` server e client si parlano attraverso una coda con ritardo, a
tempo finto, con 150 ms di ping):
- nessun errore di predizione in 6 secondi di corsa, salti e spari;
- una spinta decisa dal server viene corretta con un solo pacchetto;
- contro un bersaglio che si sposta di lato, 27 colpi su 30 vanno a segno con la compensazione e 1 su
  30 senza;
- un riavvolgimento oltre il limite viene tagliato;
- mandare tre comandi per tick non fa correre più veloci;
- premere il grilletto a raffica non supera la cadenza dell'arma.

Nel browser, con due schede e `&ping=150`, il server ha confermato 5 dei 6 colpi che il client
vedeva a segno su un bersaglio in movimento, con un ping misurato di 163 ms e nessuna correzione
della predizione.

**Limiti noti**: in «cattura la bandiera» i bot combattono ma non vanno a prendere la bandiera.

## Splatter

Tutto lo splatter è calcolato solo nel browser, a partire dagli eventi della partita (colpo,
morte con parte colpita, direzione e arma).

- **Sangue all'impatto**: un getto di cubetti rossi nella direzione del colpo, più forte alla testa.
- **Macchie**: le gocce che toccano muri e pavimento lasciano macchie a blocchi che sfumano dopo
  circa 25 secondi.
- **Smembramento**: se il colpo letale prende la testa o un arto con un'arma che lo prevede
  (`"gore": { "dismember": true }`), quella parte si stacca, vola via rimbalzando e lascia una scia;
  dal moncherino esce sangue per qualche secondo.
- **Corpo a pezzi**: razzi e granate fanno sempre a pezzi; il fucile a pompa lo fa da vicino
  (`gibChance` entro `gibRange` metri, nel JSON dell'arma). L'esito dipende solo dalla vittima e
  dal numero delle sue morti, quindi è lo stesso su ogni schermo.
- **Manichino** negli altri casi: il corpo cade intero nella direzione del colpo, con braccia e gambe
  che seguono (punti e aste, con attrito sul terreno).
- **Pozza di sangue** che si allarga sotto il corpo fermo.
- **Schizzi sulla visuale** quando si uccide da meno di 3,5 m.
- **Uccisioni speciali**, con annuncio e suono: colpo alla testa, doppietta e tripletta (uccisioni
  entro 3 secondi), serie di uccisioni senza morire (3, 5, 7...), uccisione dall'alto o di chi è in aria.

**Livello gore** (menu, sezione Impostazioni): *completo*; *ridotto*, con sangue e manichini ma senza
smembramento né corpi a pezzi; *spento*, con scintille al posto del sangue, nessuna macchia, e i
corpi che svaniscono.

**Tetti fissi**: 2000 particelle, 150 macchie (le più vecchie si riciclano), 60 pezzi fisici e
12 manichini. Particelle e macchie sono disegnate con l'instancing, corpi e pezzi insieme ai personaggi.
Prova di carico (12 combattenti, un'esplosione con corpo a pezzi ogni 0,2 s per 6 s): circa 1 ms di CPU
per fotogramma in media e 3 ms al massimo, al massimo 60 chiamate di disegno. I tempi della scheda
grafica non sono misurati: vanno verificati su un portatile con grafica integrata.

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
- `gore`: `dismember` (il colpo letale stacca la parte colpita), `gibChance` e `gibRange`
  (probabilità di fare a pezzi il corpo entro quella distanza).
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
server/    server di gioco (Colyseus), prove in Node
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
