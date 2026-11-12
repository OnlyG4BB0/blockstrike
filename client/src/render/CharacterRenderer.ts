/**
 * Personaggi a blocchi disegnati dalla posa condivisa (shared/src/pose.ts): le sei parti, i
 * dettagli (capelli, occhi, mani, scarpe, cintura) e gli accessori delle skin sono box di un'unica
 * InstancedMesh, così tutti i personaggi costano una chiamata di disegno (più una per l'ombra).
 * L'arma in mano è una mesh per personaggio, posizionata dalla stessa posa.
 */
import {
  BoxGeometry,
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import {
  BODY,
  PART_ARM_LEFT,
  PART_ARM_RIGHT,
  PART_COUNT,
  PART_HEAD,
  PART_LEG_LEFT,
  PART_LEG_RIGHT,
  PART_NAMES,
  PART_STRIDE,
  PART_TORSO,
  POSE_AXIS_X,
  POSE_AXIS_Y,
  POSE_AXIS_Z,
  POSE_CENTER,
  POSE_HALF,
  POSE_PIVOT,
  type BodyPose,
  type CharacterSkinDef,
} from '@blockstrike/shared';
import { CHARACTERS } from '../config.ts';

/** Aspetto di un personaggio: skin e geometria dell'arma in mano (già colorata con la sua skin). */
export interface CharacterLook {
  skin: CharacterSkinDef;
  weaponGeometry: (weaponIndex: number) => BufferGeometry | null;
}

/** Effetti sul personaggio in questo fotogramma. */
export interface CharacterEffects {
  /** Lampo rosso quando viene colpito (da 0 a 1). */
  hurt: number;
  /** Da morto: caduta all'indietro (da 0 a 1) e affondamento nel terreno (m). */
  fall: number;
  sink: number;
}

/** Box per personaggio: sei parti, nove dettagli e gli accessori. */
const DETAIL_BOXES = 9;
const MAX_BOXES_PER_CHARACTER = PART_COUNT + DETAIL_BOXES + 16;

/** Accessorio già pronto: parte e trasformazione locale del box (posizione, rotazione, dimensioni). */
interface PreparedBox {
  part: number;
  local: Matrix4;
  color: Color;
}

interface PreparedLook {
  parts: Color[];
  hair: Color;
  eyes: Color;
  hands: Color;
  feet: Color;
  belt: Color;
  accessories: PreparedBox[];
}

const HURT_COLOR = new Color('#ff2a1a');

export class CharacterRenderer {
  readonly object = new Group();
  /** Mostra le hitbox (le parti della posa) sopra i personaggi vivi. */
  showHitboxes = false;
  private readonly boxes: InstancedMesh;
  private readonly hitboxes: InstancedMesh;
  private readonly weaponMaterial = new MeshLambertMaterial({ vertexColors: true });
  private readonly weapons: Mesh[] = [];
  private readonly prepared = new WeakMap<CharacterSkinDef, PreparedLook>();
  private count = 0;
  private weaponCount = 0;
  private hitboxCount = 0;
  // Oggetti riutilizzati.
  private readonly frame = new Matrix4();
  private readonly box = new Matrix4();
  private readonly extra = new Matrix4();
  private readonly death = new Matrix4();
  private readonly temp = new Matrix4();
  private readonly color = new Color();
  private readonly axis = new Vector3();
  private hasDeath = false;

  constructor(maxCharacters: number) {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshLambertMaterial({ color: 0xffffff });
    this.boxes = new InstancedMesh(geometry, material, maxCharacters * MAX_BOXES_PER_CHARACTER);
    this.boxes.castShadow = true;
    this.boxes.receiveShadow = false;
    // Il volume dell'insieme cambia a ogni fotogramma: niente esclusione automatica fuori schermo.
    this.boxes.frustumCulled = false;
    this.boxes.count = 0;
    this.boxes.setColorAt(0, this.color.set(0xffffff));
    // Hitbox in fil di ferro (dati di debug): coincidono con le parti disegnate.
    this.hitboxes = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({ color: CHARACTERS.hitboxColor, wireframe: true, depthTest: false, transparent: true }),
      maxCharacters * PART_COUNT,
    );
    this.hitboxes.frustumCulled = false;
    this.hitboxes.renderOrder = 10;
    this.hitboxes.count = 0;
    this.object.add(this.boxes, this.hitboxes);
  }

  /** Da chiamare all'inizio di ogni fotogramma, prima di aggiungere i personaggi. */
  begin(): void {
    this.count = 0;
    this.weaponCount = 0;
    this.hitboxCount = 0;
  }

  /** Da chiamare dopo aver aggiunto tutti i personaggi. */
  end(): void {
    this.boxes.count = this.count;
    this.boxes.instanceMatrix.needsUpdate = true;
    if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;
    this.hitboxes.count = this.hitboxCount;
    this.hitboxes.visible = this.hitboxCount > 0;
    this.hitboxes.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.weapons.length; i++) this.weapons[i]!.visible = i < this.weaponCount;
  }

  /** Aggiunge un personaggio nella posa data. */
  add(pose: BodyPose, look: CharacterLook, weapon: number, effects: CharacterEffects): void {
    if (this.count + MAX_BOXES_PER_CHARACTER > this.boxes.instanceMatrix.count) return;
    const prepared = this.prepare(look.skin);
    this.setupDeath(pose, effects);
    const parts = pose.parts;
    const hurt = Math.min(1, effects.hurt) * CHARACTERS.hurtTint;

    // Le sei parti.
    for (let i = 0; i < PART_COUNT; i++) {
      const o = i * PART_STRIDE;
      this.box.set(
        parts[o + POSE_AXIS_X]! * parts[o + POSE_HALF]! * 2,
        parts[o + POSE_AXIS_Y]! * parts[o + POSE_HALF + 1]! * 2,
        parts[o + POSE_AXIS_Z]! * parts[o + POSE_HALF + 2]! * 2,
        parts[o + POSE_CENTER]!,
        parts[o + POSE_AXIS_X + 1]! * parts[o + POSE_HALF]! * 2,
        parts[o + POSE_AXIS_Y + 1]! * parts[o + POSE_HALF + 1]! * 2,
        parts[o + POSE_AXIS_Z + 1]! * parts[o + POSE_HALF + 2]! * 2,
        parts[o + POSE_CENTER + 1]!,
        parts[o + POSE_AXIS_X + 2]! * parts[o + POSE_HALF]! * 2,
        parts[o + POSE_AXIS_Y + 2]! * parts[o + POSE_HALF + 1]! * 2,
        parts[o + POSE_AXIS_Z + 2]! * parts[o + POSE_HALF + 2]! * 2,
        parts[o + POSE_CENTER + 2]!,
        0,
        0,
        0,
        1,
      );
      this.push(this.box, prepared.parts[i]!, hurt);
      if (this.showHitboxes && !this.hasDeath) this.hitboxes.setMatrixAt(this.hitboxCount++, this.box);
    }

    // Dettagli, nello spazio delle parti (origine nel giunto).
    const head = BODY.headHalf * 2;
    this.detail(pose, PART_HEAD, 0, head + 0.03, 0.01, head + 0.02, 0.07, head + 0.02, prepared.hair, hurt);
    this.detail(pose, PART_HEAD, 0, head * 0.62, 0.11, head + 0.02, head * 0.5, 0.14, prepared.hair, hurt);
    this.detail(pose, PART_HEAD, -0.075, head * 0.55, -head / 2 - 0.005, 0.06, 0.05, 0.02, prepared.eyes, hurt);
    this.detail(pose, PART_HEAD, 0.075, head * 0.55, -head / 2 - 0.005, 0.06, 0.05, 0.02, prepared.eyes, hurt);
    this.detail(pose, PART_TORSO, 0, 0.03, 0, BODY.torsoHalfWidth * 2 + 0.02, 0.06, BODY.torsoHalfDepth * 2 + 0.02, prepared.belt, hurt);
    for (const arm of [PART_ARM_LEFT, PART_ARM_RIGHT]) {
      const length = parts[arm * PART_STRIDE + POSE_HALF + 1]! * 2;
      this.detail(pose, arm, 0, -length, 0, 0.13, 0.13, 0.12, prepared.hands, hurt);
    }
    for (const leg of [PART_LEG_LEFT, PART_LEG_RIGHT]) {
      const o = leg * PART_STRIDE;
      const length = parts[o + POSE_HALF + 1]! * 2;
      const depth = parts[o + POSE_HALF + 2]! * 2;
      this.detail(pose, leg, 0, -length + 0.05, -0.03, 0.24, 0.1, Math.max(0.3, depth), prepared.feet, hurt);
    }

    // Accessori della skin.
    for (const accessory of prepared.accessories) {
      this.partFrame(pose, accessory.part);
      this.temp.multiplyMatrices(this.frame, accessory.local);
      this.push(this.temp, accessory.color, hurt);
    }

    // Arma in mano.
    if (pose.armed && weapon >= 0) {
      const geometry = look.weaponGeometry(weapon);
      if (geometry) {
        const mesh = this.weaponMesh();
        mesh.geometry = geometry;
        const w = pose.weapon;
        mesh.matrix.set(w[3]!, w[6]!, w[9]!, w[0]!, w[4]!, w[7]!, w[10]!, w[1]!, w[5]!, w[8]!, w[11]!, w[2]!, 0, 0, 0, 1);
        if (this.hasDeath) mesh.matrix.premultiply(this.death);
        mesh.matrixWorldNeedsUpdate = true;
      }
    }
  }

  /** Punto nel mondo nello spazio dell'arma in mano (per esempio la bocca della canna). */
  static weaponPoint(pose: BodyPose, x: number, y: number, z: number, out: Vector3): Vector3 {
    const w = pose.weapon;
    return out.set(
      w[0]! + w[3]! * x + w[6]! * y + w[9]! * z,
      w[1]! + w[4]! * x + w[7]! * y + w[10]! * z,
      w[2]! + w[5]! * x + w[8]! * y + w[11]! * z,
    );
  }

  /** Punto sopra la testa (nome e barra della vita). */
  static labelPoint(pose: BodyPose, out: Vector3): Vector3 {
    const o = PART_HEAD * PART_STRIDE + POSE_CENTER;
    return out.set(pose.parts[o]!, pose.parts[o + 1]! + CHARACTERS.labelHeight, pose.parts[o + 2]!);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.boxes.geometry.dispose();
    (this.boxes.material as MeshLambertMaterial).dispose();
    this.weaponMaterial.dispose();
  }

  // -------------------------------------------------------------------------------------------

  private push(matrix: Matrix4, base: Color, hurt: number): void {
    if (this.hasDeath) this.extra.multiplyMatrices(this.death, matrix);
    this.boxes.setMatrixAt(this.count, this.hasDeath ? this.extra : matrix);
    this.color.copy(base);
    if (hurt > 0) this.color.lerp(HURT_COLOR, hurt);
    this.boxes.setColorAt(this.count, this.color);
    this.count++;
  }

  /** Riferimento della parte: assi della posa e origine nel giunto. */
  private partFrame(pose: BodyPose, index: number): void {
    const p = pose.parts;
    const o = index * PART_STRIDE;
    this.frame.set(
      p[o + POSE_AXIS_X]!,
      p[o + POSE_AXIS_Y]!,
      p[o + POSE_AXIS_Z]!,
      p[o + POSE_PIVOT]!,
      p[o + POSE_AXIS_X + 1]!,
      p[o + POSE_AXIS_Y + 1]!,
      p[o + POSE_AXIS_Z + 1]!,
      p[o + POSE_PIVOT + 1]!,
      p[o + POSE_AXIS_X + 2]!,
      p[o + POSE_AXIS_Y + 2]!,
      p[o + POSE_AXIS_Z + 2]!,
      p[o + POSE_PIVOT + 2]!,
      0,
      0,
      0,
      1,
    );
  }

  /** Box senza rotazione propria nello spazio di una parte. */
  private detail(
    pose: BodyPose,
    part: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: Color,
    hurt: number,
  ): void {
    this.partFrame(pose, part);
    this.box.makeScale(w, h, d).setPosition(x, y, z);
    this.temp.multiplyMatrices(this.frame, this.box);
    this.push(this.temp, color, hurt);
  }

  /** Da morto il corpo cade all'indietro ruotando attorno ai piedi, poi affonda nel terreno. */
  private setupDeath(pose: BodyPose, effects: CharacterEffects): void {
    this.hasDeath = effects.fall > 0 || effects.sink > 0;
    if (!this.hasDeath) return;
    // Piedi e destra del corpo dalla posa del bacino.
    const p = pose.parts;
    const o = PART_TORSO * PART_STRIDE;
    const fx = p[o + POSE_PIVOT]!;
    const fz = p[o + POSE_PIVOT + 2]!;
    const leg = PART_LEG_LEFT * PART_STRIDE;
    const fy = p[leg + POSE_PIVOT + 1]! - p[leg + POSE_HALF + 1]! * 2;
    this.axis.set(p[o + POSE_AXIS_X]!, 0, p[o + POSE_AXIS_X + 2]!).normalize();
    this.death.makeTranslation(fx, fy - effects.sink, fz);
    this.temp.makeRotationAxis(this.axis, (effects.fall * Math.PI) / 2);
    this.death.multiply(this.temp);
    this.temp.makeTranslation(-fx, -fy, -fz);
    this.death.multiply(this.temp);
  }

  private weaponMesh(): Mesh {
    let mesh = this.weapons[this.weaponCount];
    if (!mesh) {
      mesh = new Mesh(undefined, this.weaponMaterial);
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.weapons.push(mesh);
      this.object.add(mesh);
    }
    this.weaponCount++;
    mesh.visible = true;
    return mesh;
  }

  private prepare(skin: CharacterSkinDef): PreparedLook {
    let look = this.prepared.get(skin);
    if (look) return look;
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    const euler = new Euler();
    look = {
      parts: PART_NAMES.map((name) => new Color(skin.colors[name])),
      hair: new Color(skin.colors.hair),
      eyes: new Color(skin.colors.eyes),
      hands: new Color(skin.colors.hands),
      feet: new Color(skin.colors.feet),
      belt: new Color(skin.colors.belt),
      accessories: skin.accessories.flatMap((accessory) =>
        accessory.boxes.map((box) => {
          const [rx, ry, rz] = box.rotation;
          quaternion.setFromEuler(euler.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180));
          return {
            part: PART_NAMES.indexOf(accessory.part),
            local: new Matrix4().compose(position.set(...box.pos), quaternion, scale.set(...box.size)),
            color: new Color(box.color),
          };
        }),
      ),
    };
    this.prepared.set(skin, look);
    return look;
  }
}
