import { Color, Group, Mesh, MeshLambertMaterial, Vector3, type BufferGeometry } from 'three';
import { BODY_STANDING, type Combatant, type WeaponModelDef } from '@blockstrike/shared';
import { CHARACTERS } from '../config.ts';
import { BoxModelBuilder } from './boxModel.ts';

/** Aspetto dell'arma in mano: modello (mani, bocca) e geometria già colorata con la skin. */
export type WeaponLook = (weaponIndex: number) => { def: WeaponModelDef; geometry: BufferGeometry };

export interface CharacterColors {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
}

export function colorsFor(index: number): CharacterColors {
  return {
    shirt: CHARACTERS.shirts[index % CHARACTERS.shirts.length]!,
    pants: CHARACTERS.pants[index % CHARACTERS.pants.length]!,
    skin: CHARACTERS.skins[(index * 3) % CHARACTERS.skins.length]!,
    hair: CHARACTERS.hair[(index * 2) % CHARACTERS.hair.length]!,
  };
}

const part = (name: string) => BODY_STANDING.find((p) => p.name === name)!;
const HEAD = part('head');
const TORSO = part('torso');
const ARM = part('armRight');
const LEG = part('legRight');
const HIP_Y = LEG.max[1];
const SHOULDER_Y = TORSO.max[1];
const CROUCH_TORSO = 0.46;
/** Spalle e arma nello spazio della mira (origine poco sotto le spalle). */
const SHOULDER_X = (ARM.min[0] + ARM.max[0]) / 2;
const SHOULDER_JOINT_Y = 0.02;
const WEAPON_POSITION = [0.1, -0.05, -0.2] as const;

function size(min: readonly number[], max: readonly number[], axis: number): number {
  return max[axis]! - min[axis]!;
}

/**
 * Personaggio a blocchi di un altro combattente, con le stesse misure delle hitbox.
 * Animazioni semplici (camminata, accovacciamento, mira in alto e in basso, caduta da morto):
 * quelle complete arrivano nella Fase 4.
 */
export class CharacterView {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly upper = new Group();
  private readonly torsoPivot = new Group();
  private readonly shoulders = new Group();
  private readonly headPivot = new Group();
  private readonly aim = new Group();
  private readonly legLeft = new Group();
  private readonly legRight = new Group();
  private readonly weaponMesh: Mesh;
  private readonly arms: Mesh;
  private readonly colors: CharacterColors;
  private readonly material: MeshLambertMaterial;
  private readonly weaponLook: WeaponLook;
  private weaponIndex = -1;
  private walkPhase = 0;
  private crouch = 0;
  private hurt = 0;
  private deadTime = -1;
  private readonly temp = new Vector3();

