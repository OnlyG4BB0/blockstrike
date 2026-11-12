import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Mesh,
} from 'three';
import {
  CollisionWorld,
  TICK_DT,
  copyPlayerState,
  createInput,
  createPlayerState,
  horizontalSpeed,
  simulateTick,
  spawnPlayer,
  type MapData,
  type PlayerState,
} from '@blockstrike/shared';
import { RENDER, VIEW } from '../config.ts';
import { Input } from '../input/Input.ts';
import { createBlockTexture } from '../render/blockTexture.ts';
import { createMapMesh } from '../render/mapMesh.ts';
import { createSky } from '../render/sky.ts';
import { SENSITIVITY_SCALE, loadSettings, saveSettings, type Settings } from '../settings.ts';
import { Hud } from '../ui/Hud.ts';
import { Menu } from '../ui/Menu.ts';
import { CameraRig } from './CameraRig.ts';

/** Oltre questo numero di tick in un fotogramma si rinuncia a recuperare (es. scheda in pausa). */
const MAX_TICKS_PER_FRAME = 8;
/** Un fotogramma più lungo di così viene accorciato. */
const MAX_FRAME_TIME = 0.25;

/**
 * Ciclo di gioco: simulazione a passo fisso (60 Hz, codice condiviso) e disegno a ogni
 * fotogramma, con interpolazione tra gli ultimi due stati per un movimento fluido a qualsiasi
 * frequenza dello schermo.
 */
export class Game {
  readonly map: MapData;
  readonly world: CollisionWorld;
  readonly player: PlayerState = createPlayerState();
  readonly input: Input;
  tickCount = 0;

  private readonly previous: PlayerState = createPlayerState();
  private readonly command = createInput();
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sky: Mesh;
  private readonly rig = new CameraRig();
  private readonly hud = new Hud();
  private readonly menu: Menu;
  private settings: Settings;
  private accumulator = 0;
  private lastFrame = 0;
  private peakSpeed = 0;
  private appliedFov = 0;
  private appliedAspect = 0;

  constructor(container: HTMLElement, map: MapData) {
    this.map = map;
    this.world = CollisionWorld.fromBlocks(map.blocks);
    this.settings = loadSettings();

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, VIEW.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.prepend(this.renderer.domElement);

    this.camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, VIEW.nearPlane, VIEW.farPlane);
    this.camera.rotation.order = 'YXZ';

    this.sky = createSky(map);
    this.buildScene();

    this.input = new Input(this.renderer.domElement);
    this.applySettings(this.settings);

    this.menu = new Menu(this.settings);
    this.menu.onPlay = () => void this.input.requestLock();
    this.menu.onChange = (settings) => {
      this.applySettings(settings);
      saveSettings(settings);
    };
    this.input.onLockChange = (locked) => (locked ? this.menu.hide() : this.menu.show());
    this.input.onLockError = () => this.menu.showLockError();

