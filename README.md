# BLOCKSTRIKE

Sparatutto in prima persona da browser, grafica low-poly a blocchi, movimento veloce.
Nome provvisorio.

**Stato: fasi 1–10 completate.** Si gioca da computer (tastiera e mouse o controller) e da
telefono (comandi touch), e su Android si installa come app direttamente dal sito.

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
| `npm run smoke:net` | Avvia il server e collega due client veri (socket), controlla che si vedano. Con `SMOKE_URL` si collega a un server già avviato (per esempio il container) |

## Messa online

### Pagina su GitHub Pages, server su una VPS (la configurazione di questo progetto)

La pagina sta su GitHub Pages (https://onlyg4bb0.github.io/blockstrike/) e il server di gioco su
una VPS (Oracle), raggiungibile in `wss://` con un certificato automatico. Dalla pagina si scarica
anche l'APK.

**1. Server sulla VPS** (`deploy/vps/`): un comando, dato dalla console della VPS (SSH, oppure
nella console Oracle: istanza → «Run command» o la console seriale). Serve l'IP pubblico della VPS.

```bash
curl -fsSL https://raw.githubusercontent.com/OnlyG4BB0/blockstrike/main/deploy/vps/install.sh | bash -s -- IP.DELLA.VPS
```

- Mette solo due container suoi, `blockstrike-game` (server) e `blockstrike-caddy` (https/wss con
  certificato Let's Encrypt per `IP-CON-TRATTINI.sslip.io`, un nome gratuito che punta all'IP).
- **Non tocca nient'altro** (per esempio bobertbot): niente container fermati o cancellati. Se le
  porte 80 o 443 sono già usate da un altro programma si ferma prima di cambiare qualcosa.
- Aggiunge solo due regole al firewall della macchina (porte 80 e 443). Nella **console Oracle**
  bisogna aprirle anche lì: Networking → Virtual Cloud Network → Security List → Ingress rule TCP 80
  e 443 da 0.0.0.0/0.
- Rilanciare lo stesso comando aggiorna il server all'ultima versione del repository.
- Provato qui con Docker: Caddy con certificato locale e la prova di rete con due client attraverso
  `wss://` (`SMOKE_URL=wss://… npm run smoke:net`), tutto a posto.

**2. Pagina** con il server già scelto:

```bash
npm run deploy:pages -- wss://IP-CON-TRATTINI.sslip.io
```

Compila il sito per un hosting statico, ci mette l'APK se c'è (`npm run build:android` prima, con
`VITE_SERVER_URL=wss://…` per avere lo stesso server già impostato nell'app) e lo pubblica sul
ramo `gh-pages`. Senza indirizzo, nel menu compare il campo **Server**.

**3. Codice**: `npm run publish:repo` aggiorna https://github.com/OnlyG4BB0/blockstrike (ramo `main`)
con l'indirizzo noreply di GitHub come autore dei commit: l'email personale resta solo in locale.

### Un solo container (consigliato)

Il server di gioco può servire anche il client compilato: pagina, editor e partite stanno allo stesso
indirizzo. Il `Dockerfile` fa tutto:

```bash
docker build -t blockstrike .
```

```bash
docker run -p 2567:2567 blockstrike
```

Poi si apre http://localhost:2567 (o l'indirizzo del server). In produzione si mette davanti un
proxy con HTTPS (per esempio Caddy o nginx) che inoltri anche le connessioni WebSocket: la pagina in
`https://` si collega da sola in `wss://` allo stesso indirizzo.

L'immagine (circa 290 MB, su `node:24-alpine`) è stata costruita e provata con Docker Desktop: il
server gira come utente `node`, serve pagina ed editor, accetta le partite dalla stessa origine e si
ferma subito con `docker stop`. Per controllare un container avviato con due client veri:

```bash
SMOKE_URL=ws://localhost:2567 npm run smoke:net
```

(In PowerShell: `$env:SMOKE_URL="ws://localhost:2567"; npm run smoke:net`.)

npm 11 avvisa che lo script di installazione di `msgpackr-extract` (accelerazione nativa facoltativa
usata da Colyseus) non è approvato: senza, Colyseus funziona lo stesso.

### App per Android (installabile dal sito)

Il gioco è anche un'app da installare (PWA): su Android con Chrome diventa un'app vera, con la sua
icona, a schermo intero e in orizzontale. Nel menu, scheda **Online**, la sezione **App per il
telefono** ha il pulsante **Installa l'app** (compare anche accanto a «Gioca» quando il browser è
pronto). Se il browser non propone l'installazione, la sezione spiega cosa fare:
Chrome su Android: menu ⋮ → «Installa app»; Safari su iPhone: Condividi → «Aggiungi alla schermata
Home»; Chrome o Edge sul computer: icona nella barra degli indirizzi.

- **Serve HTTPS**: i browser installano le app e attivano il service worker solo da un indirizzo
  `https://` (o da `localhost`). Con il container dietro un proxy HTTPS va tutto da sé. Da un
  telefono che apre `http://192.168.x.x:2567` il gioco funziona, ma non si installa: la scheda lo
  dice.
- **Senza rete** l'app si apre lo stesso e l'allenamento contro i bot funziona: il service worker
  (`client/pwa/sw.template.js`, scritto in `dist/sw.js` a ogni build con l'elenco dei file) tiene
  una copia di pagina, codice, mappe e icone. Le pagine si chiedono prima alla rete, così una nuova
  versione arriva subito; le partite online e il matchmaking non passano mai dalla copia.
- **Nella versione di sviluppo** (`npm run dev`) il service worker è spento, per non tenere copie
  vecchie dei moduli di Vite.
- **Provare sul telefono senza un sito https**: collegare il telefono con il cavo USB, aprire
  `chrome://inspect` sul computer, attivare «Port forwarding» da 2567 a `localhost:2567` e aprire
  `http://localhost:2567` sul telefono: per il browser è `localhost`, quindi si installa. (Non
  provato qui: serve un telefono vero.)
- **Le icone** (`client/public/icons`) sono disegnate da `scripts/icons.mjs`: `node scripts/icons.mjs`
  le rigenera.

Verificato con Chrome senza interfaccia contro il container: manifest senza errori, nessun ostacolo
all'installazione secondo Chrome (`Page.getInstallabilityErrors` vuoto), service worker attivo con
14 file salvati, e con il server spento la pagina si apre e l'allenamento parte.

### APK per Android

Oltre all'app web c'è un APK vero, da installare anche senza un sito https: il gioco compilato è
dentro l'APK e lo mostra una WebView (`android/`: Java semplice, senza Gradle né librerie).
L'allenamento funziona senza rete; per giocare online si scrive l'indirizzo del server nel menu
(scheda **Online**, campo **Server**: va bene `gioco.example.com`, `192.168.1.10:2567` o un
indirizzo `wss://`).

```bash
npm run build:android
```

- Serve **Docker acceso**: la prima volta costruisce l'immagine `blockstrike-android-sdk` (circa
  1,4 GB) con l'Android SDK; il pacchetto di Google si controlla con la sua impronta SHA-256.
  Costruirla vuol dire **accettare le licenze dell'Android SDK**.
- Il risultato è `android/build/blockstrike.apk`, firmato (schemi v2 e v3) e allineato. La build
  del sito (`npm run build`) lo copia in `download/blockstrike.apk` e la scheda **App per il
  telefono** mostra il link per scaricarlo. Sul telefono va permessa l'installazione di app da
  quella fonte.
- `VITE_SERVER_URL=wss://… npm run build:android` mette un server predefinito nell'app.
- **Chiave di firma**: la prima build la crea in `android/keystore/` (fuori da git e da Docker).
  **Tienine una copia**: gli aggiornamenti si installano sopra la versione vecchia solo se sono
  firmati con la stessa chiave. Senza, bisogna disinstallare e reinstallare.
- L'id dell'app è `app.blockstrike.gioco` e non va più cambiato (Android lo usa per gli
  aggiornamenti).
- Nell'app: schermo intero in orizzontale; il tasto Indietro mette in pausa la partita (nel menu
  manda l'app in secondo piano); i tasti del controller vanno solo al gioco (B non fa «Indietro»).
- **Verificato qui**: build, firma, allineamento, `resources.arsc` non compresso, pacchetto, SDK,
  permessi e attività di avvio; tipi di tutti i file del gioco; la versione Android del gioco,
  servita da un altro indirizzo, crea una stanza sul server scritto nel campo. **Non verificato**:
  installazione e avvio su un telefono (qui non c'è un emulatore Android). Online con un indirizzo
  `ws://` della rete di casa da una pagina https: la WebView è impostata per permetterlo, ma è da
  provare; con `wss://` non ci sono dubbi.

### Client e server separati

1. **Client come sito statico**: si compila indicando dove sarà il server di gioco, poi si pubblica la
   cartella `client/dist` su qualunque hosting statico (i percorsi sono relativi, va bene anche una
   sottocartella).

   ```bash
   VITE_SERVER_URL=wss://gioco.example.com npm run build
   ```

   (Su Windows in PowerShell: `$env:VITE_SERVER_URL="wss://gioco.example.com"; npm run build`.)
   Si può anche scrivere la variabile in `client/.env.production` (vedi `client/.env.example`).
2. **Server** con Docker (`docker run -e CLIENT_DIR= -p 2567:2567 blockstrike` per servire solo le
   partite) o direttamente con Node 24: `npm ci --omit=dev --workspace @blockstrike/server` e
   `npm start`.

### Variabili d'ambiente

| Variabile | Dove | Cosa fa |
|---|---|---|
| `VITE_SERVER_URL` | build del client | indirizzo del server (`ws://…` o `wss://…`). Se manca: in sviluppo stesso host sulla porta 2567, nel client compilato la stessa origine della pagina |
| `PORT` | server | porta di ascolto (predefinita 2567); `GAME_PORT` ha la precedenza |
| `CLIENT_DIR` | server | cartella del client compilato da servire (nel container `/app/client/dist`); vuota = solo partite |

Il server non salva niente su disco: le stanze vivono in memoria. Con più istanze servirebbe un
presence condiviso di Colyseus (per esempio Redis), non incluso.

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

### Controller

Qualunque controller che il browser riconosce con la disposizione standard (Xbox, PlayStation,
Nintendo e la maggior parte di quelli USB o Bluetooth). Basta collegarlo e premere un tasto.

| Controller (Xbox · PlayStation) | Azione |
|---|---|
| Levetta sinistra | Muoversi (8 direzioni, come la tastiera) |
| Levetta destra | Guardarsi intorno |
| RT · R2 | Sparare |
| LT · L2 | Mirare |
| A · ✕ | Saltare |
| B · ○ (o premere la levetta sinistra) | Accovacciarsi / scivolare |
| X · □ | Ricaricare |
| Y · △ | Arma successiva |
| ← ↑ → sulla croce | Armi 1, 2, 3 |
| LB · L1 | Arma precedente |
| RB · R1 | Granata |
| View · Create (tenuto) | Punteggi |
| ↓ sulla croce | Ricominciare (allenamento) |
| Menu · Options | Pausa e menu |

**Nel menu** si usa solo il controller: croce o levetta per spostarsi, A · ✕ per scegliere (sui
cursori e sugli elenchi ← e → cambiano il valore), LB · RB per cambiare scheda, B · ○ o Start per
tornare a giocare. La chat online si scrive solo da tastiera o telefono.

### Telefono e tablet (touch)

Si gioca in orizzontale; con il telefono in verticale compare l'avviso per ruotarlo.

- **Metà sinistra**: la levetta compare dove si appoggia il pollice.
- **Metà destra**: si trascina per guardarsi intorno. Con il dito lento si mira fine (100 px ≈ 37°),
  con uno scatto ci si gira di colpo (fino a 2,2 volte più veloce).
- Si guarda anche **trascinando da un tasto** (fuoco, mirino, salto, giù, ricarica, granata, arma):
  il tasto agisce e il dito, appena si sposta, muove la visuale.
- **✹ Fuoco**: tenuto, spara.
- **◎ Mirino** e **⤓ Giù** restano attivi finché non si toccano di nuovo.
- **⤒ Salto**, **⟳ Ricarica**, **● Granata**, **⇄ Arma** (tenuto premuto: l'arma di prima).
- In alto a destra: **❚❚ Menu**, **☰ Punteggi** (tenuto), **💬 Chat** (online) o **↺ Ricomincia**
  (allenamento).
- **Disposizione**: Impostazioni → Controller e touch → **Disponi i comandi touch**. Si trascinano i
  tasti dove si vuole, toccandone uno se ne cambia la dimensione; **Ripristina** torna a quella
  predefinita. Lì accanto anche l'opacità dei tasti e la velocità della visuale.
- **Automira** (solo con i comandi touch, mai con tastiera o controller, nemmeno sul telefono):
  - vicino a un nemico la visuale col dito rallenta, così non si scavalca il bersaglio;
  - mentre si spara, si mira o si muove la visuale, il mirino va piano sul busto del nemico più
    vicino al centro (entro 8° circa e 45 m, solo se si vede); da fermi non si muove da solo;
  - si spegne o se ne regola la forza in Impostazioni → Controller e touch. Cambia solo dove si
    guarda, come farebbe il dito: i colpi li decide il server come sempre.

### Novità e aggiornamenti

- Dopo un aggiornamento, all'avvio compare la finestra **Novità** con le note della versione; il
  pulsante **✦ Novità** del menu la riapre.
- Sul sito, quando il service worker ha scaricato una versione nuova, nel menu compare **Aggiorna**.
- Nell'app Android il gioco legge `version.json` dal sito: se c'è un APK più nuovo compare
  **Scarica**, che lo apre nel browser.
- **Per una nuova versione**: alzare `version` in `package.json` e aggiungere in cima a
  `content/patches.json` la voce con le note (un test controlla che ci sia). Poi
  `npm run build:android`, `npm run deploy:pages -- wss://…` e `npm run publish:repo`.

### Tasti mostrati automaticamente

Il gioco mostra i tasti del dispositivo usato per ultimo: tastiera (con i tasti scelti nelle
impostazioni), touch o controller, disegnati come sul modello collegato (A B X Y colorati per Xbox,
✕ ○ □ △ per PlayStation, B A Y X per Nintendo). Cambiano da soli appena si usa un altro dispositivo:
scheda **Comandi**, «Gioca», schede del menu, suggerimenti in alto e tasti delle armi. Un
controller collegato a un telefono nasconde i comandi touch; se si scollega, tornano.

**Impostazioni → Controller e touch**: velocità della visuale con la levetta e con il dito, asse
verticale invertito, vibrazione quando si viene colpiti (controller o telefono).

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
  - i comandi accettati non possono superare il tempo passato più un margine di mezzo secondo (per i
    comandi che arrivano tutti insieme dopo un intoppo di rete): mandarne di più non fa correre più
    veloci;
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
- mandare tre comandi per tick non fa correre più veloci, nemmeno dopo essere rimasti in silenzio
  (si accetta al massimo un comando per tick, con un margine di mezzo secondo che non si accumula);
- online si gioca sempre con una classe: una classe sconosciuta vale la prima e non si può cambiare
  in nessuna;
- premere il grilletto a raffica non supera la cadenza dell'arma.

La prova con socket veri (`npm run smoke:net`) controlla anche che ognuno veda la skin scelta
dall'altro e che una skin che non esiste non arrivi agli altri.

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
client/    rendering (Three.js), input (tastiera, touch, controller), effetti, suoni, HUD, menu, app (PWA)
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
- **Input** (`client/src/input/`): `Input.ts` unisce tastiera e mouse, `Touch.ts` (comandi sullo
  schermo, Pointer Events) e `Gamepad.ts` (Gamepad API, letta a ogni fotogramma); le parti pure
  (zona morta, modello del controller, navigazione del menu) sono in `devices.ts` e i tasti da
  mostrare in `client/src/ui/prompts.ts`, con i test in `client/tests`. Il movimento resta a
  -1, 0, 1 come lo vuole il server: levette e levetta touch scelgono una delle 8 direzioni.

## Note sull'ambiente

- **Node**: consigliato Node 24 LTS. Con Node 23 tutto funziona, ma npm avvisa che Vitest 5
  non lo supporta ufficialmente.
- **`.npmrc`** contiene `legacy-peer-deps=true`: npm 10.9 va in errore risolvendo le dipendenze
  di Vitest nei workspace. Con npm 11 si può togliere.
