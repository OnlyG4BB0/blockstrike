/**
 * Indirizzo del server di gioco (funzioni pure, senza DOM).
 *
 * L'indirizzo si può scrivere come lo si conosce: «gioco.example.com», «192.168.1.10:2567»,
 * «https://gioco.example.com» o già «wss://…»: diventa sempre un indirizzo WebSocket.
 */

/** Indirizzo WebSocket normalizzato; '' se vuoto (= quello predefinito); null se non è valido. */
export function normalizeServerAddress(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return '';
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `${isLocalHost(text) ? 'ws' : 'wss'}://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme === 'http:') url.protocol = 'ws:';
  else if (scheme === 'https:') url.protocol = 'wss:';
  else if (scheme !== 'ws:' && scheme !== 'wss:') return null;
  if (!url.hostname || url.search || url.hash || url.username) return null;
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** Indirizzi di casa o della rete locale: lì di solito non c'è un certificato, quindi ws://. */
function isLocalHost(text: string): boolean {
  const host = text.split(/[/:]/)[0]!.toLowerCase();
  return host === 'localhost' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export interface ServerChoice {
  /** Indirizzo scelto dal giocatore nelle impostazioni ('' = nessuno). */
  user: string;
  /** Indirizzo deciso alla build (VITE_SERVER_URL), '' se non c'è. */
  configured: string;
  /** Pagina servita dal server stesso (sito o container), da cui si ricava l'indirizzo. */
  page: { protocol: string; hostname: string; host: string } | null;
  /** In sviluppo il server di gioco è sulla porta 2567 della stessa macchina. */
  dev: boolean;
}

/**
 * Indirizzo da usare: quello del giocatore, poi quello della build, poi la pagina stessa; null se
 * non ce n'è nessuno (l'app Android senza indirizzo: la pagina non è un server).
 */
export function chooseServerUrl(choice: ServerChoice): string | null {
  const user = normalizeServerAddress(choice.user);
  if (user) return user;
  if (choice.configured) return choice.configured;
  if (!choice.page) return null;
  const secure = choice.page.protocol === 'https:';
  const host = choice.dev ? `${choice.page.hostname}:2567` : choice.page.host;
  return `${secure ? 'wss' : 'ws'}://${host}`;
}
