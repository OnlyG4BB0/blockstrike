/** Restituisce l'elemento con l'id indicato o segnala chiaramente che manca in index.html. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} mancante in index.html`);
  return element as T;
}
