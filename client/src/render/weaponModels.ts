/**
 * Modelli a blocchi delle armi, costruiti in codice. Nella Fase 3 verranno descritti nei file
 * delle armi; qui servono a vedere l'arma, la fiammata e l'espulsione dei bossoli.
 * Coordinate del modello: canna verso -z, origine all'impugnatura, metri.
 */
import { BufferGeometry, Vector3 } from 'three';
import { WEAPONS } from '@blockstrike/shared';
import { BoxModelBuilder } from './boxModel.ts';

export interface WeaponModel {
  geometry: BufferGeometry;
  /** Bocca della canna. */
  muzzle: Vector3;
  /** Finestra di espulsione dei bossoli (null se l'arma non ne espelle). */
  eject: Vector3 | null;
  /** Quota della linea di mira: in mira viene portata al centro dello schermo. */
  sightY: number;
  /** Distanza della linea di mira dall'occhio quando si mira. */
  adsDistance: number;
  rightHand: Vector3;
  leftHand: Vector3;
}

const DARK = '#2a2e35';
const MID = '#3f4550';
const LIGHT = '#59606b';

type Recipe = (b: BoxModelBuilder) => Omit<WeaponModel, 'geometry'>;

const RECIPES: Record<string, Recipe> = {
  assault_rifle: (b) => {
    const accent = '#d08a2e';
    b.box(0, 0.04, -0.12, 0.07, 0.11, 0.42, DARK)
      .box(0, 0.07, -0.47, 0.035, 0.035, 0.32, MID)
      .box(0, 0.05, -0.36, 0.08, 0.085, 0.2, accent)
      .box(0, -0.08, -0.17, 0.05, 0.17, 0.08, DARK, 0.2)
      .box(0, 0.0, 0.18, 0.06, 0.1, 0.22, MID)
      .box(0, -0.06, 0.01, 0.045, 0.12, 0.06, DARK, -0.25)
      // Mirino a punto rosso: una cornice vuota con il punto al centro.
      .box(0, 0.1, -0.1, 0.05, 0.012, 0.08, DARK)
      .box(-0.022, 0.135, -0.1, 0.006, 0.058, 0.08, DARK)
      .box(0.022, 0.135, -0.1, 0.006, 0.058, 0.08, DARK)
      .box(0, 0.166, -0.1, 0.05, 0.006, 0.08, DARK)
      .box(0, 0.135, -0.138, 0.005, 0.005, 0.002, '#ff2a2a');
    return {
      muzzle: new Vector3(0, 0.07, -0.64),
      eject: new Vector3(0.04, 0.07, -0.1),
      sightY: 0.135,
      adsDistance: 0.28,
      rightHand: new Vector3(0, -0.06, 0.02),
      leftHand: new Vector3(0, 0.02, -0.38),
    };
  },
  sniper: (b) => {
    const accent = '#5e7d3c';
    b.box(0, 0.04, -0.1, 0.07, 0.1, 0.4, DARK)
      .box(0, 0.06, -0.62, 0.035, 0.035, 0.66, MID)
      .box(0, 0.15, -0.12, 0.06, 0.06, 0.34, DARK)
      .box(0, 0.15, -0.3, 0.075, 0.075, 0.04, LIGHT)
      .box(0, 0.15, 0.06, 0.07, 0.07, 0.04, LIGHT)
      .box(0, 0.0, 0.25, 0.07, 0.12, 0.3, accent)
      .box(0, -0.06, -0.08, 0.05, 0.08, 0.08, DARK)
      .box(0, -0.06, 0.05, 0.045, 0.12, 0.06, accent, -0.25)
      .box(0.05, 0.06, -0.02, 0.05, 0.015, 0.015, LIGHT);
    return {
      muzzle: new Vector3(0, 0.06, -0.96),
      eject: new Vector3(0.04, 0.06, -0.08),
      sightY: 0.15,
      adsDistance: 0.2,
      rightHand: new Vector3(0, -0.06, 0.06),
      leftHand: new Vector3(0, 0.02, -0.34),
    };
  },
  shotgun: (b) => {
    const wood = '#8a4f2c';
    b.box(0, 0.04, -0.08, 0.075, 0.1, 0.3, DARK)
      .box(0, 0.08, -0.45, 0.05, 0.05, 0.56, MID)
      .box(0, 0.03, -0.42, 0.04, 0.04, 0.44, DARK)
      .box(0, 0.03, -0.36, 0.075, 0.07, 0.2, wood)
      .box(0, 0.0, 0.2, 0.07, 0.12, 0.28, wood)
      .box(0, -0.06, 0.03, 0.045, 0.12, 0.06, DARK, -0.25)
      .box(0, 0.115, -0.7, 0.015, 0.02, 0.02, LIGHT);
    return {
      muzzle: new Vector3(0, 0.08, -0.74),
      eject: new Vector3(0.045, 0.06, -0.06),
      sightY: 0.12,
      adsDistance: 0.34,
      rightHand: new Vector3(0, -0.06, 0.04),
      leftHand: new Vector3(0, 0.0, -0.36),
    };
  },
  pistol: (b) => {
    const accent = '#d9a441';
    b.box(0, 0.06, -0.08, 0.04, 0.05, 0.21, DARK)
      .box(0, 0.025, -0.06, 0.038, 0.03, 0.16, MID)
      .box(0, -0.045, 0.0, 0.037, 0.12, 0.055, accent, -0.2)
      .box(0, 0.09, -0.17, 0.008, 0.015, 0.01, LIGHT)
      .box(0, 0.09, 0.0, 0.025, 0.015, 0.01, LIGHT);
    return {
      muzzle: new Vector3(0, 0.06, -0.19),
      eject: new Vector3(0.03, 0.07, -0.06),
      sightY: 0.095,
      adsDistance: 0.38,
      rightHand: new Vector3(0, -0.05, 0.01),
      leftHand: new Vector3(-0.03, -0.05, 0.0),
    };
  },
  rocket_launcher: (b) => {
    const olive = '#5a6b3c';
    b.box(0, 0.08, -0.15, 0.13, 0.13, 0.95, olive)
      .box(0, 0.08, -0.62, 0.155, 0.155, 0.06, DARK)
      .box(0, 0.08, 0.33, 0.155, 0.155, 0.06, DARK)
      .box(0, 0.08, -0.66, 0.08, 0.08, 0.06, '#c23b2e')
      .box(0, -0.05, -0.05, 0.045, 0.12, 0.06, DARK, -0.2)
      .box(0, -0.03, -0.32, 0.04, 0.1, 0.05, DARK)
      .box(0.085, 0.17, -0.22, 0.03, 0.07, 0.07, MID);
    return {
      muzzle: new Vector3(0, 0.08, -0.7),
      eject: null,
      sightY: 0.2,
      adsDistance: 0.45,
      rightHand: new Vector3(0, -0.05, -0.04),
      leftHand: new Vector3(0, -0.03, -0.32),
    };
  },
};

