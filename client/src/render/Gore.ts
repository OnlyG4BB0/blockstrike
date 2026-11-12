/**
 * Splatter, calcolato solo sul client a partire dagli eventi della partita:
 * - getti di sangue all'impatto (più forti alla testa), con gocce che macchiano muri e pavimento;
 * - macchie che sfumano dopo un po' (al massimo GORE.maxDecals, le più vecchie si riciclano);
 * - corpi come manichini a punti e aste (ragdoll semplificato) che cadono nella direzione del colpo;
 * - parti staccate e corpi fatti a pezzi: oggetti fisici che rimbalzano e lasciano una scia;
 * - pozza di sangue che si allarga sotto il corpo.
 *
 * Tetti fissi: particelle, macchie e pezzi stanno in pool preallocati; particelle e macchie sono
 * disegnate con l'instancing, corpi e pezzi passano dal disegno a istanze dei personaggi.
 * Con il gore spento niente sangue: scintille al posto delle gocce e i corpi svaniscono.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import {
  BodyPose,
  PART_COUNT,
  PART_HEAD,
  PART_STRIDE,
  PART_TORSO,
  POSE_AXIS_X,
  POSE_AXIS_Y,
  POSE_AXIS_Z,
  POSE_CENTER,
  POSE_HALF,
  POSE_PIVOT,
  createRayHit,
  raycastWorld,
  solidAt,
  solidExit,
  type CollisionWorld,
  type GoreLevel,
  type GoreOutcome,
} from '@blockstrike/shared';
import { GORE } from '../config.ts';
import type { CharacterLook, CharacterRenderer } from './CharacterRenderer.ts';

const KIND_FREE = 0;
const KIND_BLOOD = 1;
const KIND_SPARK = 2;
const KIND_CHUNK = 3;

// Punti del manichino.
const HEAD = 0;
const NECK = 1;
const PELVIS = 2;
const SHOULDER_L = 3;
const SHOULDER_R = 4;
const HAND_L = 5;
const HAND_R = 6;
const HIP_L = 7;
const HIP_R = 8;
const FOOT_L = 9;
const FOOT_R = 10;
const POINTS = 11;

/** Aste del manichino: punti collegati e rigidità. Il busto è un blocco rigido, gli arti ruotano liberi. */
const STICKS: readonly (readonly [number, number, number])[] = [
  [NECK, PELVIS, 1],
  [SHOULDER_L, SHOULDER_R, 1],
  [SHOULDER_L, PELVIS, 1],
  [SHOULDER_R, PELVIS, 1],
  [SHOULDER_L, NECK, 1],
  [SHOULDER_R, NECK, 1],
  [HIP_L, HIP_R, 1],
  [HIP_L, PELVIS, 1],
  [HIP_R, PELVIS, 1],
  [SHOULDER_L, HIP_L, 1],
  [SHOULDER_R, HIP_R, 1],
  [SHOULDER_L, HIP_R, 1],
  [SHOULDER_R, HIP_L, 1],
  [NECK, HEAD, 1],
  [HEAD, SHOULDER_L, 0.3],
  [HEAD, SHOULDER_R, 0.3],
  [SHOULDER_L, HAND_L, 1],
  [SHOULDER_R, HAND_R, 1],
  [HIP_L, FOOT_L, 1],
  [HIP_R, FOOT_R, 1],
];

/** Per ogni parte: punto del giunto e punto all'altra estremità. */
const PART_ENDS: readonly (readonly [number, number])[] = [
  [NECK, HEAD],
  [PELVIS, NECK],
  [SHOULDER_L, HAND_L],
  [SHOULDER_R, HAND_R],
  [HIP_L, FOOT_L],
  [HIP_R, FOOT_R],
];

const ALL_PARTS = (1 << PART_COUNT) - 1;

interface Ragdoll {
  active: boolean;
  pos: Float64Array;
  prev: Float64Array;
  rest: Float64Array;
  /** Aste attive (quelle di una parte staccata vengono tolte). */
  enabled: Uint8Array;
  /** Parti nascoste (staccate). */
  hidden: number;
  /** Semi-dimensioni di ogni parte al momento della morte. */
  half: Float64Array;
  look: CharacterLook | null;
  pose: BodyPose;
  age: number;
  still: number;
  pooled: boolean;
  /** Punto da cui esce sangue (moncherino) e per quanto ancora. */
  stump: number;
  bleeding: number;
}

interface Piece {
  active: boolean;
  part: number;
  look: CharacterLook | null;
  pose: BodyPose;
  position: Vector3;
  velocity: Vector3;
  spin: Vector3;
  rotation: Quaternion;
  half: Vector3;
  age: number;
  trail: number;
  resting: boolean;
}

