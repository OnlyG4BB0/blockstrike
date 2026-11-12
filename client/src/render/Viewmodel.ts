import {
  AdditiveBlending,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import { MOVE, horizontalSpeed, type Combatant, type PartRole, type WeaponDef, type WeaponModelDef } from '@blockstrike/shared';
import { VIEWMODEL } from '../config.ts';
import { BoxModelBuilder } from './boxModel.ts';
import type { ModelLibrary } from './weaponModels.ts';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Mano e avambraccio: avambracci corti e inclinati verso il basso, escono subito dallo schermo. */
function createArm(def: WeaponModelDef, side: 'right' | 'left', material: Material): Mesh {
  const skin = '#e0b48a';
  const sleeve = '#2f4a6b';
  const [x, y, z] = def.hands[side];
  const builder = new BoxModelBuilder().box(x, y, z, 0.075, 0.075, 0.1, skin);
  if (side === 'right') builder.between(x + 0.01, y - 0.03, z + 0.04, x + 0.1, y - 0.32, z + 0.22, 0.085, sleeve);
  else builder.between(x - 0.01, y - 0.03, z + 0.04, x - 0.12, y - 0.34, z + 0.12, 0.085, sleeve);
  return new Mesh(builder.build(), material);
}

/** Fiammata alla bocca: tre piani incrociati che si sommano alla luce. */
function createFlash(): Mesh {
  const material = new MeshBasicMaterial({
    color: '#ffd27a',
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const flash = new Mesh(new PlaneGeometry(0.16, 0.16), material);
  const cross1 = new Mesh(new PlaneGeometry(0.1, 0.32), material);
  cross1.rotation.y = Math.PI / 2;
  cross1.rotation.z = Math.PI / 2;
  cross1.position.z = -0.12;
  const cross2 = new Mesh(new PlaneGeometry(0.32, 0.1), material);
  cross2.rotation.x = Math.PI / 2;
  cross2.position.z = -0.12;
  flash.add(cross1, cross2);
  flash.visible = false;
  return flash;
}

interface WeaponRig {
  group: Group;
  def: WeaponModelDef;
  /** Parti animate, ciascuna in un gruppo con il perno al centro. */
  roles: Map<PartRole, { group: Group; pivot: Vector3 }>;
  leftArm: Mesh;
  flash: Mesh;
  skin: string | null;
  cylinderShots: number;
  cylinderAngle: number;
}

/**
 * Arma in prima persona, disegnata in una scena a parte sopra il mondo: non entra nei muri e
 * non si deforma con il campo visivo. Animazioni procedurali: oscillazione camminando, ritardo
 * rispetto alla visuale, contraccolpo, mira, ricarica ed estrazione, più quelle delle parti
 * (caricatore, carrello, pompa, otturatore, tamburo) e il fendente del coltello.
 */
export class Viewmodel {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly root = new Group();
  private readonly rigs: WeaponRig[] = [];
  private readonly library: ModelLibrary;
  private readonly weapons: readonly WeaponDef[];
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private current = -1;
  private kick = 0;
  private kickVelocity = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private flashTimer = 0;
  private slashTime = -1;
  private lastYaw = 0;
  private lastPitch = 0;
  private readonly temp = new Vector3();

  constructor(aspect: number, library: ModelLibrary, weapons: readonly WeaponDef[], skins: Readonly<Record<string, string>>) {
    this.library = library;
    this.weapons = weapons;
    this.camera = new PerspectiveCamera(VIEWMODEL.fov, aspect, 0.01, 10);
    this.scene.add(new HemisphereLight('#dfeeff', '#6b5a45', 1.7));
    const sun = new DirectionalLight('#fff1dc', 2.1);
    sun.position.set(0.4, 1, 0.6);
    this.scene.add(sun, this.root);
    weapons.forEach((def, index) => {
      const rig = this.buildRig(def, skins[def.id] ?? null);
      this.rigs[index] = rig;
      this.root.add(rig.group);
    });
  }

  private buildRig(def: WeaponDef, skin: string | null): WeaponRig {
    const parts = this.library.parts(def.model, skin);
    const group = new Group();
    group.add(new Mesh(parts.body, this.material));
    const roles = new Map<PartRole, { group: Group; pivot: Vector3 }>();
    for (const [role, part] of parts.animated) {
      const pivotGroup = new Group();
      pivotGroup.position.copy(part.pivot);
      pivotGroup.add(new Mesh(part.geometry, this.material));
      group.add(pivotGroup);
      roles.set(role, { group: pivotGroup, pivot: part.pivot.clone() });
    }
    group.add(createArm(parts.def, 'right', this.material));
    const leftArm = createArm(parts.def, 'left', this.material);
    group.add(leftArm);
    const flash = createFlash();
    flash.position.set(...parts.def.muzzle);
    group.add(flash);
    group.scale.setScalar(VIEWMODEL.scale);
    group.visible = false;
    return { group, def: parts.def, roles, leftArm, flash, skin, cylinderShots: 0, cylinderAngle: 0 };
  }

  /** Cambia la skin di un'arma (ricostruisce il suo modello in prima persona). */
  setSkin(weaponIndex: number, skin: string | null): void {
    const old = this.rigs[weaponIndex];
    if (!old || old.skin === skin) return;
    const rig = this.buildRig(this.weapons[weaponIndex]!, skin);
    rig.group.visible = old.group.visible;
    this.root.remove(old.group);
    this.root.add(rig.group);
    this.rigs[weaponIndex] = rig;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Colpo sparato: contraccolpo e fiammata, oppure fendente per le armi corpo a corpo. */
  onShot(weapon: number): void {
    const def = this.weapons[weapon]!;
    const rig = this.rigs[weapon]!;
    if (def.kind === 'melee') {
      this.slashTime = 0;
      return;
    }
    this.kickVelocity += VIEWMODEL.kickImpulse * (0.6 + Math.min(1.6, def.recoil.pattern[0]![0] / 2));
    this.flashTimer = def.kind === 'hitscan' ? VIEWMODEL.flashTime : VIEWMODEL.flashTime * 1.6;
    rig.flash.rotation.z = Math.random() * Math.PI;
    rig.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    rig.cylinderShots++;
  }

  /**
   * @param ads quanto si sta mirando (0-1, già interpolato)
   * @param visible false quando si è morti o si guarda nel mirino ottico
   */
  update(dt: number, c: Combatant, yaw: number, pitch: number, ads: number, visible: boolean): void {
    const step = Math.min(dt, 0.05);
    const w = c.weapon;
    const p = c.player;
    if (w.current !== this.current) {
      if (this.current >= 0) this.rigs[this.current]!.group.visible = false;
      this.current = w.current;
      this.slashTime = -1;
    }
    const rig = this.rigs[this.current]!;
    const group = rig.group;
    group.visible = visible;
    const model = rig.def;
    const def = this.weapons[this.current]!;

    // Contraccolpo: molla che riporta l'arma in posizione.
    this.kickVelocity += (-VIEWMODEL.kickStiffness * this.kick - VIEWMODEL.kickDamping * this.kickVelocity) * step;
    this.kick += this.kickVelocity * step;

    // Ritardo rispetto alla visuale.
    let dYaw = yaw - this.lastYaw;
    dYaw -= Math.PI * 2 * Math.round(dYaw / (Math.PI * 2));
    const dPitch = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    const swayScale = 1 - ads * 0.85;
    const follow = 1 - Math.exp(-VIEWMODEL.swaySmoothing * step);
    const targetSwayX = Math.max(-VIEWMODEL.maxSway, Math.min(VIEWMODEL.maxSway, dYaw * VIEWMODEL.swayAmount)) * swayScale;
    const targetSwayY = Math.max(-VIEWMODEL.maxSway, Math.min(VIEWMODEL.maxSway, -dPitch * VIEWMODEL.swayAmount)) * swayScale;
    this.swayX += (targetSwayX - this.swayX) * follow;
    this.swayY += (targetSwayY - this.swayY) * follow;

    // Oscillazione camminando.
    const speed = horizontalSpeed(p);
    const walking = p.grounded && !p.sliding ? Math.min(1, speed / MOVE.runSpeed) : 0;
    this.bobAmount += (walking - this.bobAmount) * (1 - Math.exp(-8 * step));
    this.bobPhase += step * (4 + speed * 1.1);
    const bob = this.bobAmount * (1 - ads * 0.8);
    const bobX = Math.sin(this.bobPhase) * VIEWMODEL.bobX * bob;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * VIEWMODEL.bobY * bob;

    // Posizione: dal fianco al centro mirando.
    const hip = VIEWMODEL.hipPosition;
    const eased = easeInOut(ads);
    const x = hip[0] + (0 - hip[0]) * eased;
    const y = hip[1] + (-model.sight.height * VIEWMODEL.scale - hip[1]) * eased;
    const z = hip[2] + (-model.sight.distance - hip[2]) * eased;

    // Estrazione e ricarica (più leggera se il caricatore ha la sua animazione).
    const draw = def.drawTime > 0 ? 1 - w.drawTimer / def.drawTime : 1;
    const drawOffset = 1 - easeInOut(Math.min(1, Math.max(0, draw)));
    const reload = w.reloadTimer > 0 && def.reloadTime > 0 ? 1 - w.reloadTimer / def.reloadTime : 0;
    const dipScale = rig.roles.has('magazine') ? 0.5 : 1;
    const dip = w.reloadTimer > 0 ? smoothstep(0, 0.2, reload) * (1 - smoothstep(0.8, 1, reload)) * dipScale : 0;
    const slideTilt = p.sliding ? 1 : 0;

    // Fendente del coltello: da destra verso sinistra.
    let slashX = 0;
    let slashY = 0;
    let slashYaw = 0;
    let slashRoll = 0;
    if (this.slashTime >= 0) {
      this.slashTime += dt;
      const t = this.slashTime / VIEWMODEL.slashTime;
      if (t >= 1) {
        this.slashTime = -1;
      } else {
        const swing = Math.sin(t * Math.PI);
        slashX = -swing * 0.2 + (t < 0.2 ? (0.2 - t) * 0.3 : 0);
        slashY = swing * 0.04;
        slashYaw = swing * 0.9;
        slashRoll = swing * 0.7;
      }
    }

    group.position.set(
      x + bobX + this.swayX + slashX,
      y + bobY + this.swayY - drawOffset * 0.3 - dip * 0.12 + slashY,
      z + this.kick * 0.6,
    );
    group.rotation.set(
      this.kick * 2.2 - drawOffset * 0.7 - dip * 0.55 + this.swayY * 2,
      this.swayX * 2 + slashYaw,
      dip * 0.45 + slideTilt * 0.12 * (1 - ads) + slashRoll,
    );

    this.animateParts(rig, c, def, reload, dt);

    this.flashTimer -= dt;
    rig.flash.visible = visible && this.flashTimer > 0;
  }

  /** Animazioni delle parti, guidate dallo stato dell'arma nella simulazione. */
  private animateParts(rig: WeaponRig, c: Combatant, def: WeaponDef, reload: number, dt: number): void {
    const w = c.weapon;
    const since = w.sinceShot;
    const interval = 60 / def.fireRate;
    const reloading = w.reloadTimer > 0;

    const slide = rig.roles.get('slide');
    if (slide) {
      // Indietro di colpo allo sparo, poi torna; resta aperto a caricatore vuoto.
      const back = Math.min(0.09, interval * 0.7);
      const empty = def.magazine > 0 && w.ammo[w.current] === 0;
      const offset = empty || reloading ? 1 : since < back ? 1 - since / back : 0;
      slide.group.position.z = slide.pivot.z + offset * VIEWMODEL.slideTravel;
    }

    const pump = rig.roles.get('pump');
    let pumpOffset = 0;
    if (pump) {
      const t = (since - 0.12) / 0.4;
      pumpOffset = t > 0 && t < 1 ? Math.sin(t * Math.PI) * VIEWMODEL.pumpTravel : 0;
      pump.group.position.z = pump.pivot.z + pumpOffset;
    }
    rig.leftArm.position.z = pumpOffset;

    const bolt = rig.roles.get('bolt');
    if (bolt) {
      // Otturatore: si alza, va indietro, torna avanti e si abbassa.
      const t = (since - 0.3) / Math.max(0.5, interval - 0.45);
      const lift = smoothstep(0, 0.2, t) * (1 - smoothstep(0.8, 1, t));
      const pull = smoothstep(0.2, 0.45, t) * (1 - smoothstep(0.55, 0.8, t));
      bolt.group.rotation.z = -lift * 1.2;
      bolt.group.position.z = bolt.pivot.z + pull * VIEWMODEL.boltTravel;
    }

    const cylinder = rig.roles.get('cylinder');
    if (cylinder) {
      if (reloading) rig.cylinderAngle += dt * 12;
      else {
        const target = rig.cylinderShots * (Math.PI / 3);
        rig.cylinderAngle += (target - rig.cylinderAngle) * (1 - Math.exp(-25 * dt));
      }
      cylinder.group.rotation.z = -rig.cylinderAngle;
    }

    const magazine = rig.roles.get('magazine');
    if (magazine) {
      // Il caricatore esce verso il basso e rientra durante la ricarica.
      const drop = reloading ? smoothstep(0.1, 0.35, reload) * (1 - smoothstep(0.55, 0.85, reload)) : 0;
      magazine.group.position.y = magazine.pivot.y - drop * VIEWMODEL.magazineDrop;
      magazine.group.rotation.x = drop * 0.4;
      magazine.group.visible = drop < 0.95;
    }
  }

  /** Posizione nel mondo di un punto del modello (bocca o espulsione), per traccianti e bossoli. */
  worldPoint(worldCamera: Camera, which: 'muzzle' | 'eject', out: Vector3): Vector3 | null {
    if (this.current < 0) return null;
    const rig = this.rigs[this.current]!;
    const local = which === 'muzzle' ? rig.def.muzzle : rig.def.eject;
    if (!local) return null;
    rig.group.updateMatrixWorld();
    this.temp.set(local[0], local[1], local[2]).applyMatrix4(rig.group.matrixWorld);
    worldCamera.updateMatrixWorld();
    return out.copy(this.temp).applyMatrix4(worldCamera.matrixWorld);
  }
}
