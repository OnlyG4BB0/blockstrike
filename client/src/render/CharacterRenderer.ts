/**
 * Personaggi a blocchi disegnati dalla posa condivisa (shared/src/pose.ts): le sei parti, i
 * dettagli (capelli, occhi, mani, scarpe, cintura) e gli accessori delle skin sono box di un'unica
 * InstancedMesh, così tutti i personaggi costano una chiamata di disegno (più una per l'ombra).
 * Braccia e gambe si disegnano in due segmenti: gomito e ginocchio sporgono quanto il box della posa
 * (che è anche la hitbox) è più profondo dell'arto disteso, quindi restano dentro ciò che si colpisce.
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
  /** Parti da non disegnare (bit 1 << parte): quelle staccate, o tutte tranne una per un pezzo. */
  hidden?: number;
  /** Colore della squadra: una fascia sul busto (null = nessuna squadra). */
  team?: Color | null;
  /** Occhi: 0 aperti, 1 chiusi (battito di ciglia, smorfia quando viene colpito). */
  blink?: number;
  /** Scala attorno ai piedi (comparsa alla rinascita); 1 = normale. */
  scale?: number;
}

/** Box per personaggio: sei parti (gli arti in due segmenti), dieci dettagli e gli accessori. */
const DETAIL_BOXES = 10;
const LIMB_SEGMENTS = 4;
const MAX_BOXES_PER_CHARACTER = PART_COUNT + LIMB_SEGMENTS + DETAIL_BOXES + 16;
/** Sotto questa sporgenza (m) l'arto si disegna dritto, in un pezzo solo. */
const MIN_BEND = 0.015;
/** Quanto i due segmenti si sovrappongono al giunto, in frazioni dello spessore. */
const JOINT_OVERLAP = 0.3;

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