/** Dati di un'uccisione che servono allo splatter. */
export interface KillSplatter {
  outcome: GoreOutcome;
  pose: BodyPose;
  look: CharacterLook;
  part: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  /** Velocità della vittima. */
  vx: number;
  vy: number;
  vz: number;
  explosive: boolean;
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Texture di una macchia a blocchi (bianca: il colore lo dà l'istanza). */
function createSplatTexture(): CanvasTexture {
  const size = GORE.splatTexture;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  const center = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const angle = Math.atan2(dy, dx);
      // Bordo irregolare: un cerchio con qualche lobo.
      const edge = center * (0.62 + 0.18 * Math.sin(angle * 3 + 1) + 0.12 * Math.sin(angle * 5 + 2));
      const distance = Math.hypot(dx, dy);
      if (distance < edge || (distance < center * 0.95 && (x * 7 + y * 13) % 11 === 0)) context.fillRect(x, y, 1, 1);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

export class Gore {
  level: GoreLevel = 'full';
  readonly object = new Group();
  private readonly world: CollisionWorld;

  // Particelle (strutture di array: niente oggetti per goccia).
  private readonly particleMesh: InstancedMesh;
  private readonly kind = new Uint8Array(GORE.maxParticles);
  private readonly px = new Float32Array(GORE.maxParticles);
  private readonly py = new Float32Array(GORE.maxParticles);
  private readonly pz = new Float32Array(GORE.maxParticles);
  private readonly vx = new Float32Array(GORE.maxParticles);
  private readonly vy = new Float32Array(GORE.maxParticles);
  private readonly vz = new Float32Array(GORE.maxParticles);
  private readonly life = new Float32Array(GORE.maxParticles);
  private readonly size = new Float32Array(GORE.maxParticles);
  private particleCursor = 0;
  private particleHigh = 0;
  private activeParticles = 0;

  // Macchie.
  private readonly decalMesh: InstancedMesh;
  private readonly decalAlpha: InstancedBufferAttribute;
  private readonly decalLife = new Float32Array(GORE.maxDecals);
  private readonly decalGrow = new Float32Array(GORE.maxDecals);
  private readonly decalSize = new Float32Array(GORE.maxDecals);
  private readonly decalAge = new Float32Array(GORE.maxDecals);
  private readonly decalNormal = new Float32Array(GORE.maxDecals * 3);
  private readonly decalPosition = new Float32Array(GORE.maxDecals * 3);
  private readonly decalAngle = new Float32Array(GORE.maxDecals);
  private decalCursor = 0;

  private readonly ragdolls: Ragdoll[] = [];
  private readonly pieces: Piece[] = [];
  private ragdollTime = 0;

  // Oggetti riutilizzati.
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly spinStep = new Quaternion();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly color = new Color();
  private readonly normal = { x: 0, y: 0, z: 0 };
  private readonly rayHit = createRayHit();
  private readonly bloodColors: Color[];
  private readonly sparkColors: Color[];
  private readonly zero = new Matrix4().makeScale(0, 0, 0);

  constructor(world: CollisionWorld) {
    this.world = world;
    this.bloodColors = GORE.bloodColors.map((c) => new Color(c));
    this.sparkColors = GORE.sparkColors.map((c) => new Color(c));

    this.particleMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), GORE.maxParticles);
    this.particleMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.particleMesh.setColorAt(0, this.color.set(0xffffff));

    const plane = new PlaneGeometry(1, 1);
    this.decalAlpha = new InstancedBufferAttribute(new Float32Array(GORE.maxDecals), 1);
    this.decalAlpha.setUsage(DynamicDrawUsage);
    plane.setAttribute('instanceAlpha', this.decalAlpha);
    const decalMaterial = new MeshBasicMaterial({
      map: createSplatTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: DoubleSide,
    });
    // Trasparenza per istanza, per far sfumare ogni macchia per conto suo.
    decalMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;');
    };
    this.decalMesh = new InstancedMesh(plane, decalMaterial, GORE.maxDecals);
    this.decalMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.renderOrder = 1;
    this.decalMesh.setColorAt(0, this.color.set(0xffffff));
    for (let i = 0; i < GORE.maxDecals; i++) this.decalMesh.setMatrixAt(i, this.zero);

    for (let i = 0; i < GORE.maxRagdolls; i++) {
      this.ragdolls.push({
        active: false,
        pos: new Float64Array(POINTS * 3),
        prev: new Float64Array(POINTS * 3),
        rest: new Float64Array(STICKS.length),
        enabled: new Uint8Array(STICKS.length),
        hidden: 0,
        half: new Float64Array(PART_COUNT * 3),
        look: null,
        pose: new BodyPose(),
        age: 0,
        still: 0,
        pooled: false,
        stump: -1,
        bleeding: 0,
      });
    }
    for (let i = 0; i < GORE.maxPieces; i++) {
      this.pieces.push({
        active: false,
        part: 0,
        look: null,
        pose: new BodyPose(),
        position: new Vector3(),
        velocity: new Vector3(),
        spin: new Vector3(),
        rotation: new Quaternion(),
        half: new Vector3(),
        age: 0,
        trail: 0,
        resting: false,
      });
    }
    this.object.add(this.particleMesh, this.decalMesh);
  }

  /** Numeri per i dati di debug e le prove. */
  stats(): { particles: number; decals: number; ragdolls: number; pieces: number } {
    let decals = 0;
    for (let i = 0; i < GORE.maxDecals; i++) if (this.decalLife[i]! > 0) decals++;
    return {
      particles: this.activeParticles,
      decals,
      ragdolls: this.ragdolls.filter((r) => r.active).length,
      pieces: this.pieces.filter((p) => p.active).length,
    };
  }

  /** Colpo a segno: getto di sangue nella direzione del colpo (scintille con il gore spento). */
  hit(x: number, y: number, z: number, dx: number, dy: number, dz: number, damage: number, headshot: boolean): void {
    if (this.level === 'off') {
      this.spray(KIND_SPARK, x, y, z, dx, dy, dz, GORE.sparkCount, GORE.sprayCone * 1.6, GORE.sparkSpeed);
      return;
    }
    const count = Math.round((GORE.hitDroplets + damage * GORE.dropletsPerDamage) * (headshot ? GORE.headshotFactor : 1));
    this.spray(KIND_BLOOD, x, y, z, dx, dy, dz, count, GORE.sprayCone, headshot ? GORE.headshotSpeed : GORE.spraySpeed);
  }

