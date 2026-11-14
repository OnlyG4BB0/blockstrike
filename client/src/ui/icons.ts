/**
 * Icone dell'interfaccia, disegnate in SVG: non dipendono dai font del dispositivo (i simboli di
 * testo cambiano aspetto, o mancano, da un telefono all'altro) e si ridimensionano con chi le contiene.
 * Tratto e riempimento usano `currentColor`.
 */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const FILL = 'fill="currentColor" stroke="none"';

const PATHS = {
  // Comandi di gioco.
  fire: `<path ${FILL} d="M22 12l-5.84 1.72 2.91 5.35-5.35-2.91L12 22l-1.72-5.84-5.35 2.91 2.91-5.35L2 12l5.84-1.72-2.91-5.35 5.35 2.91L12 2l1.72 5.84 5.35-2.91-2.91 5.350z"/><circle cx="12" cy="12" r="2.4" fill="rgba(0,0,0,0.35)"/>`,
  aim: `<g ${STROKE}><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/></g>`,
  jump: `<g ${STROKE}><path d="M5 13l7-7 7 7"/><path d="M5 19.5l7-7 7 7"/></g>`,
  crouch: `<g ${STROKE}><path d="M5 5l7 7 7-7"/><path d="M5 12l7 7 7-7"/></g>`,
  reload: `<g ${STROKE}><path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M20 3.5v4.6h-4.6"/></g>`,
  grenade: `<g ${STROKE}><circle cx="11.5" cy="14.5" r="6.3"/><path d="M9.5 8.2V5.4h4v2.8M13.5 5.4h3.4l1.6 2.8"/></g>`,
  weapon: `<g ${STROKE}><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></g>`,
  score: `<g ${STROKE}><path d="M5 6.5h14M5 12h14M5 17.5h9"/></g>`,
  pause: `<g ${FILL}><rect x="6" y="5" width="4.2" height="14" rx="1"/><rect x="13.8" y="5" width="4.2" height="14" rx="1"/></g>`,
  chat: `<g ${STROKE}><path d="M4.5 5.5h15v10.5h-8l-4.5 3.5v-3.5h-2.5z"/></g>`,
  respawn: `<g ${STROKE}><path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7"/><path d="M4 3.5v4.6h4.6"/></g><circle cx="12" cy="12" r="1.8" ${FILL}/>`,
  // HUD.
  health: `<path ${FILL} d="M9.3 3.5h5.4v5.8h5.8v5.4h-5.8v5.8H9.3v-5.8H3.5V9.3h5.8z"/>`,
  ammo: `<g ${FILL}><path d="M5.2 9.2c0-2.6.9-4.6 1.8-5.7.9 1.1 1.8 3.1 1.8 5.7v8.3H5.2zM10.2 9.2c0-2.6.9-4.6 1.8-5.7.9 1.1 1.8 3.1 1.8 5.7v8.3h-3.6zM15.2 9.2c0-2.6.9-4.6 1.8-5.7.9 1.1 1.8 3.1 1.8 5.7v8.3h-3.6z"/><rect x="4.6" y="18.6" width="14.8" height="2" rx=".6"/></g>`,
  skull: `<path ${FILL} d="M12 3c-4.6 0-8 3.2-8 7.6 0 2.5 1.1 4.5 2.9 5.8V19c0 .9.7 1.6 1.6 1.6h1v-2h1.5v2h2v-2h1.5v2h1c.9 0 1.6-.7 1.6-1.6v-2.6c1.8-1.3 2.9-3.3 2.9-5.8C20 6.2 16.6 3 12 3zM8.6 13.6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6.8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>`,
  shield: `<path ${STROKE} d="M12 3.2l7.3 2.6v5.6c0 4.4-2.9 7.7-7.3 9.4-4.4-1.7-7.3-5-7.3-9.4V5.8z"/>`,
  // Menu.
  online: `<g ${STROKE}><circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c2.8 2.5 4 5.3 4 8.6s-1.2 6.1-4 8.6c-2.8-2.5-4-5.3-4-8.6s1.2-6.1 4-8.6z"/></g>`,
  character: `<g ${FILL}><rect x="8.2" y="2.8" width="7.6" height="7.2" rx="1"/><path d="M5 12.4h14v8.4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/></g>`,
  settings: `<g ${STROKE}><circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/></g>`,
  controls: `<g ${STROKE}><path d="M7.5 7.5h9a5 5 0 0 1 4.9 4l.6 3.3a2.6 2.6 0 0 1-4.6 2l-1.6-2H8.200l-1.600 2a2.600 2.600 0 0 1-4.600-2l.600-3.300a5 5 0 0 1 4.900-4z"/><path d="M7.200 10.400v3.200M5.600 12h3.200"/></g><circle cx="16.200" cy="12" r="1.300" ${FILL}/>`,
  news: `<path ${FILL} d="M12 2.5l2.300 6.200 6.200 2.300-6.200 2.300L12 19.500l-2.300-6.200-6.200-2.300 6.200-2.300z"/><path ${FILL} d="M19 16.500l.800 2.200 2.200.800-2.200.800-.800 2.200-.800-2.200-2.200-.800 2.200-.800z"/>`,
  install: `<g ${STROKE}><path d="M12 3.500v11M7.500 10.500l4.500 4.500 4.500-4.500M4.500 19.500h15"/></g>`,
  map: `<g ${STROKE}><path d="M3.500 6l5.500-2 6 2 5.500-2v14l-5.500 2-6-2-5.500 2zM9 4v14M15 6v14"/></g>`,
  play: `<path ${FILL} d="M7 4.200v15.600a.800.800 0 0 0 1.200.700l12.600-7.800a.800.800 0 0 0 0-1.400L8.200 3.500a.800.800 0 0 0-1.200.700z"/>`,
  // Modalità.
  ffa: `<g ${STROKE}><circle cx="12" cy="12" r="6.500"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></g>`,
  tdm: `<g ${STROKE}><path d="M4 4l9 9M13 4l-9 9M14.500 14.500l5.500 5.500M11 20l9-9"/></g>`,
  ctf: `<g ${STROKE}><path d="M6 21V3.500"/><path d="M6 4.500h11.500l-2.500 4 2.500 4H6" fill="currentColor"/></g>`,
} as const;

export type IconName = keyof typeof PATHS;

/** SVG dell'icona, da inserire come HTML. */
export function icon(name: IconName): string {
  return `<svg class="icon icon-${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Riempie gli elementi `<i data-icon="nome">` della pagina con la loro icona. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = element.dataset.icon as IconName;
    if (name in PATHS) element.innerHTML = icon(name);
  }
}
