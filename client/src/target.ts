/**
 * Dove gira il client: sito servito dal server di gioco (predefinito), app Android con il gioco
 * dentro (VITE_TARGET=android) o sito statico come GitHub Pages (VITE_TARGET=pages).
 */
export const ANDROID_APP = import.meta.env.VITE_TARGET === 'android';
export const STATIC_SITE = import.meta.env.VITE_TARGET === 'pages';

/** La pagina non è il server di gioco: l'indirizzo viene dalla build o dal campo Server del menu. */
export const SEPARATE_SERVER = ANDROID_APP || STATIC_SITE;
