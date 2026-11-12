import { readFileSync, readdirSync } from 'node:fs';
import { loadContent, type ContentFile, type ContentSources, type GameContent } from '../src/index.ts';

const CONTENT = new URL('../../content/', import.meta.url);

/** Legge tutti i file JSON di una cartella di /content. */
export function readFolder(folder: string): ContentFile[] {
  const dir = new URL(`${folder}/`, CONTENT);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ path: `content/${folder}/${name}`, data: JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as unknown }));
}

export function readSources(): ContentSources {
  return {
    weapons: readFolder('weapons'),
    equipment: readFolder('equipment'),
    models: readFolder('weapon-models'),
    skins: readFolder('skins'),
    sounds: readFolder('sounds'),
  };
}

let cached: GameContent | null = null;

/** Contenuti reali del gioco, letti dal disco una volta sola. */
export function gameContent(): GameContent {
  cached ??= loadContent(readSources());
  return cached;
}

/** Indice di un'arma nell'elenco ordinato. */
export function weaponIndex(id: string): number {
  const index = gameContent().weapons.findIndex((w) => w.id === id);
  if (index < 0) throw new Error(`Arma ${id} non trovata`);
  return index;
}
