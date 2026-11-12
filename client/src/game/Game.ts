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
  GRENADE,
  KILLED_BY_FALL,
  KILLED_BY_GRENADE,
  MOVE,
  Match,
  SHOT_WORLD,
  TICK_DT,
  WEAPONS,
  copyPlayerState,
  createPlayerState,
  currentSpread,
  horizontalSpeed,
  lineOfSight,
  type Combatant,
  type MapData,
  type PlayerState,
} from '@blockstrike/shared';
import { AudioSystem } from '../audio/AudioSystem.ts';
import type { SoundName } from '../audio/sounds.ts';
import { AUDIO, CHARACTERS, EFFECTS, RENDER, VIEW, VIEWMODEL } from '../config.ts';
import { Input } from '../input/Input.ts';
import { createBlockTexture } from '../render/blockTexture.ts';
import { CharacterView, colorsFor } from '../render/CharacterView.ts';
import { Effects } from '../render/Effects.ts';
import { createMapMesh } from '../render/mapMesh.ts';
import { createSky } from '../render/sky.ts';
import { Viewmodel } from '../render/Viewmodel.ts';
import { SENSITIVITY_SCALE, loadSettings, saveSettings, type Settings } from '../settings.ts';
import { Hud, type LabelData, type ScoreRow, type ScreenPoint } from '../ui/Hud.ts';
import { Menu } from '../ui/Menu.ts';
import { CameraRig } from './CameraRig.ts';

/** Oltre questo numero di tick in un fotogramma si rinuncia a recuperare (es. scheda in pausa). */
const MAX_TICKS_PER_FRAME = 8;
/** Un fotogramma più lungo di così viene accorciato. */
const MAX_FRAME_TIME = 0.25;
const LOCAL_NAME = 'Tu';

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function weaponLabel(index: number): string {
  if (index === KILLED_BY_FALL) return 'caduta';
  if (index === KILLED_BY_GRENADE) return GRENADE.name;
  return WEAPONS[index]?.name ?? '?';
}

/**
 * Ciclo di gioco: la partita (codice condiviso) avanza a passo fisso di 60 Hz; a ogni fotogramma
 * si disegna interpolando tra gli ultimi due stati, e gli eventi della partita diventano effetti,
 * suoni e segnali sull'HUD.
 */
export class Game {
  readonly match: Match;
  readonly local: Combatant;
  readonly input: Input;
  /** Solo per le prove: fa avanzare la partita anche senza il puntatore bloccato. */
  forceRun = false;

  private readonly previous = new Map<number, PlayerState>();
  private prevRecoilPitch = 0;
  private prevRecoilYaw = 0;
  private prevAds = 0;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sky: Mesh;
  private readonly rig = new CameraRig();
  private readonly hud = new Hud();
  private readonly menu: Menu;
  private readonly viewmodel: Viewmodel;
  private readonly effects: Effects;
  private readonly audio = new AudioSystem();
  private readonly characters = new Map<number, CharacterView>();
  private readonly footsteps = new Map<number, number>();
  private settings: Settings;
  private accumulator = 0;
  private lastFrame = 0;
  private peakSpeed = 0;
  private appliedFov = 0;
  private appliedAspect = 0;
  private deathTime = 0;
  private readonly labels: LabelData[] = [];
  private readonly temp = new Vector3();
  private readonly temp2 = new Vector3();
  private readonly projected = new Vector3();

