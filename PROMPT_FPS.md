# Prompt: FPS da browser low-poly veloce con gore

> Copia tutto questo file e incollalo come primo messaggio a un agente di programmazione (per esempio Claude Code) in una cartella vuota.
> Sostituisci `BLOCKSTRIKE` con il nome che vuoi dare al gioco.

---

## 1. Obiettivo

Costruisci **BLOCKSTRIKE**, uno sparatutto in prima persona che gira nel browser, con:

- grafica low-poly a blocchi, colori piatti, niente texture realistiche;
- movimento molto veloce e basato sull'abilità (scivolata, salti concatenati, controllo in aria);
- personaggi animati divisi in classi;
- armi definite da file di dati, facili da aggiungere e modificare;
- effetti splatter: sangue, macchie, smembramento, esplosione in pezzi;
- multiplayer online a stanze.

Il gioco deve essere **originale**: nome, mappe, personaggi, modelli, suoni e interfaccia vanno creati da zero. Non copiare asset, mappe, nomi o interfaccia di giochi esistenti.

## 2. Stack obbligatorio

| Area | Tecnologia |
|---|---|
| Linguaggio | TypeScript (strict) |
| Build | Vite |
| Rendering | Three.js |
| Fisica | Controller del giocatore scritto a mano, collisioni AABB contro i blocchi della mappa |
| Server | Node.js + Colyseus (WebSocket), autoritativo |
| Modelli | Generati in codice con primitive (box) nella prima versione; caricamento glTF previsto per dopo |
| Audio | Howler.js, audio posizionale |
| Test | Vitest per la logica condivisa (movimento, danni, armi) |

Struttura del repository (monorepo con workspace npm):

```
/client      rendering, input, HUD, effetti, audio
/server      stanze Colyseus, simulazione autoritativa, bot
/shared      codice usato da entrambi: movimento, armi, costanti, tipi, formato mappa
/content     JSON di armi, classi, skin, mappe
```

Regola fondamentale: **la simulazione di movimento e di sparo vive in `/shared`** ed è deterministica a passo fisso (60 Hz), così client e server eseguono lo stesso codice.

## 3. Ordine di lavoro

Lavora una fase alla volta. Alla fine di ogni fase il gioco deve avviarsi con `npm run dev` ed essere giocabile. Non iniziare la fase successiva finché i criteri di accettazione non sono soddisfatti. Fai un commit a ogni fase.

### Fase 1 — Movimento

- Pointer lock, visuale con mouse, sensibilità e FOV regolabili.
- WASD, salto, accovacciamento, scivolata (accovacciarsi in corsa dà una spinta che decade).
- Accelerazione in aria con strafe: chi cambia direzione a tempo guadagna velocità.
- Salto concatenato: saltare appena si tocca terra conserva la velocità.
- Gravità, attrito a terra, velocità massima a terra, nessun limite rigido in aria.
- Collisioni AABB con scorrimento lungo i muri e salita automatica dei gradini bassi.
- Mappa di prova a blocchi con rampe, piattaforme e corridoi.
- Indicatore di velocità a schermo per la messa a punto.

**Accettazione:** 60 fps stabili; nessun attraversamento dei muri; il giocatore non si incastra negli spigoli; con salti e scivolate ben eseguiti si supera chiaramente la velocità di corsa.

### Fase 2 — Sparatoria

- Colpi hitscan con raycast dal centro della visuale.
- Rinculo visivo con schema per arma, dispersione che cresce sparando e in movimento.
- Mira con tasto destro: zoom, dispersione ridotta, velocità ridotta.
- Caricatore, ricarica, cambio arma con tempi.
- Hitbox separate: testa, busto, braccia, gambe, ognuna con moltiplicatore di danno.
- Calo del danno con la distanza.
- Proiettili fisici per razzi e granate, con danno ad area.
- Traccianti, fiammata alla bocca dell'arma, bossoli, segni di impatto sui muri.
- Indicatore di colpo a segno, numeri di danno opzionali, suono diverso per il colpo alla testa.
- Bot semplici che si muovono tra punti e sparano, per fare prove.

**Accettazione:** ogni arma si sente diversa; i colpi alla testa sono registrati correttamente; i bot possono uccidere ed essere uccisi.

### Fase 3 — Armi basate sui dati

