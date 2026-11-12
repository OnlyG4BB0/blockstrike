/** Legge i contenuti di gioco da /content in Node. */
import { readFileSync, readdirSync } from 'node:fs';
import { loadContent, type ContentFile, type GameContent } from '@blockstrike/shared';

const CONTENT = new URL('../../content/', import.meta.url);

function readFolder(folder: string): ContentFile[] {
  const dir = new URL(`${folder}/`, CONTENT);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ path: `content/${folder}/${name}`, data: JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as unknown }));
}

export function loadContentFromDisk(): GameContent {
  return loadContent({
    weapons: readFolder('weapons'),
    equipment: readFolder('equipment'),
    models: readFolder('weapon-models'),
    skins: readFolder('skins'),
    sounds: readFolder('sounds'),
  });
}