  constructor(container: HTMLElement, map: MapData) {
    this.settings = loadSettings();
    this.match = new Match(map, { seed: (Math.random() * 0xffffffff) >>> 0 });
    this.local = this.match.addCombatant(LOCAL_NAME);
    this.match.setBotCount(this.settings.botCount);
    this.match.botMode = this.settings.botMode;

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, VIEW.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.autoClear = false;
    container.prepend(this.renderer.domElement);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new PerspectiveCamera(75, aspect, VIEW.nearPlane, VIEW.farPlane);
    this.camera.rotation.order = 'YXZ';
    this.viewmodel = new Viewmodel(aspect);

    this.sky = createSky(map);
    this.buildScene();
    this.effects = new Effects(this.scene, this.match.world, map);

    this.input = new Input(this.renderer.domElement);
    this.applySettings(this.settings);

    this.menu = new Menu(this.settings);
    this.menu.onPlay = () => {
      void this.audio.start();
      void this.input.requestLock();
    };
    this.menu.onChange = (settings) => {
      this.applySettings(settings);
      saveSettings(settings);
    };
    this.input.onLockChange = (locked) => (locked ? this.menu.hide() : this.menu.show());
    this.input.onLockError = () => this.menu.showLockError();

    window.addEventListener('resize', this.handleResize);
    this.onLocalRespawn();
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private buildScene(): void {
    const map = this.match.map;
    const scene = this.scene;
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
    this.audio.setVolume(settings.volume);
    this.match.botMode = settings.botMode;
    if (this.match.combatants.filter((c) => c.bot).length !== settings.botCount) {
      this.match.setBotCount(settings.botCount);
    }
  }

  private prevState(id: number): PlayerState {
    let state = this.previous.get(id);
    if (!state) {
      state = createPlayerState();
      this.previous.set(id, state);
    }
    return state;
  }

  private onLocalRespawn(): void {
    const p = this.local.player;
    this.input.setLook(p.yaw, 0);
    copyPlayerState(this.prevState(this.local.id), p);
    this.prevRecoilPitch = 0;
    this.prevRecoilYaw = 0;
    this.prevAds = 0;
    this.rig.reset(p);
    this.peakSpeed = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Ciclo
  // -------------------------------------------------------------------------------------------

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = this.lastFrame === 0 ? 0 : Math.min((now - this.lastFrame) / 1000, MAX_FRAME_TIME);
    this.lastFrame = now;

    // Con il menu aperto la partita è in pausa.
    if (this.input.locked || this.forceRun) {
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
    }
    this.render(dt, this.accumulator / TICK_DT);
  };

  private tick(): void {
    const local = this.local;
    if (this.input.consumeRespawn()) {
      this.match.forceRespawn(local);
      this.onLocalRespawn();
    }
    this.input.sample(local.input);
    local.input.weaponSlot = this.input.consumeWeaponRequest(local.weapon.current, local.weapon.previous, WEAPONS.length);

    for (const c of this.match.combatants) copyPlayerState(this.prevState(c.id), c.player);
    this.prevRecoilPitch = local.weapon.recoilPitch;
    this.prevRecoilYaw = local.weapon.recoilYaw;
    this.prevAds = local.weapon.adsAmount;

    this.match.tick();
    this.handleEvents();

    const p = local.player;
    if (local.alive) {
      if (p.stepDelta !== 0) {
        // Lo spostamento istantaneo non va interpolato: lo ammorbidisce la telecamera.
        this.prevState(local.id).y += p.stepDelta;
        this.rig.onStep(p.stepDelta);
      }
      if (p.landingSpeed > 0) {
        this.rig.onLand(p.landingSpeed);
        if (p.landingSpeed > 6) this.audio.play('land', { volume: Math.min(1, p.landingSpeed / 14) });
      }
      this.peakSpeed = Math.max(this.peakSpeed, horizontalSpeed(p));
    }
    this.updateFootsteps();
  }

  private updateFootsteps(): void {
    for (const c of this.match.combatants) {
      const p = c.player;
      const speed = horizontalSpeed(p);
      if (!c.alive || !p.grounded || p.sliding || speed < 2) continue;
      const distance = (this.footsteps.get(c.id) ?? 0) + speed * TICK_DT;
      if (distance < AUDIO.stepDistance) {
        this.footsteps.set(c.id, distance);
        continue;
      }
      this.footsteps.set(c.id, 0);
      if (c === this.local) this.audio.play('step', { volume: 0.2 });
      else this.audio.play('step', { x: p.x, y: p.y, z: p.z, volume: 0.8 });
    }
  }

  /** Traduce gli eventi dell'ultimo tick in effetti, suoni e segnali. */
  private handleEvents(): void {
    const events = this.match.events;
    const localId = this.local.id;

    for (let i = 0; i < events.shots.count; i++) {
      const shot = events.shots.get(i);
      const def = WEAPONS[shot.weapon]!;
      const mine = shot.shooter === localId;
      let from: Vector3;
      if (mine) {
        this.viewmodel.onShot(shot.weapon);
        from = this.viewmodel.worldPoint(this.camera, 'muzzle', this.temp) ?? this.temp.set(shot.ox, shot.oy, shot.oz);
        this.effects.muzzleLightAt(from.x, from.y, from.z);
        this.audio.play(def.id as SoundName);
        this.ejectCasing();
      } else {
        const view = this.characters.get(shot.shooter);
        from = view ? view.muzzleWorld(this.temp) : this.temp.set(shot.ox, shot.oy, shot.oz);
        this.effects.worldFlash(from.x, from.y, from.z);
        this.audio.play(def.id as SoundName, { x: from.x, y: from.y, z: from.z });
      }
      for (let k = 0; k < shot.pellets; k++) {
        const ex = shot.ends[k * 3]!;
        const ey = shot.ends[k * 3 + 1]!;
        const ez = shot.ends[k * 3 + 2]!;
        this.effects.tracer(from.x, from.y, from.z, ex, ey, ez);
        if (shot.results[k] === SHOT_WORLD) {
          this.effects.impact(ex, ey, ez, shot.normals[k * 3]!, shot.normals[k * 3 + 1]!, shot.normals[k * 3 + 2]!, shot.targets[k]!);
        }
      }
    }

    for (let i = 0; i < events.hits.count; i++) {
      const hit = events.hits.get(i);
      this.effects.bodyHit(hit.x, hit.y, hit.z, hit.damage);
      this.characters.get(hit.target)?.onHurt();
      if (hit.attacker === localId && hit.target !== localId) {
        this.hud.hitMarker(hit.headshot, hit.killed);
        if (this.settings.damageNumbers) this.hud.damageNumber(hit.x, hit.y, hit.z, hit.damage, hit.headshot, hit.killed);
        this.audio.play(hit.killed ? 'kill' : hit.headshot ? 'headshot' : 'hit');
      }
      if (hit.target === localId) {
        this.hud.hurt(hit.damage);
        this.rig.addShake(0.25 + hit.damage / 150);
        this.audio.play('hurt', { volume: 0.8 });
      }
    }

    for (let i = 0; i < events.kills.count; i++) {
      const kill = events.kills.get(i);
      const name = (id: number) => (id === localId ? LOCAL_NAME : this.match.getCombatant(id)?.name ?? '?');
      this.hud.killFeed(
        name(kill.killer),
        name(kill.victim),
        weaponLabel(kill.weapon),
        kill.headshot,
        kill.killer === localId || kill.victim === localId,
      );
      if (kill.victim === localId) this.deathTime = 0;
    }

    for (let i = 0; i < events.explosions.count; i++) {
      const blast = events.explosions.get(i);
      this.effects.explosion(blast.x, blast.y, blast.z, blast.radius);
      this.audio.play('explosion', { x: blast.x, y: blast.y, z: blast.z });
      const distance = this.camera.position.distanceTo(this.temp2.set(blast.x, blast.y, blast.z));
      if (distance < EFFECTS.shakeRange) this.rig.addShake(1 - distance / EFFECTS.shakeRange);
    }

    for (let i = 0; i < events.actions.count; i++) {
      const action = events.actions.get(i);
      const mine = action.combatant === localId;
      if (action.type === 'respawn') {
        const c = this.match.getCombatant(action.combatant);
        if (c) copyPlayerState(this.prevState(c.id), c.player);
        if (mine) this.onLocalRespawn();
        continue;
      }
      const sound: SoundName | null =
        action.type === 'reload'
          ? 'reload'
          : action.type === 'reloadEnd'
            ? 'reloadEnd'
            : action.type === 'switch'
              ? 'switch'
              : action.type === 'dryFire'
                ? 'dryFire'
                : action.type === 'throw'
                  ? 'throw'
                  : action.type === 'bounce'
                    ? 'bounce'
                    : null;
      if (!sound) continue;
      if (mine && action.type !== 'bounce') this.audio.play(sound, { volume: 0.6 });
      else this.audio.play(sound, { x: action.x, y: action.y + 1, z: action.z, volume: 0.6 });
    }
  }

  /** Bossolo espulso a destra dall'arma in prima persona. */
  private ejectCasing(): void {
    const point = this.viewmodel.worldPoint(this.camera, 'eject', this.temp2);
    if (!point) return;
    const p = this.local.player;
    const yaw = this.camera.rotation.y;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    this.effects.casing(
      point.x,
      point.y,
      point.z,
      p.vx + rightX * (1.8 + Math.random()) - Math.sin(yaw) * 0.4,
      p.vy * 0.5 + 1.6 + Math.random(),
      p.vz + rightZ * (1.8 + Math.random()) - Math.cos(yaw) * 0.4,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Disegno
  // -------------------------------------------------------------------------------------------

  private render(dt: number, alpha: number): void {
    const local = this.local;
    const p = local.player;
    const q = this.prevState(local.id);
    const w = local.weapon;
    const def = WEAPONS[w.current]!;
    this.rig.update(dt, p, this.settings.dynamicFov);

    const x = q.x + (p.x - q.x) * alpha;
    const y = q.y + (p.y - q.y) * alpha;
    const z = q.z + (p.z - q.z) * alpha;
    let eye = y + this.rig.eyeOffset;
    let roll = this.rig.roll;
    if (!local.alive) {
      // Da morti la visuale scende a terra e si inclina.
      this.deathTime += dt;
      const t = Math.min(1, this.deathTime / 0.4);
      eye = y + this.rig.eyeOffset + (VIEW.deathEyeHeight - this.rig.eyeOffset) * t;
      roll += VIEW.deathRoll * t;
    }
    this.camera.position.set(x, eye, z);
    const recoilPitch = this.prevRecoilPitch + (w.recoilPitch - this.prevRecoilPitch) * alpha;
    const recoilYaw = this.prevRecoilYaw + (w.recoilYaw - this.prevRecoilYaw) * alpha;
    this.camera.rotation.set(
      this.input.pitch + recoilPitch + this.rig.shakePitch,
      this.input.yaw + recoilYaw + this.rig.shakeYaw,
      roll,
      'YXZ',
    );

    const ads = this.prevAds + (w.adsAmount - this.prevAds) * alpha;
    const zoom = 1 + (def.ads.zoom - 1) * easeInOut(ads);
    this.updateProjection(zoom);
    this.input.sensitivityScale = 1 / zoom;
    this.sky.position.copy(this.camera.position);

    this.updateCharacters(dt, alpha);
    this.effects.syncProjectiles(this.match.projectiles, alpha, dt);
    this.effects.update(dt);

    const scoped = def.ads.scope && ads > VIEWMODEL.scopeThreshold && local.alive;
    this.viewmodel.update(dt, local, this.input.yaw, this.input.pitch, ads, local.alive && !scoped);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);

    this.audio.updateListener(this.camera);
    this.updateHud(dt, scoped);
  }

  private updateCharacters(dt: number, alpha: number): void {
    const alive = new Set<number>();
    for (const c of this.match.combatants) {
      if (c === this.local) continue;
      alive.add(c.id);
      let view = this.characters.get(c.id);
      if (!view) {
        view = new CharacterView(colorsFor(c.id));
        this.scene.add(view.root);
        this.characters.set(c.id, view);
      }
      const q = this.prevState(c.id);
      const p = c.player;
      view.update(
        dt,
        c,
        q.x + (p.x - q.x) * alpha,
        q.y + (p.y - q.y) * alpha,
        q.z + (p.z - q.z) * alpha,
        horizontalSpeed(p),
      );
    }
    for (const [id, view] of this.characters) {
      if (alive.has(id)) continue;
      view.dispose();
      this.characters.delete(id);
      this.previous.delete(id);
    }
  }

  private readonly project = (x: number, y: number, z: number, out: ScreenPoint): ScreenPoint => {
    this.projected.set(x, y, z).project(this.camera);
    out.visible = this.projected.z > -1 && this.projected.z < 1;
    out.x = ((this.projected.x + 1) / 2) * window.innerWidth;
    out.y = ((1 - this.projected.y) / 2) * window.innerHeight;
    return out;
  };

  private updateHud(dt: number, scoped: boolean): void {
    const local = this.local;
    const w = local.weapon;
    const def = WEAPONS[w.current]!;
    this.hud.frame(dt, local.player, this.peakSpeed, this.settings, this.settings.showDebug ? this.debugText() : '');
    this.hud.vitals(local.health, local.alive, local.protection);
    const reloadProgress = w.reloadTimer > 0 ? 1 - w.reloadTimer / def.reloadTime : -1;
    this.hud.weapon(w.current, w.ammo[w.current]!, reloadProgress, w.grenades);

    // Mirino: la distanza delle linee corrisponde alla dispersione sullo schermo.
    const spread = MathUtils.degToRad(currentSpread(local));
    const halfFov = MathUtils.degToRad(this.camera.fov) / 2;
    const gap = (Math.tan(spread) / Math.tan(halfFov)) * (window.innerHeight / 2) + 3;
    this.hud.crosshairGap(gap, local.alive && !scoped);
    this.hud.scopeVisible(scoped);

    if (local.alive) {
      this.hud.deathScreen(false);
    } else {
      const killer = local.killedBy === local.id ? '' : (this.match.getCombatant(local.killedBy)?.name ?? '');
      this.hud.deathScreen(true, killer, weaponLabel(local.killedByWeapon), local.respawnTimer);
    }

    let rows: ScoreRow[] | null = null;
    if (this.input.scoreboard) {
      rows = this.match.combatants.map((c) => ({
        name: c === local ? LOCAL_NAME : c.name,
        kills: c.kills,
        deaths: c.deaths,
        local: c === local,
      }));
    }
    this.hud.scores(rows, dt);

    // Nome e vita sopra i bot vivi, vicini e visibili (niente scritte attraverso i muri).
    this.labels.length = 0;
    const camera = this.camera.position;
    for (const [id, view] of this.characters) {
      const c = this.match.getCombatant(id);
      if (!c || !c.alive) continue;
      const point = view.labelPoint(this.temp);
      const distance = camera.distanceTo(point);
      const visible =
        distance < CHARACTERS.labelRange &&
        lineOfSight(this.match.world, camera.x, camera.y, camera.z, point.x, point.y - 0.3, point.z);
      this.labels.push({ id, name: c.name, health: c.health, x: point.x, y: point.y, z: point.z, visible });
    }
    this.hud.updateOverlays(dt, this.labels, this.project);
  }

  /** Converte il campo visivo orizzontale delle impostazioni in quello verticale, con lo zoom della mira. */
  private updateProjection(zoom: number): void {
    const horizontal = Math.min(this.settings.fov + this.rig.fovBoost, VIEW.maxFov);
    const aspect = window.innerWidth / window.innerHeight;
    const key = horizontal / zoom;
    if (Math.abs(key - this.appliedFov) < 0.01 && aspect === this.appliedAspect) return;
    this.appliedFov = key;
    this.appliedAspect = aspect;
    const halfWidth = Math.tan(MathUtils.degToRad(horizontal) / 2) / zoom;
    this.camera.fov = MathUtils.radToDeg(2 * Math.atan(halfWidth / aspect));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private debugText(): string {
    const p = this.local.player;
    const f = (value: number) => value.toFixed(2).padStart(7);
    const projectiles = this.match.projectiles.filter((pr) => pr.active).length;
    return [
      `pos    ${f(p.x)} ${f(p.y)} ${f(p.z)}`,
      `vel    ${f(p.vx)} ${f(p.vy)} ${f(p.vz)}`,
      `suolo  ${p.grounded ? 'sì' : 'no'}   pendenza ${f(p.groundGradX)} ${f(p.groundGradZ)}`,
      `stato  ${p.sliding ? 'scivolata' : p.crouched ? 'accovacciato' : 'in piedi'}`,
      `arma   dispersione ${currentSpread(this.local).toFixed(2)}°  rinculo ${f(MathUtils.radToDeg(this.local.weapon.recoilPitch))}°`,
      `tick   ${this.match.tickCount}   proiettili ${projectiles}   chiamate di disegno ${this.renderer.info.render.calls}`,
      `velocità max di corsa ${(MOVE.runSpeed * p.speedScale).toFixed(2)} m/s`,
    ].join('\n');
  }

  private readonly handleResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.viewmodel.setAspect(window.innerWidth / window.innerHeight);
    this.appliedAspect = 0;
  };
}
