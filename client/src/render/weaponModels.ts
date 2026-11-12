/**
 * Modelli delle armi costruiti dai file in /content/weapon-models. Le parti con un ruolo
 * (caricatore, carrello, pompa, otturatore, tamburo) diventano mesh separate da animare;
 * le skin cambiano il colore delle parti per nome.
 */
import { BufferGeometry, MathUtils, Vector3 } from 'three';
import type { GameContent, ModelPart, PartRole, SkinDef, WeaponModelDef } from '@blockstrike/shared';
import { BoxModelBuilder } from './boxModel.ts';

export interface AnimatedPart {
  geometry: BufferGeometry;
  /** Centro delle parti con questo ruolo: le animazioni ruotano e spostano attorno a qui. */
  pivot: Vector3;
}

export interface WeaponParts {
  def: WeaponModelDef;
  /** Parti fisse, fuse in una geometria. */
  body: BufferGeometry;
  animated: Map<PartRole, AnimatedPart>;
}

function addPart(builder: BoxModelBuilder, part: ModelPart, color: string, offset: Vector3 | null): void {
  const [x, y, z] = part.pos;
  const [w, h, d] = part.size;
  const [rx, ry, rz] = part.rotation;
  builder.box(
    x - (offset?.x ?? 0),
    y - (offset?.y ?? 0),
    z - (offset?.z ?? 0),
    w,
    h,
    d,
    color,
    MathUtils.degToRad(rx),
    MathUtils.degToRad(ry),
    MathUtils.degToRad(rz),
  );
}

/** Colore di una parte, con la skin se ne cambia il nome. */
function colorOf(part: ModelPart, skin: SkinDef | null): string {
  return skin?.colors[part.name] ?? part.color;
}

export class ModelLibrary {
  private readonly content: GameContent;
  private readonly merged = new Map<string, BufferGeometry>();
  private readonly split = new Map<string, WeaponParts>();

  constructor(content: GameContent) {
    this.content = content;
  }

  model(id: string): WeaponModelDef {
    const def = this.content.models.get(id);
    if (!def) throw new Error(`Modello ${id} mancante`);
    return def;
  }

  skin(id: string | null | undefined): SkinDef | null {
    if (!id) return null;
    return this.content.skins.find((s) => s.id === id) ?? null;
  }

  skinsFor(weaponId: string): SkinDef[] {
    return this.content.skins.filter((s) => s.weapon === weaponId);
  }

  /** Tutto il modello in una geometria (armi in mano ai bot, proiettili). */
  mergedGeometry(modelId: string, skinId: string | null = null): BufferGeometry {
    const key = `${modelId}:${skinId ?? ''}`;
    let geometry = this.merged.get(key);
    if (!geometry) {
      const def = this.model(modelId);
      const skin = this.skin(skinId);
      const builder = new BoxModelBuilder();
      for (const part of def.parts) addPart(builder, part, colorOf(part, skin), null);
      geometry = builder.build();
      this.merged.set(key, geometry);
    }
    return geometry;
  }

  /** Modello diviso in parte fissa e parti animate (arma in prima persona). */
  parts(modelId: string, skinId: string | null = null): WeaponParts {
    const key = `${modelId}:${skinId ?? ''}`;
    let parts = this.split.get(key);
    if (!parts) {
      const def = this.model(modelId);
      const skin = this.skin(skinId);
      const body = new BoxModelBuilder();
      const groups = new Map<PartRole, ModelPart[]>();
      for (const part of def.parts) {
        if (!part.role) {
          addPart(body, part, colorOf(part, skin), null);
          continue;
        }
        const list = groups.get(part.role) ?? [];
        list.push(part);
        groups.set(part.role, list);
      }
      const animated = new Map<PartRole, AnimatedPart>();
      for (const [role, list] of groups) {
        const min = new Vector3(Infinity, Infinity, Infinity);
        const max = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const part of list) {
          min.min(new Vector3(part.pos[0] - part.size[0] / 2, part.pos[1] - part.size[1] / 2, part.pos[2] - part.size[2] / 2));
          max.max(new Vector3(part.pos[0] + part.size[0] / 2, part.pos[1] + part.size[1] / 2, part.pos[2] + part.size[2] / 2));
        }
        const pivot = min.add(max).multiplyScalar(0.5);
        const builder = new BoxModelBuilder();
        for (const part of list) addPart(builder, part, colorOf(part, skin), pivot);
        animated.set(role, { geometry: builder.build(), pivot });
      }
      parts = { def, body: body.build(), animated };
      this.split.set(key, parts);
    }
    return parts;
  }
}
