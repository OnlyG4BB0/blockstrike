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

export type InstallState = 'app' | 'installed' | 'ready' | 'insecure' | 'development' | 'manual';

/** Cosa dire per ogni situazione (funzione pura). */
export function installMessage(state: InstallState, platform: 'android' | 'ios' | 'desktop'): string {
  switch (state) {
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
export function setupInstall(production: boolean): void {
  if (production && window.isSecureContext && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const card = document.getElementById('install-card');
  const button = document.getElementById('install-button') as HTMLButtonElement | null;
  const quick = document.getElementById('install-quick') as HTMLButtonElement | null;
  const status = document.getElementById('install-status');
  if (!card || !button || !status) return;

  let deferred: InstallPromptEvent | null = null;
  let installed = false;

  const state = (): InstallState => {
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
}