Ogni arma è un file in `/content/weapons/*.json`. Aggiungere un'arma non deve richiedere modifiche al codice.

```json
{
  "id": "assault_rifle",
  "name": "Fucile d'assalto",
  "type": "hitscan",
  "damage": 24,
  "headMultiplier": 1.8,
  "limbMultiplier": 0.8,
  "fireRate": 600,
  "auto": true,
  "magazine": 30,
  "reloadTime": 1.9,
  "range": { "start": 20, "end": 60, "minDamageFactor": 0.6 },
  "spread": { "base": 0.4, "moving": 1.2, "perShot": 0.15, "max": 3.0, "ads": 0.1 },
  "recoil": { "pattern": [[0, 1.0], [0.2, 0.9], [-0.3, 0.8]], "recovery": 6 },
  "ads": { "fov": 55, "time": 0.18, "moveFactor": 0.7 },
  "pellets": 1,
  "moveSpeedFactor": 0.95,
  "gore": { "dismember": false, "gibChance": 0 },
  "model": "assault_rifle",
  "sounds": { "fire": "ar_fire", "reload": "ar_reload" }
}
```

Armi iniziali: fucile d'assalto, cecchino, shotgun, SMG, pistola, revolver, mitragliatrice leggera, lanciarazzi, coltello.

Modello in prima persona costruito con box, con animazioni procedurali: oscillazione in camminata, ritardo rispetto alla visuale, contraccolpo, ricarica, estrazione, mira.

Skin delle armi: file JSON che sostituisce colori o materiali delle parti del modello.

**Accettazione:** creare un nuovo JSON fa comparire l'arma nel gioco; un JSON non valido produce un errore chiaro all'avvio, non un crash in partita.

### Fase 4 — Personaggi e animazioni

- Personaggio a blocchi con sei parti: testa, busto, due braccia, due gambe, ognuna un nodo separato.
- Animazioni: fermo, corsa (gambe e braccia alternate), salto, caduta, accovacciamento, scivolata, sparo, ricarica, colpito, morte.
- Le animazioni si mescolano tra loro senza scatti; la parte superiore segue l'inclinazione della mira.
- L'arma impugnata è visibile in terza persona.
- Classi in `/content/classes/*.json`: vita, velocità, arma primaria, arma secondaria, altezza del salto.
- Classi iniziali: Assaltatore, Cecchino, Demolitore, Esploratore, Pesante.
- Skin dei personaggi in `/content/skins/*.json`: colori per parte e accessori (cappello, zaino) fatti di box.
- Schermata di scelta classe e skin con anteprima 3D che ruota.

**Accettazione:** le hitbox seguono le parti animate; ogni classe si gioca in modo diverso.

### Fase 5 — Splatter

- **Sangue all'impatto:** getto di particelle nella direzione del colpo, più forte per i colpi alla testa.
- **Macchie:** decal su muri e pavimento dove cadono le gocce; sfumano dopo un tempo.
- **Smembramento:** se il colpo letale colpisce testa o arto con un'arma che lo prevede, quella parte si stacca e diventa un oggetto fisico che rimbalza e lascia una scia.
- **Esplosione in pezzi:** razzi, granate e shotgun a distanza ravvicinata fanno a pezzi tutto il personaggio.
- **Ragdoll semplificato** negli altri casi: le parti restano collegate e cadono secondo la direzione del colpo.
- **Pozza di sangue** che si allarga sotto il corpo.
- **Schizzi sulla visuale** quando si uccide da molto vicino.
- **Uccisioni speciali:** annuncio e suono per colpo alla testa, serie di uccisioni, uccisione in aria.

Vincoli di prestazione, da rispettare sempre:

- pool di particelle con tetto massimo (per esempio 2000);
- massimo 150 macchie, le più vecchie vengono riciclate;
- massimo 60 pezzi fisici in scena;
- particelle e macchie disegnate con instancing.

Impostazione **Livello gore**: Completo, Ridotto (solo sangue, niente smembramento), Spento (scintille al posto del sangue, i corpi svaniscono).

**Accettazione:** con 12 giocatori e molte esplosioni il gioco resta sopra i 60 fps su un portatile con grafica integrata; l'impostazione Spento rimuove ogni effetto di sangue.

### Fase 6 — Multiplayer

