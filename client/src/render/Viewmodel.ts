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
} from 'three';
import { MOVE, WEAPONS, horizontalSpeed, type Combatant } from '@blockstrike/shared';
import { VIEWMODEL } from '../config.ts';
import { BoxModelBuilder } from './boxModel.ts';
import { getWeaponModels, type WeaponModel } from './weaponModels.ts';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Braccia e mani che tengono l'arma. */
function createArms(model: WeaponModel): Mesh {
  const skin = '#e0b48a';
  const sleeve = '#2f4a6b';
  const r = model.rightHand;
  const l = model.leftHand;
  // Avambracci corti e inclinati verso il basso: escono subito dal bordo dello schermo.
  const geometry = new BoxModelBuilder()
    .box(r.x, r.y, r.z, 0.075, 0.075, 0.1, skin)
    .between(r.x + 0.01, r.y - 0.03, r.z + 0.04, r.x + 0.1, r.y - 0.32, r.z + 0.22, 0.085, sleeve)
    .box(l.x, l.y, l.z, 0.075, 0.07, 0.1, skin)
    .between(l.x - 0.01, l.y - 0.03, l.z + 0.04, l.x - 0.12, l.y - 0.34, l.z + 0.12, 0.085, sleeve)
    .build();
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }));
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

/**
 * Arma in prima persona, disegnata in una scena a parte sopra il mondo: non entra nei muri e
 * non si deforma con il campo visivo. Animazioni procedurali: oscillazione camminando, ritardo
 * rispetto alla visuale, contraccolpo, mira, ricarica ed estrazione.
 */
export class Viewmodel {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly root = new Group();
  private readonly weapons: Group[] = [];
  private readonly flashes: Mesh[] = [];
  private readonly models = getWeaponModels();
  private current = -1;
  private kick = 0;
  private kickVelocity = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private flashTimer = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private readonly temp = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(VIEWMODEL.fov, aspect, 0.01, 10);
    this.scene.add(new HemisphereLight('#dfeeff', '#6b5a45', 1.7));
    const sun = new DirectionalLight('#fff1dc', 2.1);
    sun.position.set(0.4, 1, 0.6);
    this.scene.add(sun, this.root);

    for (const model of this.models) {
      const group = new Group();
      group.add(new Mesh(model.geometry, new MeshLambertMaterial({ vertexColors: true })));
      group.add(createArms(model));
      const flash = createFlash();
      flash.position.copy(model.muzzle);
      group.add(flash);
      group.scale.setScalar(VIEWMODEL.scale);
      group.visible = false;
      this.flashes.push(flash);
      this.weapons.push(group);
      this.root.add(group);
    }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Colpo sparato: contraccolpo e fiammata. */
  onShot(weapon: number): void {
    const def = WEAPONS[weapon]!;
    this.kickVelocity += VIEWMODEL.kickImpulse * (0.6 + Math.min(1.6, def.recoil.pattern[0]![0] / 2));
    this.flashTimer = def.kind === 'hitscan' ? VIEWMODEL.flashTime : VIEWMODEL.flashTime * 1.6;
    const flash = this.flashes[weapon]!;
    flash.rotation.z = Math.random() * Math.PI;
    flash.scale.setScalar(0.8 + Math.random() * 0.5);
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
      if (this.current >= 0) this.weapons[this.current]!.visible = false;
      this.current = w.current;
    }
    const group = this.weapons[this.current]!;
    group.visible = visible;
    const model = this.models[this.current]!;
    const def = WEAPONS[this.current]!;

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
    const y = hip[1] + (-model.sightY * VIEWMODEL.scale - hip[1]) * eased;
    const z = hip[2] + (-model.adsDistance - hip[2]) * eased;

    // Estrazione e ricarica.
    const draw = def.drawTime > 0 ? 1 - w.drawTimer / def.drawTime : 1;
    const drawOffset = 1 - easeInOut(Math.min(1, Math.max(0, draw)));
    const reload = w.reloadTimer > 0 ? 1 - w.reloadTimer / def.reloadTime : 0;
    const dip = w.reloadTimer > 0 ? smoothstep(0, 0.2, reload) * (1 - smoothstep(0.8, 1, reload)) : 0;
    const slideTilt = p.sliding ? 1 : 0;

    group.position.set(
      x + bobX + this.swayX,
      y + bobY + this.swayY - drawOffset * 0.3 - dip * 0.12,
      z + this.kick * 0.6,
    );
    group.rotation.set(
      this.kick * 2.2 - drawOffset * 0.7 - dip * 0.55 + this.swayY * 2,
      this.swayX * 2,
      dip * 0.45 + slideTilt * 0.12 * (1 - ads),
    );

    this.flashTimer -= dt;
    this.flashes[this.current]!.visible = visible && this.flashTimer > 0;
  }

  /** Posizione nel mondo di un punto del modello (bocca o espulsione), per traccianti e bossoli. */
  worldPoint(worldCamera: Camera, which: 'muzzle' | 'eject', out: Vector3): Vector3 | null {
    if (this.current < 0) return null;
    const model = this.models[this.current]!;
    const local = which === 'muzzle' ? model.muzzle : model.eject;
    if (!local) return null;
    const group = this.weapons[this.current]!;
    group.updateMatrixWorld();
    this.temp.copy(local).applyMatrix4(group.matrixWorld);
    worldCamera.updateMatrixWorld();
    return out.copy(this.temp).applyMatrix4(worldCamera.matrixWorld);
  }
}