let cache: WeaponModel[] | null = null;

/** Un modello per ogni arma, negli stessi indici di WEAPONS. */
export function getWeaponModels(): WeaponModel[] {
  if (cache) return cache;
  cache = WEAPONS.map((def) => {
    const recipe = RECIPES[def.id] ?? RECIPES.assault_rifle!;
    const builder = new BoxModelBuilder();
    const parts = recipe(builder);
    return { geometry: builder.build(), ...parts };
  });
  return cache;
}

/** Granata a mano (per i proiettili in volo). */
export function createGrenadeGeometry(): BufferGeometry {
  return new BoxModelBuilder()
    .box(0, 0, 0, 0.12, 0.14, 0.12, '#4b5d33')
    .box(0, 0.085, 0, 0.05, 0.03, 0.05, '#2a2e35')
    .box(0.035, 0.08, 0, 0.02, 0.02, 0.07, '#b9b2a2')
    .build();
}

/** Razzo in volo: punta verso -z. */
export function createRocketGeometry(): BufferGeometry {
  return new BoxModelBuilder()
    .box(0, 0, 0, 0.09, 0.09, 0.42, '#5a6b3c')
    .box(0, 0, -0.24, 0.065, 0.065, 0.08, '#c23b2e')
    .box(0, 0, 0.2, 0.16, 0.02, 0.06, '#2a2e35')
    .box(0, 0, 0.2, 0.02, 0.16, 0.06, '#2a2e35')
    .build();
}
