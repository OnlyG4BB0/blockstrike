/**
 * Anteprima 3D del personaggio nella schermata di scelta: ruota lentamente (o la si gira trascinando)
 * e mostra a turno le animazioni (fermo, cammino, corsa, passi di lato, sparo, ricarica, accovacciato,
 * salto e atterraggio) con la classe e la skin scelte.
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
import { ANIM, BodyPose, MOVE, createAnimState, poseBody, type AnimState, type WeaponGrip } from '@blockstrike/shared';
import { PREVIEW } from '../config.ts';
import { CharacterRenderer, type CharacterLook } from './CharacterRenderer.ts';

interface DemoStep {
  label: string;
  /** Pesi a cui tende l'animazione in questo passo. */
  run: number;
  lean?: number;
  back?: boolean;
  crouch?: number;
  air?: number;
  fall?: number;
  fire?: boolean;
  reload?: boolean;
}

const DEMO: readonly DemoStep[] = [
  { label: 'fermo', run: 0 },
  { label: 'cammino', run: 0.35 },
  { label: 'corsa', run: 1 },
  { label: 'di lato', run: 0.7, lean: 0.7 },
  { label: 'indietro', run: 0.45, back: true },
  { label: 'sparo', run: 0, fire: true },
  { label: 'ricarica', run: 0, reload: true },
  { label: 'accovacciato', run: 0.3, crouch: 1 },
  { label: 'salto', run: 0, air: 1 },
  { label: 'caduta', run: 0, air: 1, fall: 1 },
  { label: 'atterraggio', run: 0 },
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
  /** Rotazione data trascinando l'anteprima, e se la si sta trascinando ora. */
  private turn = 0;
  private spin = 0;
  private dragging = false;

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
    // Trascinando si gira il personaggio; lasciandolo riprende a ruotare da solo.
    let lastX = 0;
    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.turn += (event.clientX - lastX) * PREVIEW.dragTurn;
      lastX = event.clientX;
    });
    const release = (): void => {
      this.dragging = false;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  /** Mostra subito un'animazione (per esempio lo sparo quando si cambia classe). */
  show(label: string): void {
    const index = DEMO.findIndex((step) => step.label === label);
    if (index >= 0) this.time = index * PREVIEW.stepTime;
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
    if (!this.dragging) this.spin += dt * PREVIEW.turnSpeed;
    a.yaw = this.spin + this.turn;
    a.pitch = 0;
    a.run = approach(a.run, step.run, 8, dt);
    a.lean = approach(a.lean, step.lean ?? 0, 8, dt);
    a.back = step.back ? 1 : 0;
    a.crouch = approach(a.crouch, step.crouch ?? 0, 10, dt);
    a.air = approach(a.air, step.air ?? 0, ANIM.airRate, dt);
    a.fall = approach(a.fall, step.fall ?? 0, ANIM.fallRate, dt);
    // Il passo avanza come in partita: più corto camminando, più lungo in corsa.
    const stride = ANIM.walkStride + (ANIM.strideLength - ANIM.walkStride) * a.run;
    a.phase = (a.phase + (dt * a.run * MOVE.runSpeed * Math.PI * 2) / stride) % (Math.PI * 2);
    a.clock = (a.clock + dt) % 60;
    // Sparo: un colpo ogni tanto; ricarica: avanza e ricomincia.
    this.sinceShot += dt;
    if (step.fire && this.sinceShot > PREVIEW.shotInterval) this.sinceShot = 0;
    a.fire = this.sinceShot === 0 ? 1 : a.fire * Math.exp(-12 * dt);
    a.ready = approach(a.ready, step.fire || step.reload ? 1 : 0, 8, dt);
    a.reloadWeight = approach(a.reloadWeight, step.reload ? 1 : 0, 10, dt);
    a.reload = step.reload ? (this.time % PREVIEW.stepTime) / PREVIEW.stepTime : 0;
    a.y = a.air * PREVIEW.jumpLift * (1 - a.fall * 0.5);
    const sinceBlink = this.time % 3.1;
    const blink = sinceBlink < 0.13 ? Math.sin((sinceBlink / 0.13) * Math.PI) : 0;

    this.characters.begin();
    if (this.look) {
      poseBody(this.pose, a, this.grips);
      this.characters.add(this.pose, this.look, a.weapon, { hurt: 0, fall: 0, sink: 0, blink });
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
