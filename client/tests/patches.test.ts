import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, parsePatches, unseenPatches } from '../src/ui/patches.ts';

const file = JSON.parse(readFileSync(new URL('../../content/patches.json', import.meta.url), 'utf8')) as unknown;
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

describe('note delle patch', () => {
  it('confronta le versioni come numeri', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0);
  });

  it('la versione del gioco ha le sue note, ed è la più nuova', () => {
    const patches = parsePatches(file);
    expect(patches.length).toBeGreaterThan(0);
    expect(patches[0]!.version).toBe(pkg.version);
    for (const p of patches) expect(p.notes.length).toBeGreaterThan(0);
  });

  it('mostra solo quello che non si è ancora visto', () => {
    const patches = parsePatches({
      patches: [
        { version: '0.1.0', notes: ['a'] },
        { version: '0.3.0', notes: ['c'] },
        { version: '0.2.0', notes: ['b'] },
        { version: 'rotta', notes: ['x'] },
      ],
    });
    expect(patches.map((p) => p.version)).toEqual(['0.3.0', '0.2.0', '0.1.0']);
    expect(unseenPatches(patches, '0.1.0').map((p) => p.version)).toEqual(['0.3.0', '0.2.0']);
    expect(unseenPatches(patches, '0.3.0')).toEqual([]);
    expect(unseenPatches(patches, '').map((p) => p.version)).toEqual(['0.3.0']);
  });
});