- Server autoritativo a 60 Hz di simulazione, 20–30 Hz di invio dello stato.
- Il client invia solo gli input numerati; il server non si fida mai di posizione o danni dichiarati dal client.
- Predizione lato client e riconciliazione quando arriva lo stato del server.
- Interpolazione degli altri giocatori con un buffer di circa 100 ms.
- Compensazione del lag: il server riavvolge le hitbox al momento in cui il giocatore ha sparato, con un limite massimo di 200 ms.
- Controlli lato server: cadenza di fuoco, munizioni, velocità massima plausibile, linea di tiro.
- Stanze fino a 12 giocatori, con codice per invitare gli amici e ingresso rapido.
- Modalità: Tutti contro tutti, Deathmatch a squadre, Cattura la bandiera.
- Rinascita con punti scelti lontano dai nemici, breve invulnerabilità.
- Bot lato server per riempire le stanze vuote.
- Tabellone, feed delle uccisioni, chat di testo, tempo di partita, schermata finale.
- Sangue, macchie e pezzi sono calcolati **solo sul client**: il server invia soltanto l'evento di morte con parte colpita, direzione e arma.

**Accettazione:** due schede del browser giocano nella stessa stanza; con 150 ms di ritardo simulato il movimento resta fluido e i colpi vengono registrati correttamente.

### Fase 7 — Mappe ed editor

- Formato mappa JSON: elenco di blocchi (posizione, dimensione, colore, tipo), punti di rinascita, bandiere, luci.
- Tre mappe originali di dimensioni diverse: piccola e frenetica, media a corsie, grande e verticale.
- Editor nel browser: posiziona, ridimensiona, colora, duplica, annulla, salva ed esporta JSON, prova immediata della mappa.
- I blocchi statici vengono fusi in poche mesh per ridurre le chiamate di disegno.

### Fase 8 — Interfaccia, audio, rifinitura

- Menu principale, scelta classe, impostazioni (sensibilità, FOV, tasti, volume, qualità, livello gore, mirino personalizzabile).
- HUD: vita, munizioni, mirino, minimappa opzionale, indicatore della direzione del danno.
- Audio: spari posizionali, passi, impatti, suoni del gore, musica del menu. Usa suoni generati o con licenza libera e annota la fonte in `CREDITS.md`.
- Nebbia, luce direzionale con ombre semplici, cielo a gradiente.
- Tre livelli di qualità grafica.

### Fase 9 — Pubblicazione

- Build di produzione del client come sito statico.
- `Dockerfile` per il server.
- `README.md` con istruzioni per sviluppo locale e messa online.
- Variabile d'ambiente per l'indirizzo del server.

## 4. Stile grafico

- Solo forme a blocchi, spigoli netti, nessuna smussatura.
- Colori piatti e saturi, palette limitata per mappa.
- Illuminazione semplice: una luce direzionale più luce ambiente.
- Sangue rosso acceso e stilizzato, coerente con lo stile a blocchi.
- Interfaccia pulita, caratteri grandi e leggibili, animazioni brevi.

## 5. Regole di qualità

- TypeScript strict, nessun `any` non giustificato.
- Nessun numero magico nel codice di gioco: i valori di bilanciamento stanno in `/content` o in `/shared/constants.ts`.
- Nessuna allocazione di oggetti nel ciclo di gioco: riusa vettori e usa pool.
- Test con Vitest per: movimento (stesso input, stesso risultato), calcolo dei danni, validazione dei JSON di armi e classi.
- Obiettivo: 60 fps su portatile con grafica integrata, meno di 150 chiamate di disegno in partita.
- Dopo ogni fase, avvia il gioco e controllalo davvero nel browser prima di dichiararla finita.

## 6. Cosa non fare

- Non usare motori di gioco completi o motori fisici esterni per il giocatore.
- Non copiare nomi, mappe, modelli, suoni o interfaccia di giochi esistenti.
- Non aggiungere account, negozio o pagamenti in questa versione.
- Non passare alla fase successiva con errori nella console o test falliti.

## 7. Come iniziare

1. Crea la struttura del monorepo e la configurazione di Vite, TypeScript e Vitest.
2. Esegui la Fase 1 completa.
3. Fermati, descrivi cosa funziona e cosa no, e attendi conferma prima della Fase 2.