function visible(hidden: number, part: number): boolean {
  return (hidden & (1 << part)) === 0;
}

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
    const hidden = effects.hidden ?? 0;

    // Le sei parti.
    for (let i = 0; i < PART_COUNT; i++) {
      if (!visible(hidden, i)) continue;
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
      if (this.showHitboxes && !this.hasDeath) this.hitboxes.setMatrixAt(this.hitboxCount++, this.box);
      if (i >= PART_ARM_LEFT && this.limb(parts, i, prepared.parts[i]!, hurt)) continue;
      this.push(this.box, prepared.parts[i]!, hurt);
    }

    // Dettagli, nello spazio delle parti (origine nel giunto).
    const head = BODY.headHalf * 2;
    if (visible(hidden, PART_HEAD)) {
      this.detail(pose, PART_HEAD, 0, head + 0.03, 0.01, head + 0.02, 0.07, head + 0.02, prepared.hair, hurt);
      this.detail(pose, PART_HEAD, 0, head * 0.62, 0.11, head + 0.02, head * 0.5, 0.14, prepared.hair, hurt);
      const eye = 0.05 * (1 - 0.82 * Math.min(1, Math.max(0, effects.blink ?? 0)));
      this.detail(pose, PART_HEAD, -0.075, head * 0.55, -head / 2 - 0.005, 0.06, eye, 0.02, prepared.eyes, hurt);
      this.detail(pose, PART_HEAD, 0.075, head * 0.55, -head / 2 - 0.005, 0.06, eye, 0.02, prepared.eyes, hurt);
    }
    if (visible(hidden, PART_TORSO)) {
      this.detail(pose, PART_TORSO, 0, 0.03, 0, BODY.torsoHalfWidth * 2 + 0.02, 0.06, BODY.torsoHalfDepth * 2 + 0.02, prepared.belt, hurt);
      if (effects.team) {
        const height = parts[PART_TORSO * PART_STRIDE + POSE_HALF + 1]! * 2;
        this.detail(pose, PART_TORSO, 0, height * 0.72, 0, BODY.torsoHalfWidth * 2 + 0.03, 0.1, BODY.torsoHalfDepth * 2 + 0.03, effects.team, 0);
      }
    }
    for (let arm = PART_ARM_LEFT; arm <= PART_ARM_RIGHT; arm++) {
      if (!visible(hidden, arm)) continue;
      const length = parts[arm * PART_STRIDE + POSE_HALF + 1]! * 2;
      this.detail(pose, arm, 0, -length, 0, 0.13, 0.13, 0.12, prepared.hands, hurt);
    }
    for (let leg = PART_LEG_LEFT; leg <= PART_LEG_RIGHT; leg++) {
      if (!visible(hidden, leg)) continue;
      const o = leg * PART_STRIDE;
      const length = parts[o + POSE_HALF + 1]! * 2;
      const depth = parts[o + POSE_HALF + 2]! * 2;
      this.detail(pose, leg, 0, -length + 0.05, -0.03, 0.24, 0.1, Math.max(0.3, depth), prepared.feet, hurt);
    }

    // Accessori della skin.
    for (const accessory of prepared.accessories) {
      if (!visible(hidden, accessory.part)) continue;
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

  /**
   * Arto in due segmenti, dal giunto al gomito o ginocchio e da lì all'estremità. Il giunto di mezzo
   * sporge lungo l'asse Z della parte di quanto il box è più profondo dell'arto disteso.
   * Restituisce false se l'arto è dritto (lo disegna chi chiama, in un pezzo solo).
   */
  private limb(p: Float64Array, index: number, color: Color, hurt: number): boolean {
    const o = index * PART_STRIDE;
    const leg = index >= PART_LEG_LEFT;
    const nominal = leg ? BODY.legHalfDepth : BODY.armHalfDepth;
    const hy = p[o + POSE_HALF + 1]!;
    const hz = p[o + POSE_HALF + 2]!;
    const yx = p[o + POSE_AXIS_Y]!;
    const yy = p[o + POSE_AXIS_Y + 1]!;
    const yz = p[o + POSE_AXIS_Y + 2]!;
    const zx = p[o + POSE_AXIS_Z]!;
    const zy = p[o + POSE_AXIS_Z + 1]!;
    const zz = p[o + POSE_AXIS_Z + 2]!;
    const ax = p[o + POSE_PIVOT]!;
    const ay = p[o + POSE_PIVOT + 1]!;
    const az = p[o + POSE_PIVOT + 2]!;
    // Punto di mezzo dell'asse dell'arto e spostamento del centro del box rispetto a quello, lungo Z.
    const mx = ax - yx * hy;
    const my = ay - yy * hy;
    const mz = az - yz * hy;
    const off = (p[o + POSE_CENTER]! - mx) * zx + (p[o + POSE_CENTER + 1]! - my) * zy + (p[o + POSE_CENTER + 2]! - mz) * zz;
    const size = Math.abs(off) + hz - nominal;
    if (size < MIN_BEND) return false;
    const bend = off >= 0 ? size : -size;
    const kx = mx + zx * bend;
    const ky = my + zy * bend;
    const kz = mz + zz * bend;
    const width = p[o + POSE_HALF]! * 2;
    this.segment(p, o, ax, ay, az, kx, ky, kz, width, nominal * 2, 1, color, hurt);
    this.segment(p, o, ax - yx * hy * 2, ay - yy * hy * 2, az - yz * hy * 2, kx, ky, kz, width * 0.94, nominal * 1.88, -1, color, hurt);
    return true;
  }

  /** Segmento di un arto dall'estremità (ex, ey, ez) al giunto di mezzo (kx, ky, kz), allungato oltre il giunto. */
  private segment(
    p: Float64Array,
    o: number,
    ex: number,
    ey: number,
    ez: number,
    kx: number,
    ky: number,
    kz: number,
    width: number,
    depth: number,
    direction: number,
    color: Color,
    hurt: number,
  ): void {
    // Asse Y del segmento: verso il giunto principale (per il primo dal giunto di mezzo, per il secondo dall'estremità).
    let yx = (ex - kx) * direction;
    let yy = (ey - ky) * direction;
    let yz = (ez - kz) * direction;
    const length = Math.hypot(yx, yy, yz) || 1e-6;
    yx /= length;
    yy /= length;
    yz /= length;
    const xx = p[o + POSE_AXIS_X]!;
    const xy = p[o + POSE_AXIS_X + 1]!;
    const xz = p[o + POSE_AXIS_X + 2]!;
    // Z = X × Y
    const zx = xy * yz - xz * yy;
    const zy = xz * yx - xx * yz;
    const zz = xx * yy - xy * yx;
    const extra = depth * JOINT_OVERLAP;
    const full = length + extra;
    // Centro: a metà tra estremità e giunto, spostato verso il giunto di metà dell'allungamento.
    const t = 0.5 + extra / (2 * length);
    const cx = ex + (kx - ex) * t;
    const cy = ey + (ky - ey) * t;
    const cz = ez + (kz - ez) * t;
    this.temp.set(xx * width, yx * full, zx * depth, cx, xy * width, yy * full, zy * depth, cy, xz * width, yz * full, zz * depth, cz, 0, 0, 0, 1);
    this.push(this.temp, color, hurt);
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
    const scale = effects.scale ?? 1;
    this.hasDeath = effects.fall > 0 || effects.sink > 0 || scale !== 1;
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
    if (scale !== 1) this.death.multiply(this.temp.makeScale(scale, scale, scale));
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
