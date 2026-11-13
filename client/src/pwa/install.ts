import { compareVersions } from '../ui/patches.ts';

/**
 * Il gioco come app da installare (PWA): su Android Chrome la installa come un'app vera, con
 * icona, schermo intero e orientamento orizzontale. Qui: registrazione del service worker e
 * scheda «App» del menu, che spiega sempre perché si può o non si può installare.
 */

/** L'evento con cui il browser offre l'installazione (non è ancora nei tipi standard del DOM). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'android' | 'app' | 'installed' | 'ready' | 'insecure' | 'development' | 'manual';

/** Cosa dire per ogni situazione (funzione pura). */
export function installMessage(state: InstallState, platform: 'android' | 'ios' | 'desktop'): string {
  switch (state) {
    case 'android':
      return 'Stai usando l\'app per Android: per giocare online scrivi l\'indirizzo del server qui sopra.';
    case 'app':
      return 'Stai già giocando con l\'app installata.';
    case 'installed':
      return 'Installata: la trovi tra le app, con l\'icona di BLOCKSTRIKE.';
    case 'ready':
      return 'Si installa come un\'app: icona sulla schermata Home, schermo intero e orizzontale. L\'allenamento funziona anche senza rete.';
    case 'insecure':
      return 'Da questo indirizzo non si può installare: i browser lo permettono solo da un sito https:// (o da localhost). Apri il gioco dal suo indirizzo https.';
    case 'development':
      return 'Nella versione di sviluppo l\'installazione è spenta: usa quella compilata (npm run build o il container Docker).';
    case 'manual':
      if (platform === 'android') return 'Su Android con Chrome: menu ⋮ in alto a destra → «Installa app» (o «Aggiungi a schermata Home»).';
      if (platform === 'ios') return 'Su iPhone o iPad con Safari: tasto Condividi → «Aggiungi alla schermata Home».';
      return 'Con Chrome o Edge: icona di installazione a destra nella barra degli indirizzi, oppure dal menu del browser.';
  }
}

function platform(): 'android' | 'ios' | 'desktop' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'desktop';
}

function runningAsApp(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches;
}

/**
 * Registra il service worker (solo nella versione compilata e su un'origine sicura) e collega la
 * scheda dell'app nel menu.
 */
export type UpdateNotifier = (text: string, label: string, action: () => void) => void;

export function setupInstall(production: boolean, androidApp: boolean, notify: UpdateNotifier): void {
  if (production && !androidApp && window.isSecureContext && 'serviceWorker' in navigator) {
    // C'era già un service worker e ne arriva uno nuovo: la versione nuova è pronta, basta ricaricare.
    const hadController = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) notify('È pronta una nuova versione del gioco.', 'Aggiorna', () => location.reload());
    });
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (androidApp) void checkApkUpdate(notify);

  const card = document.getElementById('install-card');
  const button = document.getElementById('install-button') as HTMLButtonElement | null;
  const quick = document.getElementById('install-quick') as HTMLButtonElement | null;
  const status = document.getElementById('install-status');
  if (!card || !button || !status) return;

  let deferred: InstallPromptEvent | null = null;
  let installed = false;

  const state = (): InstallState => {
    if (androidApp) return 'android';
    if (runningAsApp()) return 'app';
    if (installed) return 'installed';
    if (deferred) return 'ready';
    if (!window.isSecureContext) return 'insecure';
    if (!production) return 'development';
    return 'manual';
  };

  const render = () => {
    const current = state();
    status.textContent = installMessage(current, platform());
    button.hidden = current !== 'ready';
    if (quick) quick.hidden = current !== 'ready';
    card.dataset.state = current;
  };

  const install = async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') installed = true;
    render();
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    render();
  });
  button.addEventListener('click', () => void install());
  quick?.addEventListener('click', () => void install());
  render();
  if (!androidApp) void offerApk();
}

/** Sul sito: link per scaricare l'APK, solo se il file c'è davvero (lo mette la build Android). */
async function offerApk(): Promise<void> {
  const link = document.getElementById('apk-link');
  if (!link) return;
  try {
    const response = await fetch(APK_PATH, { method: 'HEAD', cache: 'no-cache' });
    link.hidden = !response.ok;
  } catch {
    link.hidden = true;
  }
}

/**
 * App Android: il sito pubblica version.json con l'ultima versione; se è più nuova di questa app,
 * si avvisa con il link all'APK nuovo (si apre nel browser, che lo scarica).
 */
async function checkApkUpdate(notify: UpdateNotifier): Promise<void> {
  const site = (import.meta.env.VITE_UPDATE_URL as string | undefined) ?? '';
  if (!site) return;
  try {
    const response = await fetch(new URL('version.json', site), { cache: 'no-store' });
    if (!response.ok) return;
    const info = (await response.json()) as { version?: unknown; title?: unknown; apk?: unknown };
    if (typeof info.version !== 'string' || typeof info.apk !== 'string') return;
    if (compareVersions(info.version, __APP_VERSION__) <= 0) return;
    const title = typeof info.title === 'string' && info.title ? `: ${info.title}` : '';
    const apk = new URL(info.apk, site).href;
    notify(`È uscita la versione ${info.version}${title}.`, 'Scarica', () => {
      location.href = apk;
    });
  } catch {
    // Senza rete o sito irraggiungibile: niente avviso.
  }
}

/** Dove la build del sito mette l'APK (vedi client/vite.config.ts). */
export const APK_PATH = './download/blockstrike.apk';