    window.addEventListener('resize', this.handleResize);
  }

  start(): void {
    this.respawn();
    requestAnimationFrame(this.frame);
  }

  /** Riporta il giocatore al punto di rinascita. */
  respawn(): void {
    const spawn = this.map.spawns[0]!;
    spawnPlayer(this.player, spawn);
    copyPlayerState(this.previous, this.player);
    this.input.setLook(this.player.yaw, 0);
    this.rig.reset(this.player);
    this.peakSpeed = 0;
  }

  private buildScene(): void {
    const { map, scene } = this;
    scene.background = new Color(map.fog.color);
    scene.fog = new Fog(new Color(map.fog.color), map.fog.near, map.fog.far);
    scene.add(this.sky);

    const texture = createBlockTexture(this.renderer.capabilities.getMaxAnisotropy());
    scene.add(createMapMesh(map, texture));

    scene.add(new HemisphereLight(new Color(map.ambient.sky), new Color(map.ambient.ground), map.ambient.intensity));

    // Il sole copre tutta la mappa con una sola mappa d'ombra.
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const block of map.blocks) {
      min.min(new Vector3(...block.pos));
      max.max(new Vector3(block.pos[0] + block.size[0], block.pos[1] + block.size[1], block.pos[2] + block.size[2]));
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = max.clone().sub(min).length() * 0.5;
    const direction = new Vector3(...map.sun.direction).normalize();

    const sun = new DirectionalLight(new Color(map.sun.color), map.sun.intensity);
    sun.position.copy(center).addScaledVector(direction, -radius * 1.5);
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const shadowCamera = sun.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.near = 0.5;
    shadowCamera.far = radius * 3.5;
    shadowCamera.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    this.input.radiansPerPixel = settings.sensitivity * SENSITIVITY_SCALE;
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = this.lastFrame === 0 ? 0 : Math.min((now - this.lastFrame) / 1000, MAX_FRAME_TIME);
    this.lastFrame = now;

    this.accumulator += dt;
    let ticks = 0;
    while (this.accumulator >= TICK_DT) {
      this.tick();
      this.accumulator -= TICK_DT;
      if (++ticks >= MAX_TICKS_PER_FRAME) {
        this.accumulator = 0;
        break;
      }
    }
    this.render(dt, this.accumulator / TICK_DT);
  };

  private tick(): void {
    if (this.input.consumeRespawn()) this.respawn();

    this.input.sample(this.command);
    copyPlayerState(this.previous, this.player);
    simulateTick(this.player, this.command, this.world);
    this.tickCount++;

    const p = this.player;
    if (p.stepDelta !== 0) {
      // Lo spostamento istantaneo non va interpolato: lo ammorbidisce la telecamera.
      this.previous.y += p.stepDelta;
      this.rig.onStep(p.stepDelta);
    }
    if (p.landingSpeed > 0) this.rig.onLand(p.landingSpeed);
    if (p.y < this.map.killY) this.respawn();
    this.peakSpeed = Math.max(this.peakSpeed, horizontalSpeed(p));
  }

  private render(dt: number, alpha: number): void {
    const p = this.player;
    const q = this.previous;
    this.rig.update(dt, p, this.settings.dynamicFov);

    const x = q.x + (p.x - q.x) * alpha;
    const y = q.y + (p.y - q.y) * alpha;
    const z = q.z + (p.z - q.z) * alpha;
    this.camera.position.set(x, y + this.rig.eyeOffset, z);
    // La visuale usa l'ultima posizione del mouse, non quella dell'ultimo tick: zero ritardo.
    this.camera.rotation.set(this.input.pitch, this.input.yaw, this.rig.roll, 'YXZ');
    this.updateProjection();
    this.sky.position.copy(this.camera.position);

    this.renderer.render(this.scene, this.camera);
    this.hud.update(dt, p, this.peakSpeed, this.settings, this.settings.showDebug ? this.debugText() : '');
  }

  /** Converte il campo visivo orizzontale delle impostazioni in quello verticale della telecamera. */
  private updateProjection(): void {
    const horizontal = Math.min(this.settings.fov + this.rig.fovBoost, VIEW.maxFov);
    const aspect = window.innerWidth / window.innerHeight;
    if (Math.abs(horizontal - this.appliedFov) < 0.01 && aspect === this.appliedAspect) return;
    this.appliedFov = horizontal;
    this.appliedAspect = aspect;
    const halfWidth = Math.tan(MathUtils.degToRad(horizontal) / 2);
    this.camera.fov = MathUtils.radToDeg(2 * Math.atan(halfWidth / aspect));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private debugText(): string {
    const p = this.player;
    const f = (value: number) => value.toFixed(2).padStart(7);
    return [
      `pos    ${f(p.x)} ${f(p.y)} ${f(p.z)}`,
      `vel    ${f(p.vx)} ${f(p.vy)} ${f(p.vz)}`,
      `suolo  ${p.grounded ? 'sì' : 'no'}   pendenza ${f(p.groundGradX)} ${f(p.groundGradZ)}`,
      `stato  ${p.sliding ? 'scivolata' : p.crouched ? 'accovacciato' : 'in piedi'}`,
      `tick   ${this.tickCount}   chiamate di disegno ${this.renderer.info.render.calls}`,
    ].join('\n');
  }

  private readonly handleResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateProjection();
  };
}
