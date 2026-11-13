/*
 * Service worker di BLOCKSTRIKE (app installabile). Il plugin di Vite lo scrive in dist/sw.js
 * sostituendo VERSIONE e FILE: l'elenco di tutto quello che serve per giocare senza rete
 * (l'allenamento contro i bot funziona offline; le partite online, ovviamente, no).
 *
 * - Pagine: prima la rete (così si vede sempre l'ultima versione), la copia salvata se offline.
 * - File con l'hash nel nome (assets/…): prima la copia salvata, non cambiano mai.
 * - Le richieste al server di gioco (matchmaking, WebSocket) e tutto ciò che non è GET non si
 *   toccano.
 */
const VERSION = '__VERSIONE__';
const FILES = __FILE__;
const CACHE = `blockstrike-${VERSION}`;
const SCOPE = new URL(self.registration.scope);

/**
 * Salva i file uno alla volta, saltando quelli già salvati: se l'installazione si interrompe (rete
 * del telefono che cade), alla visita dopo riparte da dove era arrivata. Se un file manca,
 * l'installazione fallisce e si riprova alla prossima visita.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  for (const file of FILES) {
    const url = new URL(file, SCOPE).href;
    if (await cache.match(url)) continue;
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    await cache.put(url, response);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('blockstrike-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (url.pathname.includes('/matchmake') || request.headers.get('upgrade') === 'websocket') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (await cache.match(url.pathname, { ignoreSearch: true })) ?? (await cache.match(new URL('./', SCOPE).href)) ?? Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.includes('/assets/')) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
