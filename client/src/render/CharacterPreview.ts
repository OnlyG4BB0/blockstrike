/**
 * Anteprima 3D del personaggio nella schermata di scelta: ruota lentamente e mostra a turno le
 * animazioni (fermo, corsa, accovacciato, sparo, ricarica, salto) con la classe e la skin scelte.
 * Usa un proprio renderer sul canvas del menu e disegna solo quando il menu è aperto.
 */
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { BodyPose, createAnimState, poseBody, type AnimState, type WeaponGrip } from '@blockstrike/shared';
import { PREVIEW } from '../config.ts';
import { CharacterRenderer, type CharacterLook } from './CharacterRenderer.ts';

interface DemoStep {
  label: string;
  /** Pesi a cui tende l'animazione in questo passo. */
  run: number;
  crouch: number;
  air: number;
  fall: number;
  fire: boolean;
  reload: boolean;
}

const DEMO: readonly DemoStep[] = [
  { label: 'fermo', run: 0, crouch: 0, air: 0, fall: 0, fire: false, reload: false },
  { label: 'corsa', run: 1, crouch: 0, air: 0, fall: 0, fire: false, reload: false },
  { label: 'sparo', run: 0, crouch: 0, air: 0, fall: 0, fire: true, reload: false },
  { label: 'ricarica', run: 0, crouch: 0, air: 0, fall: 0, fire: false, reload: true },
  { label: 'accovacciato', run: 0, crouch: 1, air: 0, fall: 0, fire: false, reload: false },
  { label: 'salto', run: 0, crouch: 0, air: 1, fall: 0, fire: false, reload: false },
  { label: 'caduta', run: 0, crouch: 0, air: 1, fall: 1, fire: false, reload: false },
];

function approach(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

export class CharacterPreview {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(PREVIEW.fov, 1, 0.1, 30);
  private readonly characters = new CharacterRenderer(1);
  private readonly anim: AnimState = createAnimState();
  private readonly pose = new BodyPose();
  private readonly grips: readonly WeaponGrip[];
  private readonly canvas: HTMLCanvasElement;
  private look: CharacterLook | null = null;
  private time = 0;
  private sinceShot = 1;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement, grips: readonly WeaponGrip[]) {
    this.canvas = canvas;
    this.grips = grips;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(new AmbientLight(new Color('#c9d6ff'), 1.1));
    const sun = new DirectionalLight(new Color('#fff4e0'), 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const pedestal = new Mesh(new BoxGeometry(1.3, 0.12, 1.3), new MeshLambertMaterial({ color: new Color('#2a3142') }));
    pedestal.position.y = -0.06;
    this.scene.add(pedestal, this.characters.object);
    this.camera.position.set(0, PREVIEW.cameraHeight, PREVIEW.cameraDistance);
    this.camera.lookAt(0, PREVIEW.targetHeight, 0);
  }

  /** Aspetto e arma (indice nell'elenco delle armi) da mostrare. */
  setLook(look: CharacterLook, weapon: number): void {
    this.look = look;
    this.anim.weapon = weapon;
  }

  /** Disegna un fotogramma; restituisce il nome dell'animazione mostrata. */
  render(dt: number): string {
    this.resize();
    this.time += dt;
    const step = DEMO[Math.floor(this.time / PREVIEW.stepTime) % DEMO.length]!;
    const a = this.anim;
    a.yaw = this.time * PREVIEW.turnSpeed;
    a.pitch = 0;
    a.run = approach(a.run, step.run, 8, dt);
    a.crouch = approach(a.crouch, step.crouch, 10, dt);
    a.air = approach(a.air, step.air, 8, dt);
    a.fall = approach(a.fall, step.fall, 8, dt);
    a.phase = (a.phase + dt * a.run * PREVIEW.runCycle) % (Math.PI * 2);
    a.clock = (a.clock + dt) % 60;
    // Sparo: un colpo ogni tanto; ricarica: avanza e ricomincia.
    this.sinceShot += dt;
    if (step.fire && this.sinceShot > PREVIEW.shotInterval) this.sinceShot = 0;
    a.fire = this.sinceShot === 0 ? 1 : a.fire * Math.exp(-12 * dt);
    a.ready = approach(a.ready, step.fire || step.reload ? 1 : 0, 8, dt);
    a.reloadWeight = approach(a.reloadWeight, step.reload ? 1 : 0, 10, dt);
    a.reload = step.reload ? (this.time % PREVIEW.stepTime) / PREVIEW.stepTime : 0;
    a.y = a.air * PREVIEW.jumpLift * (1 - a.fall * 0.5);

    this.characters.begin();
    if (this.look) {
      poseBody(this.pose, a, this.grips);
      this.characters.add(this.pose, this.look, a.weapon, { hurt: 0, fall: 0, sink: 0 });
    }
    this.characters.end();
    this.renderer.render(this.scene, this.camera);
    return step.label;
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