  /** Morte: manichino, parte staccata, corpo a pezzi oppure niente (gore spento). */
  kill(k: KillSplatter): void {
    const pose = k.pose;
    if (k.outcome === 'vanish') {
      const o = PART_TORSO * PART_STRIDE + POSE_CENTER;
      this.spray(KIND_SPARK, pose.parts[o]!, pose.parts[o + 1]!, pose.parts[o + 2]!, 0, 1, 0, GORE.vanishSparks, Math.PI, GORE.sparkSpeed);
      return;
    }
    // Getto dal punto colpito.
    this.spray(KIND_BLOOD, k.x, k.y, k.z, k.dx, k.dy, k.dz, GORE.killDroplets, GORE.sprayCone, GORE.headshotSpeed);
    if (k.outcome === 'gib') {
      this.gib(k);
      return;
    }
    const ragdoll = this.ragdoll(k);
    if (k.outcome === 'dismember' && ragdoll && k.part >= 0) this.dismember(ragdoll, k);
  }

  update(dt: number): void {
    this.updateParticles(dt);
    this.updateDecals(dt);
    // Manichini a passo fisso: la fisica a punti è stabile solo con passi costanti.
    this.ragdollTime = Math.min(this.ragdollTime + dt, GORE.ragdollStep * 4);
    while (this.ragdollTime >= GORE.ragdollStep) {
      this.ragdollTime -= GORE.ragdollStep;
      for (const ragdoll of this.ragdolls) if (ragdoll.active) this.stepRagdoll(ragdoll, GORE.ragdollStep);
    }
    for (const ragdoll of this.ragdolls) if (ragdoll.active) this.afterRagdoll(ragdoll, dt);
    for (const piece of this.pieces) if (piece.active) this.updatePiece(piece, dt);
  }

  /** Aggiunge corpi e pezzi al disegno dei personaggi (tra begin ed end). */
  draw(characters: CharacterRenderer): void {
    for (const ragdoll of this.ragdolls) {
      if (!ragdoll.active || !ragdoll.look) continue;
      this.ragdollPose(ragdoll);
      const sink = Math.max(0, ragdoll.age - GORE.ragdollLife) / GORE.ragdollSinkTime;
      characters.add(ragdoll.pose, ragdoll.look, -1, {
        hurt: 0,
        fall: 0,
        sink: Math.min(1, sink) * GORE.sinkDepth,
        hidden: ragdoll.hidden,
      });
    }
    for (const piece of this.pieces) {
      if (!piece.active || !piece.look) continue;
      this.piecePose(piece);
      const sink = Math.max(0, piece.age - GORE.pieceLife) / GORE.ragdollSinkTime;
      characters.add(piece.pose, piece.look, -1, {
        hurt: 0,
        fall: 0,
        sink: Math.min(1, sink) * GORE.sinkDepth,
        hidden: ALL_PARTS & ~(1 << piece.part),
      });
    }
  }

  /** Toglie tutto (cambio di mappa o gore spento). */
  clear(): void {
    this.kind.fill(KIND_FREE);
    this.activeParticles = 0;
    this.particleHigh = 0;
    this.particleMesh.count = 0;
    this.decalLife.fill(0);
    for (let i = 0; i < GORE.maxDecals; i++) this.decalMesh.setMatrixAt(i, this.zero);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    for (const ragdoll of this.ragdolls) ragdoll.active = false;
    for (const piece of this.pieces) piece.active = false;
  }

  // -------------------------------------------------------------------------------------------
  // Particelle
  // -------------------------------------------------------------------------------------------

  private spray(
    kind: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    count: number,
    cone: number,
    speed: readonly [number, number],
  ): void {
    for (let i = 0; i < count; i++) {
      // Direzione casuale nel cono attorno a (dx, dy, dz).
      const a = Math.random() * Math.PI * 2;
      const r = Math.tan(cone * Math.sqrt(Math.random()));
      this.v1.set(dx, dy, dz);
      if (this.v1.lengthSq() < 1e-6) this.v1.set(0, 1, 0);
      this.v1.normalize();
      this.v2.set(Math.abs(this.v1.y) < 0.9 ? 0 : 1, Math.abs(this.v1.y) < 0.9 ? 1 : 0, 0).cross(this.v1).normalize();
      this.v3.crossVectors(this.v1, this.v2);
      this.v1.addScaledVector(this.v2, Math.cos(a) * r).addScaledVector(this.v3, Math.sin(a) * r).normalize();
      const s = between(speed[0], speed[1]);
      const big = kind === KIND_BLOOD && Math.random() < GORE.bigDropletChance;
      this.spawnParticle(
        kind,
        x,
        y,
        z,
        this.v1.x * s,
        this.v1.y * s + (kind === KIND_SPARK ? 0 : GORE.sprayLift),
        this.v1.z * s,
        kind === KIND_SPARK ? GORE.sparkSize : big ? GORE.bigDropletSize : between(GORE.dropletSize[0], GORE.dropletSize[1]),
        kind === KIND_SPARK ? between(0.15, 0.35) : GORE.dropletLife,
      );
    }
  }

  private spawnParticle(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): void {
    const max = GORE.maxParticles;
    let slot = -1;
    for (let n = 0; n < max; n++) {
      const i = (this.particleCursor + n) % max;
      if (this.kind[i] === KIND_FREE) {
        slot = i;
        break;
      }
    }
    if (slot < 0) slot = this.particleCursor;
    else this.activeParticles++;
    this.particleCursor = (slot + 1) % max;
    this.kind[slot] = kind;
    this.px[slot] = x;
    this.py[slot] = y;
    this.pz[slot] = z;
    this.vx[slot] = vx;
    this.vy[slot] = vy;
    this.vz[slot] = vz;
    this.size[slot] = size;
    this.life[slot] = life;
    const palette = kind === KIND_SPARK ? this.sparkColors : this.bloodColors;
    this.particleMesh.setColorAt(slot, palette[Math.floor(Math.random() * palette.length)]!);
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    if (slot + 1 > this.particleHigh) this.particleHigh = slot + 1;
  }

  private freeParticle(i: number): void {
    this.kind[i] = KIND_FREE;
    this.activeParticles--;
    this.particleMesh.setMatrixAt(i, this.zero);
  }

