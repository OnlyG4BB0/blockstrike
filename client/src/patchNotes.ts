/** Note delle patch del gioco (content/patches.json), dalla versione più nuova. */
import { parsePatches, type PatchNote } from './ui/patches.ts';

const files = import.meta.glob('../../content/patches.json', { eager: true, import: 'default' });

export const PATCHES: readonly PatchNote[] = parsePatches(Object.values(files)[0]);