  constructor(colors: CharacterColors, weaponLook: WeaponLook) {
    this.weaponLook = weaponLook;
    this.material = new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0, 0, 0) });
    const mesh = (builder: BoxModelBuilder): Mesh => {
      const m = new Mesh(builder.build(), this.material);
      m.castShadow = true;
      return m;
    };

    // Gambe: perno all'anca.
    for (const [leg, x] of [
      [this.legLeft, -0.12],
      [this.legRight, 0.12],
    ] as const) {
      leg.position.set(x, HIP_Y, 0);
      const h = HIP_Y;
      leg.add(
        mesh(
          new BoxModelBuilder()
            .box(0, -h / 2, 0, size(LEG.min, LEG.max, 0), h, size(LEG.min, LEG.max, 2), colors.pants)
            .box(0, -h + 0.05, -0.03, 0.24, 0.1, 0.3, '#2a2420'),
        ),
      );
      this.body.add(leg);
    }

    // Busto: perno in basso, si accorcia accovacciandosi.
    const torsoHeight = size(TORSO.min, TORSO.max, 1);
    this.torsoPivot.position.y = HIP_Y;
    this.torsoPivot.add(
      mesh(
        new BoxModelBuilder()
          .box(0, torsoHeight / 2, 0, size(TORSO.min, TORSO.max, 0), torsoHeight, size(TORSO.min, TORSO.max, 2), colors.shirt)
          .box(0, 0.03, 0, 0.52, 0.06, 0.3, '#2a2420'),
      ),
    );
    this.upper.add(this.torsoPivot);

    // Spalle: testa e braccia.
    this.shoulders.position.y = SHOULDER_Y;
    const headSize = size(HEAD.min, HEAD.max, 0);
    this.headPivot.add(
      mesh(
        new BoxModelBuilder()
          .box(0, headSize / 2, 0, headSize, headSize, headSize, colors.skin)
          .box(0, headSize + 0.03, 0.01, headSize + 0.02, 0.07, headSize + 0.02, colors.hair)
          .box(0, headSize * 0.62, 0.11, headSize + 0.02, headSize * 0.5, 0.14, colors.hair)
          .box(-0.075, headSize * 0.55, -headSize / 2 - 0.005, 0.06, 0.05, 0.02, '#1b1b1b')
          .box(0.075, headSize * 0.55, -headSize / 2 - 0.005, 0.06, 0.05, 0.02, '#1b1b1b'),
      ),
    );
    this.shoulders.add(this.headPivot);

    // Braccia e arma insieme: seguono la mira in alto e in basso.
    this.colors = colors;
    this.aim.position.y = -0.08;
    this.arms = new Mesh(undefined, this.material);
    this.arms.castShadow = true;
    this.aim.add(this.arms);
    this.weaponMesh = new Mesh(undefined, this.material);
    this.weaponMesh.castShadow = true;
    this.weaponMesh.position.set(WEAPON_POSITION[0], WEAPON_POSITION[1], WEAPON_POSITION[2]);
    this.aim.add(this.weaponMesh);
    this.shoulders.add(this.aim);
    this.upper.add(this.shoulders);

    this.body.add(this.upper);
    this.root.add(this.body);
  }

  /** Cambia l'arma in mano e ricostruisce le braccia perché le mani arrivino all'impugnatura. */
  setWeapon(index: number): void {
    if (index === this.weaponIndex) return;
    this.weaponIndex = index;
    const look = this.weaponLook(index);
    this.weaponMesh.geometry = look.geometry;
    const [wx, wy, wz] = WEAPON_POSITION;
    const [rx, ry, rz] = look.def.hands.right;
    const [lx, ly, lz] = look.def.hands.left;
    const thickness = size(ARM.min, ARM.max, 0);
    const geometry = new BoxModelBuilder()
      .between(SHOULDER_X, SHOULDER_JOINT_Y, 0, wx + rx + 0.02, wy + ry, wz + rz, thickness, this.colors.shirt)
      .box(wx + rx, wy + ry, wz + rz, 0.13, 0.13, 0.12, this.colors.skin)
      .between(-SHOULDER_X, SHOULDER_JOINT_Y, 0, wx + lx - 0.02, wy + ly - 0.02, wz + lz, thickness, this.colors.shirt)
      .box(wx + lx, wy + ly - 0.02, wz + lz, 0.12, 0.12, 0.12, this.colors.skin)
      .build();
    this.arms.geometry.dispose();
    this.arms.geometry = geometry;
  }

  onHurt(): void {
    this.hurt = 1;
  }

  /** Posizione interpolata dei piedi e stato del combattente. */
  update(dt: number, c: Combatant, x: number, y: number, z: number, speed: number): void {
    const p = c.player;
    this.setWeapon(c.weapon.current);
    this.root.position.set(x, y, z);
    this.root.rotation.y = p.yaw;

    if (!c.alive) {
      if (this.deadTime < 0) this.deadTime = 0;
      this.deadTime += dt;
      const fall = Math.min(1, this.deadTime / CHARACTERS.deathFallTime);
      this.body.rotation.x = (fall * fall * Math.PI) / 2;
      const sink = Math.max(0, this.deadTime - CHARACTERS.deathSinkDelay) / CHARACTERS.deathSinkTime;
      this.body.position.y = -Math.min(1, sink) * 0.5;
      this.root.visible = sink < 1;
      return;
    }
    this.deadTime = -1;
    this.root.visible = true;
    this.body.rotation.x = 0;
    this.body.position.y = 0;

    // Accovacciarsi: il busto si accorcia e le spalle scendono come le hitbox.
    this.crouch += ((p.crouched ? 1 : 0) - this.crouch) * Math.min(1, dt * 14);
    const torsoHeight = SHOULDER_Y - HIP_Y;
    const legScale = 1 - (1 - 0.4 / HIP_Y) * this.crouch;
    this.legLeft.scale.y = legScale;
    this.legRight.scale.y = legScale;
    this.legLeft.position.y = HIP_Y * legScale;
    this.legRight.position.y = HIP_Y * legScale;
    this.torsoPivot.position.y = HIP_Y * legScale;
    this.torsoPivot.scale.y = 1 - (1 - CROUCH_TORSO / torsoHeight) * this.crouch;
    this.shoulders.position.y = HIP_Y * legScale + torsoHeight * this.torsoPivot.scale.y;

    // Camminata.
    const moving = p.grounded ? Math.min(1, speed / 7.5) : 0;
    this.walkPhase += dt * (3 + speed * 1.3);
    const swing = Math.sin(this.walkPhase) * 0.7 * moving;
    const airPose = p.grounded ? 0 : 0.35;
    this.legLeft.rotation.x = swing - airPose;
    this.legRight.rotation.x = -swing + airPose * 0.5;

    // Mira in alto e in basso: testa e braccia.
    this.headPivot.rotation.x = p.pitch * 0.7;
    this.aim.rotation.x = p.pitch;

    this.hurt = Math.max(0, this.hurt - dt * 6);
    this.material.emissive.setRGB(this.hurt * 0.7, this.hurt * 0.15, this.hurt * 0.15);
  }

  /** Posizione nel mondo della bocca dell'arma. */
  muzzleWorld(out: Vector3): Vector3 {
    const [x, y, z] = this.weaponLook(Math.max(0, this.weaponIndex)).def.muzzle;
    this.weaponMesh.updateWorldMatrix(true, false);
    return out.set(x, y, z).applyMatrix4(this.weaponMesh.matrixWorld);
  }

  /** Punto sopra la testa, per nome e barra della vita. */
  labelPoint(out: Vector3): Vector3 {
    this.temp.set(0, this.shoulders.position.y + 0.62, 0);
    return out.copy(this.temp).applyMatrix4(this.root.matrixWorld);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.material.dispose();
  }
}