  private updateParticles(dt: number): void {
    const array = this.particleMesh.instanceMatrix.array as Float32Array;
    const drag = Math.max(0, 1 - GORE.airDrag * dt);
    let high = 0;
    for (let i = 0; i < this.particleHigh; i++) {
      const kind = this.kind[i]!;
      if (kind === KIND_FREE) continue;
      let life = this.life[i]! - dt;
      if (life <= 0) {
        this.freeParticle(i);
        continue;
      }
      this.life[i] = life;
      let vx = this.vx[i]! * drag;
      let vy = this.vy[i]! * drag - GORE.gravity * dt;
      let vz = this.vz[i]! * drag;
      const nx = this.px[i]! + vx * dt;
      const ny = this.py[i]! + vy * dt;
      const nz = this.pz[i]! + vz * dt;
      const solid = solidAt(this.world, nx, ny, nz);
      if (solid >= 0) {
        if (kind === KIND_SPARK) {
          this.freeParticle(i);
          continue;
        }
        const s = this.world.solids[solid]!;
        const depth = solidExit(s, nx, ny, nz, this.normal);
        const n = this.normal;
        const hx = nx + n.x * depth;
        const hy = ny + n.y * depth;
        const hz = nz + n.z * depth;
        if (kind === KIND_BLOOD) {
          if (Math.random() < GORE.decalChance) {
            this.addDecal(hx, hy, hz, n.x, n.y, n.z, between(GORE.decalSize[0], GORE.decalSize[1]) * (this.size[i]! / GORE.dropletSize[1]), 0);
          }
          this.freeParticle(i);
          continue;
        }
        // Pezzetti: rimbalzano, macchiano e restano a terra.
        const vn = vx * n.x + vy * n.y + vz * n.z;
        if (vn < -GORE.chunkSplatSpeed) this.addDecal(hx, hy, hz, n.x, n.y, n.z, between(0.3, 0.55), 0);
        vx = (vx - vn * n.x) * GORE.chunkFriction - vn * n.x * GORE.chunkBounce;
        vy = (vy - vn * n.y) * GORE.chunkFriction - vn * n.y * GORE.chunkBounce;
        vz = (vz - vn * n.z) * GORE.chunkFriction - vn * n.z * GORE.chunkBounce;
        this.px[i] = hx;
        this.py[i] = hy;
        this.pz[i] = hz;
      } else {
        this.px[i] = nx;
        this.py[i] = ny;
        this.pz[i] = nz;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      // Matrice: solo posizione e scala (le gocce sono cubetti dritti).
      const size = kind === KIND_SPARK ? this.size[i]! * Math.min(1, life * 4) : this.size[i]!;
      const o = i * 16;
      array[o] = size;
      array[o + 1] = 0;
      array[o + 2] = 0;
      array[o + 3] = 0;
      array[o + 4] = 0;
      array[o + 5] = size;
      array[o + 6] = 0;
      array[o + 7] = 0;
      array[o + 8] = 0;
      array[o + 9] = 0;
      array[o + 10] = size;
      array[o + 11] = 0;
      array[o + 12] = this.px[i]!;
      array[o + 13] = this.py[i]!;
      array[o + 14] = this.pz[i]!;
      array[o + 15] = 1;
      high = i + 1;
    }
    this.particleHigh = high;
    this.particleMesh.count = high;
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------------------------------------
  // Macchie
  // -------------------------------------------------------------------------------------------

  /** Macchia sulla superficie con normale n. `grow` > 0: pozza che si allarga fino a quella misura. */
  private addDecal(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, grow: number): void {
    if (this.level === 'off') return;
    const i = this.decalCursor;
    this.decalCursor = (i + 1) % GORE.maxDecals;
    this.decalLife[i] = grow > 0 ? GORE.poolLife : GORE.decalLife;
    this.decalAge[i] = 0;
    this.decalGrow[i] = grow;
    this.decalSize[i] = size;
    this.decalAngle[i] = Math.random() * Math.PI * 2;
    this.decalPosition[i * 3] = x + nx * GORE.decalOffset;
    this.decalPosition[i * 3 + 1] = y + ny * GORE.decalOffset;
    this.decalPosition[i * 3 + 2] = z + nz * GORE.decalOffset;
    this.decalNormal[i * 3] = nx;
    this.decalNormal[i * 3 + 1] = ny;
    this.decalNormal[i * 3 + 2] = nz;
    const palette = this.bloodColors;
    this.decalMesh.setColorAt(i, this.color.copy(palette[Math.floor(Math.random() * palette.length)]!).multiplyScalar(0.85));
    if (this.decalMesh.instanceColor) this.decalMesh.instanceColor.needsUpdate = true;
    this.writeDecal(i, grow > 0 ? grow * GORE.poolStart : size);
  }

  private writeDecal(i: number, size: number): void {
    this.v1.set(this.decalNormal[i * 3]!, this.decalNormal[i * 3 + 1]!, this.decalNormal[i * 3 + 2]!);
    this.quaternion.setFromUnitVectors(this.v2.set(0, 0, 1), this.v1);
    this.spinStep.setFromAxisAngle(this.v2, this.decalAngle[i]!);
    this.quaternion.multiply(this.spinStep);
    this.v3.set(this.decalPosition[i * 3]!, this.decalPosition[i * 3 + 1]!, this.decalPosition[i * 3 + 2]!);
    this.matrix.compose(this.v3, this.quaternion, this.v1.set(size, size, 1));
    this.decalMesh.setMatrixAt(i, this.matrix);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  private updateDecals(dt: number): void {
    const alpha = this.decalAlpha.array as Float32Array;
    for (let i = 0; i < GORE.maxDecals; i++) {
      if (this.decalLife[i]! <= 0) continue;
      const life = this.decalLife[i]! - dt;
      this.decalLife[i] = life;
      this.decalAge[i] = this.decalAge[i]! + dt;
      if (life <= 0) {
        this.decalMesh.setMatrixAt(i, this.zero);
        this.decalMesh.instanceMatrix.needsUpdate = true;
        alpha[i] = 0;
        continue;
      }
      alpha[i] = Math.min(1, life / GORE.decalFade) * GORE.decalOpacity;
      const grow = this.decalGrow[i]!;
      if (grow > 0 && this.decalAge[i]! < GORE.poolGrowTime) {
        const t = this.decalAge[i]! / GORE.poolGrowTime;
        this.writeDecal(i, grow * (GORE.poolStart + (1 - GORE.poolStart) * (1 - (1 - t) * (1 - t))));
      }
    }
    this.decalAlpha.needsUpdate = true;
  }

  // -------------------------------------------------------------------------------------------
  // Manichini
  // -------------------------------------------------------------------------------------------

  private ragdoll(k: KillSplatter): Ragdoll | null {
    // Il più vecchio viene riciclato.
    let ragdoll = this.ragdolls.find((r) => !r.active);
    if (!ragdoll) ragdoll = this.ragdolls.reduce((a, b) => (a.age > b.age ? a : b));
    const parts = k.pose.parts;
    const pos = ragdoll.pos;
    const setPoint = (point: number, x: number, y: number, z: number) => {
      pos[point * 3] = x;
      pos[point * 3 + 1] = y;
      pos[point * 3 + 2] = z;
    };
    for (let part = 0; part < PART_COUNT; part++) {
      const o = part * PART_STRIDE;
      const [joint, end] = PART_ENDS[part]!;
      const hy = parts[o + POSE_HALF + 1]!;
      // Testa e busto si estendono lungo +Y dal giunto, braccia e gambe lungo -Y.
      const sign = part === PART_HEAD || part === PART_TORSO ? 2 : -2;
      setPoint(joint, parts[o + POSE_PIVOT]!, parts[o + POSE_PIVOT + 1]!, parts[o + POSE_PIVOT + 2]!);
      if (part !== PART_TORSO) {
        setPoint(
          end,
          parts[o + POSE_PIVOT]! + parts[o + POSE_AXIS_Y]! * hy * sign,
          parts[o + POSE_PIVOT + 1]! + parts[o + POSE_AXIS_Y + 1]! * hy * sign,
          parts[o + POSE_PIVOT + 2]! + parts[o + POSE_AXIS_Y + 2]! * hy * sign,
        );
      }
      ragdoll.half[part * 3] = parts[o + POSE_HALF]!;
      ragdoll.half[part * 3 + 1] = hy;
      ragdoll.half[part * 3 + 2] = parts[o + POSE_HALF + 2]!;
    }
    // Il collo del busto coincide con quello della testa (la posa li fa già combaciare).
    for (let s = 0; s < STICKS.length; s++) {
      const [a, b] = STICKS[s]!;
      ragdoll.rest[s] = Math.hypot(pos[a * 3]! - pos[b * 3]!, pos[a * 3 + 1]! - pos[b * 3 + 1]!, pos[a * 3 + 2]! - pos[b * 3 + 2]!);
      ragdoll.enabled[s] = 1;
    }
    // Velocità iniziale: quella della vittima più la spinta del colpo, più forte sulla parte colpita.
    const step = GORE.ragdollStep;
    const impulse = k.explosive ? GORE.explosionImpulse : GORE.hitImpulse;
    const lift = k.explosive ? GORE.explosionLift : GORE.hitLift;
    for (let p = 0; p < POINTS; p++) {
      const onPart = k.part >= 0 && (PART_ENDS[k.part]![1] === p || PART_ENDS[k.part]![0] === p) ? GORE.partImpulseFactor : 1;
      const jitter = 1 + (Math.random() - 0.5) * GORE.impulseJitter;
      const vx = k.vx + k.dx * impulse * onPart * jitter;
      const vy = k.vy + k.dy * impulse * onPart * jitter + lift;
      const vz = k.vz + k.dz * impulse * onPart * jitter;
      ragdoll.prev[p * 3] = pos[p * 3]! - vx * step;
      ragdoll.prev[p * 3 + 1] = pos[p * 3 + 1]! - vy * step;
      ragdoll.prev[p * 3 + 2] = pos[p * 3 + 2]! - vz * step;
    }
    ragdoll.active = true;
    ragdoll.hidden = 0;
    ragdoll.look = k.look;
    ragdoll.age = 0;
    ragdoll.still = 0;
    ragdoll.pooled = false;
    ragdoll.stump = -1;
    ragdoll.bleeding = 0;
    return ragdoll;
  }

  /** Stacca una parte dal manichino e la fa volare via come pezzo a sé. */
  private dismember(ragdoll: Ragdoll, k: KillSplatter): void {
    const part = k.part;
    ragdoll.hidden |= 1 << part;
    const [joint, end] = PART_ENDS[part]!;
    for (let s = 0; s < STICKS.length; s++) {
      const [a, b] = STICKS[s]!;
      if ((a === end && b !== joint) || (b === end && a !== joint) || (a === end && b === joint) || (b === end && a === joint)) {
        ragdoll.enabled[s] = 0;
      }
    }
    ragdoll.stump = joint;
    ragdoll.bleeding = GORE.stumpBleedTime;
    const piece = this.spawnPiece(k, part);
    if (piece) {
      piece.velocity.set(
        k.vx + k.dx * GORE.dismemberSpeed + (Math.random() - 0.5),
        k.vy + k.dy * GORE.dismemberSpeed + GORE.dismemberLift,
        k.vz + k.dz * GORE.dismemberSpeed + (Math.random() - 0.5),
      );
    }
    const o = part * PART_STRIDE + POSE_PIVOT;
    this.spray(KIND_BLOOD, k.pose.parts[o]!, k.pose.parts[o + 1]!, k.pose.parts[o + 2]!, k.dx, k.dy + 0.5, k.dz, GORE.stumpBurst, 0.9, GORE.spraySpeed);
  }

  private stepRagdoll(r: Ragdoll, dt: number): void {
    const pos = r.pos;
    const prev = r.prev;
    const damping = GORE.ragdollDamping;
    for (let p = 0; p < POINTS; p++) {
      const i = p * 3;
      const x = pos[i]!;
      const y = pos[i + 1]!;
      const z = pos[i + 2]!;
      pos[i] = x + (x - prev[i]!) * damping;
      pos[i + 1] = y + (y - prev[i + 1]!) * damping - GORE.gravity * dt * dt;
      pos[i + 2] = z + (z - prev[i + 2]!) * damping;
      prev[i] = x;
      prev[i + 1] = y;
      prev[i + 2] = z;
    }
    for (let iteration = 0; iteration < GORE.ragdollIterations; iteration++) {
      for (let s = 0; s < STICKS.length; s++) {
        if (!r.enabled[s]) continue;
        const [a, b, stiffness] = STICKS[s]!;
        const ia = a * 3;
        const ib = b * 3;
        const dx = pos[ib]! - pos[ia]!;
        const dy = pos[ib + 1]! - pos[ia + 1]!;
        const dz = pos[ib + 2]! - pos[ia + 2]!;
        const length = Math.hypot(dx, dy, dz) || 1e-6;
        const k = ((length - r.rest[s]!) / length) * 0.5 * stiffness;
        pos[ia] = pos[ia]! + dx * k;
        pos[ia + 1] = pos[ia + 1]! + dy * k;
        pos[ia + 2] = pos[ia + 2]! + dz * k;
        pos[ib] = pos[ib]! - dx * k;
        pos[ib + 1] = pos[ib + 1]! - dy * k;
        pos[ib + 2] = pos[ib + 2]! - dz * k;
      }
      this.collideRagdoll(r);
    }
  }

  /** Ogni punto ha un piccolo raggio: si spinge fuori dai solidi e struscia con attrito. */
  private collideRagdoll(r: Ragdoll): void {
    const pos = r.pos;
    const prev = r.prev;
    const radius = GORE.ragdollRadius;
    for (let p = 0; p < POINTS; p++) {
      const i = p * 3;
      const x = pos[i]!;
      const y = pos[i + 1]! - radius;
      const z = pos[i + 2]!;
      const solid = solidAt(this.world, x, y, z);
      if (solid < 0) continue;
      const n = this.normal;
      const depth = solidExit(this.world.solids[solid]!, x, y, z, n);
      pos[i] = x + n.x * depth;
      pos[i + 1] = pos[i + 1]! + n.y * depth;
      pos[i + 2] = z + n.z * depth;
      // Attrito: si riduce lo spostamento tangente dall'ultimo passo.
      const vx = pos[i]! - prev[i]!;
      const vy = pos[i + 1]! - prev[i + 1]!;
      const vz = pos[i + 2]! - prev[i + 2]!;
      const vn = vx * n.x + vy * n.y + vz * n.z;
      const tx = vx - vn * n.x;
      const ty = vy - vn * n.y;
      const tz = vz - vn * n.z;
      prev[i] = pos[i]! - tx * (1 - GORE.ragdollFriction);
      prev[i + 1] = pos[i + 1]! - ty * (1 - GORE.ragdollFriction);
      prev[i + 2] = pos[i + 2]! - tz * (1 - GORE.ragdollFriction);
    }
  }

  private afterRagdoll(r: Ragdoll, dt: number): void {
    r.age += dt;
    if (r.age > GORE.ragdollLife + GORE.ragdollSinkTime) {
      r.active = false;
      return;
    }
    // Fermo da un po': pozza di sangue sotto il bacino.
    let motion = 0;
    for (let i = 0; i < POINTS * 3; i++) motion = Math.max(motion, Math.abs(r.pos[i]! - r.prev[i]!));
    r.still = motion < GORE.stillThreshold ? r.still + dt : 0;
    if (!r.pooled && r.still > GORE.poolDelay) {
      r.pooled = true;
      const i = PELVIS * 3;
      raycastWorld(this.world, r.pos[i]!, r.pos[i + 1]! + 0.3, r.pos[i + 2]!, 0, -1, 0, 2, this.rayHit);
      if (this.rayHit.hit && this.rayHit.ny > 0.7) {
        this.addDecal(this.rayHit.x, this.rayHit.y, this.rayHit.z, this.rayHit.nx, this.rayHit.ny, this.rayHit.nz, 0, GORE.poolSize);
      }
    }
    // Moncherino: sangue che esce a fiotti per un po'.
    if (r.bleeding > 0 && r.stump >= 0) {
      r.bleeding -= dt;
      if (Math.random() < GORE.stumpRate * dt) {
        const i = r.stump * 3;
        this.spray(KIND_BLOOD, r.pos[i]!, r.pos[i + 1]!, r.pos[i + 2]!, 0, 1, 0, 2, 0.8, GORE.spraySpeed);
      }
    }
  }

  /** Converte i punti del manichino nella posa a sei parti, per disegnarlo come un personaggio. */
  private ragdollPose(r: Ragdoll): void {
    const pos = r.pos;
    const parts = r.pose.parts;
    r.pose.armed = false;
    // Destra del corpo: dalla spalla sinistra alla destra.
    const rx = pos[SHOULDER_R * 3]! - pos[SHOULDER_L * 3]!;
    const ry = pos[SHOULDER_R * 3 + 1]! - pos[SHOULDER_L * 3 + 1]!;
    const rz = pos[SHOULDER_R * 3 + 2]! - pos[SHOULDER_L * 3 + 2]!;
    for (let part = 0; part < PART_COUNT; part++) {
      const [joint, end] = PART_ENDS[part]!;
      const up = part === PART_HEAD || part === PART_TORSO;
      // Asse Y: per testa e busto dal giunto all'estremità, per gli arti dall'estremità al giunto.
      const from = up ? joint : end;
      const to = up ? end : joint;
      let yx = pos[to * 3]! - pos[from * 3]!;
      let yy = pos[to * 3 + 1]! - pos[from * 3 + 1]!;
      let yz = pos[to * 3 + 2]! - pos[from * 3 + 2]!;
      let length = Math.hypot(yx, yy, yz);
      if (length < 1e-5) {
        yx = 0;
        yy = 1;
        yz = 0;
        length = 1e-5;
      } else {
        yx /= length;
        yy /= length;
        yz /= length;
      }
      const dot = rx * yx + ry * yy + rz * yz;
      let xx = rx - dot * yx;
      let xy = ry - dot * yy;
      let xz = rz - dot * yz;
      let xl = Math.hypot(xx, xy, xz);
      if (xl < 1e-5) {
        xx = yy;
        xy = -yx;
        xz = 0;
        xl = Math.hypot(xx, xy) || 1;
      }
      xx /= xl;
      xy /= xl;
      xz /= xl;
      const o = part * PART_STRIDE;
      const hy = part === PART_HEAD ? r.half[part * 3 + 1]! : length / 2;
      const jx = pos[joint * 3]!;
      const jy = pos[joint * 3 + 1]!;
      const jz = pos[joint * 3 + 2]!;
      const sign = up ? 1 : -1;
      parts[o + POSE_PIVOT] = jx;
      parts[o + POSE_PIVOT + 1] = jy;
      parts[o + POSE_PIVOT + 2] = jz;
      parts[o + POSE_CENTER] = jx + yx * hy * sign;
      parts[o + POSE_CENTER + 1] = jy + yy * hy * sign;
      parts[o + POSE_CENTER + 2] = jz + yz * hy * sign;
      parts[o + POSE_AXIS_X] = xx;
      parts[o + POSE_AXIS_X + 1] = xy;
      parts[o + POSE_AXIS_X + 2] = xz;
      parts[o + POSE_AXIS_Y] = yx;
      parts[o + POSE_AXIS_Y + 1] = yy;
      parts[o + POSE_AXIS_Y + 2] = yz;
      parts[o + POSE_AXIS_Z] = xy * yz - xz * yy;
      parts[o + POSE_AXIS_Z + 1] = xz * yx - xx * yz;
      parts[o + POSE_AXIS_Z + 2] = xx * yy - xy * yx;
      parts[o + POSE_HALF] = r.half[part * 3]!;
      parts[o + POSE_HALF + 1] = hy;
      parts[o + POSE_HALF + 2] = r.half[part * 3 + 2]!;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pezzi
  // -------------------------------------------------------------------------------------------

  /** Tutto il corpo in pezzi: ogni parte vola via, più pezzetti e tanto sangue. */
  private gib(k: KillSplatter): void {
    const parts = k.pose.parts;
    const t = PART_TORSO * PART_STRIDE + POSE_CENTER;
    const cx = parts[t]!;
    const cy = parts[t + 1]!;
    const cz = parts[t + 2]!;
    for (let part = 0; part < PART_COUNT; part++) {
      const piece = this.spawnPiece(k, part);
      if (!piece) continue;
      // Via dal centro del corpo e nella direzione del colpo.
      this.v1.set(piece.position.x - cx, piece.position.y - cy, piece.position.z - cz);
      if (this.v1.lengthSq() < 1e-4) this.v1.set(Math.random() - 0.5, 0.5, Math.random() - 0.5);
      this.v1.normalize().multiplyScalar(between(GORE.gibSpeed[0], GORE.gibSpeed[1]) * 0.6);
      const push = between(GORE.gibSpeed[0], GORE.gibSpeed[1]);
      piece.velocity.set(
        k.vx + this.v1.x + k.dx * push,
        k.vy + this.v1.y + k.dy * push + GORE.gibLift,
        k.vz + this.v1.z + k.dz * push,
      );
    }
    this.spray(KIND_BLOOD, cx, cy, cz, k.dx, k.dy + 0.6, k.dz, GORE.gibBlood, 1.1, GORE.gibBloodSpeed);
    for (let i = 0; i < GORE.gibChunks; i++) {
      this.v1.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      const s = between(GORE.gibSpeed[0], GORE.gibSpeed[1]);
      this.spawnParticle(
        KIND_CHUNK,
        cx,
        cy,
        cz,
        this.v1.x * s + k.dx * 3,
        this.v1.y * s + GORE.gibLift,
        this.v1.z * s + k.dz * 3,
        between(GORE.chunkSize[0], GORE.chunkSize[1]),
        GORE.chunkLife,
      );
    }
  }

  private spawnPiece(k: KillSplatter, part: number): Piece | null {
    let piece = this.pieces.find((p) => !p.active);
    if (!piece) piece = this.pieces.reduce((a, b) => (a.age > b.age ? a : b));
    const parts = k.pose.parts;
    const o = part * PART_STRIDE;
    piece.active = true;
    piece.part = part;
    piece.look = k.look;
    piece.age = 0;
    piece.trail = 0;
    piece.resting = false;
    piece.position.set(parts[o + POSE_CENTER]!, parts[o + POSE_CENTER + 1]!, parts[o + POSE_CENTER + 2]!);
    piece.half.set(parts[o + POSE_HALF]!, parts[o + POSE_HALF + 1]!, parts[o + POSE_HALF + 2]!);
    this.matrix.set(
      parts[o + POSE_AXIS_X]!,
      parts[o + POSE_AXIS_Y]!,
      parts[o + POSE_AXIS_Z]!,
      0,
      parts[o + POSE_AXIS_X + 1]!,
      parts[o + POSE_AXIS_Y + 1]!,
      parts[o + POSE_AXIS_Z + 1]!,
      0,
      parts[o + POSE_AXIS_X + 2]!,
      parts[o + POSE_AXIS_Y + 2]!,
      parts[o + POSE_AXIS_Z + 2]!,
      0,
      0,
      0,
      0,
      1,
    );
    piece.rotation.setFromRotationMatrix(this.matrix);
    piece.velocity.set(k.vx, k.vy, k.vz);
    piece.spin.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(GORE.gibSpin);
    return piece;
  }

  private updatePiece(piece: Piece, dt: number): void {
    piece.age += dt;
    if (piece.age > GORE.pieceLife + GORE.ragdollSinkTime) {
      piece.active = false;
      return;
    }
    if (piece.resting) return;
    const v = piece.velocity;
    v.y -= GORE.gravity * dt;
    const position = piece.position;
    position.addScaledVector(v, dt);
    // Rotazione.
    const spin = piece.spin.length();
    if (spin > 1e-4) {
      this.spinStep.setFromAxisAngle(this.v1.copy(piece.spin).divideScalar(spin), spin * dt);
      piece.rotation.premultiply(this.spinStep).normalize();
    }
    // Urto: un punto sotto il pezzo e uno nella direzione del moto, a distanza pari al raggio medio.
    const radius = (piece.half.x + piece.half.y + piece.half.z) / 3;
    for (let probe = 0; probe < 2; probe++) {
      const speed = v.length();
      if (probe === 1 && speed < 1e-3) break;
      const ox = probe === 0 ? 0 : (v.x / speed) * radius;
      const oy = probe === 0 ? -radius : (v.y / speed) * radius;
      const oz = probe === 0 ? 0 : (v.z / speed) * radius;
      const x = position.x + ox;
      const y = position.y + oy;
      const z = position.z + oz;
      const solid = solidAt(this.world, x, y, z);
      if (solid < 0) continue;
      const n = this.normal;
      const depth = solidExit(this.world.solids[solid]!, x, y, z, n);
      position.x += n.x * depth;
      position.y += n.y * depth;
      position.z += n.z * depth;
      const vn = v.x * n.x + v.y * n.y + v.z * n.z;
      if (vn < 0) {
        if (vn < -GORE.pieceSplatSpeed && this.level === 'full') {
          this.addDecal(x + n.x * depth, y + n.y * depth, z + n.z * depth, n.x, n.y, n.z, between(0.4, 0.8), 0);
        }
        v.x -= (1 + GORE.pieceBounce) * vn * n.x;
        v.y -= (1 + GORE.pieceBounce) * vn * n.y;
        v.z -= (1 + GORE.pieceBounce) * vn * n.z;
        v.multiplyScalar(GORE.pieceFriction);
        piece.spin.multiplyScalar(GORE.pieceSpinDamping);
      }
    }
    if (v.lengthSq() < GORE.pieceRestSpeed * GORE.pieceRestSpeed && piece.age > 0.3) {
      // A terra e quasi fermo: resta lì.
      const below = solidAt(this.world, position.x, position.y - radius - 0.05, position.z);
      if (below >= 0) piece.resting = true;
    }
    // Scia di sangue mentre vola.
    if (piece.age < GORE.trailTime && v.lengthSq() > 1) {
      piece.trail += dt * GORE.trailRate;
      while (piece.trail >= 1) {
        piece.trail -= 1;
        this.spawnParticle(
          KIND_BLOOD,
          position.x,
          position.y,
          position.z,
          v.x * 0.2 + (Math.random() - 0.5),
          v.y * 0.2,
          v.z * 0.2 + (Math.random() - 0.5),
          between(GORE.dropletSize[0], GORE.dropletSize[1]),
          GORE.dropletLife,
        );
      }
    }
  }

  /** Posa con la sola parte del pezzo, nella posizione e rotazione attuali. */
  private piecePose(piece: Piece): void {
    const parts = piece.pose.parts;
    const o = piece.part * PART_STRIDE;
    piece.pose.armed = false;
    this.matrix.makeRotationFromQuaternion(piece.rotation);
    const e = this.matrix.elements;
    // Colonne della matrice: assi X, Y, Z.
    parts[o + POSE_AXIS_X] = e[0]!;
    parts[o + POSE_AXIS_X + 1] = e[1]!;
    parts[o + POSE_AXIS_X + 2] = e[2]!;
    parts[o + POSE_AXIS_Y] = e[4]!;
    parts[o + POSE_AXIS_Y + 1] = e[5]!;
    parts[o + POSE_AXIS_Y + 2] = e[6]!;
    parts[o + POSE_AXIS_Z] = e[8]!;
    parts[o + POSE_AXIS_Z + 1] = e[9]!;
    parts[o + POSE_AXIS_Z + 2] = e[10]!;
    const p = piece.position;
    parts[o + POSE_CENTER] = p.x;
    parts[o + POSE_CENTER + 1] = p.y;
    parts[o + POSE_CENTER + 2] = p.z;
    parts[o + POSE_HALF] = piece.half.x;
    parts[o + POSE_HALF + 1] = piece.half.y;
    parts[o + POSE_HALF + 2] = piece.half.z;
    // Giunto: sotto il centro per testa e busto, sopra per gli arti.
    const sign = piece.part === PART_HEAD || piece.part === PART_TORSO ? -1 : 1;
    parts[o + POSE_PIVOT] = p.x + e[4]! * piece.half.y * sign;
    parts[o + POSE_PIVOT + 1] = p.y + e[5]! * piece.half.y * sign;
    parts[o + POSE_PIVOT + 2] = p.z + e[6]! * piece.half.y * sign;
  }
}

