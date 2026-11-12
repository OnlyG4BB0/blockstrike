/**
 * Contenuti del gioco: Vite include nel pacchetto tutti i file JSON delle cartelle di /content.
 * Basta aggiungere un file (per esempio content/weapons/nuova.json) perché compaia nel gioco;
 * in sviluppo Vite ricarica la pagina da solo.
 */
import { loadContent, type ContentFile, type GameContent } from '@blockstrike/shared';

/** Suoni che il client usa direttamente: devono esistere in content/sounds. */
export const REQUIRED_SOUNDS = ['hit', 'headshot', 'kill', 'hurt', 'step', 'land', 'dry_fire'] as const;

const weapons = import.meta.glob('../../content/weapons/*.json', { eager: true, import: 'default' });
const equipment = import.meta.glob('../../content/equipment/*.json', { eager: true, import: 'default' });
const models = import.meta.glob('../../content/weapon-models/*.json', { eager: true, import: 'default' });
const skins = import.meta.glob('../../content/skins/*.json', { eager: true, import: 'default' });
const sounds = import.meta.glob('../../content/sounds/*.json', { eager: true, import: 'default' });

function files(modules: Record<string, unknown>): ContentFile[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, data]) => ({ path: path.replace(/^(\.\.\/)+/, ''), data }));
}

/** Controlla e collega tutti i contenuti; in caso di problemi lancia ContentError con l'elenco. */
export function loadGameContent(): GameContent {
  return loadContent(
    {
      weapons: files(weapons),
      equipment: files(equipment),
      models: files(models),
      skins: files(skins),
      sounds: files(sounds),
    },
    { requiredSounds: REQUIRED_SOUNDS },
  );
}
