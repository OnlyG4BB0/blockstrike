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
  BodyPose,
  KILLED_BY_FALL,
  KILLED_BY_GRENADE,
  MOVE,
  Match,
  NO_CLASS_CHANGE,
  SHOT_BODY,
  SHOT_WORLD,
  TICK_DT,
  copyAnimState,
  copyPlayerState,
  createAnimState,
  createPlayerState,
  currentSpread,
  decideGore,
  goreRoll,
  horizontalSpeed,
  lerpAnimState,
  lineOfSight,
  poseBody,
  type AnimState,
  type CharacterSkinDef,
  type Combatant,
  type GameContent,
  type KillEvent,
  type MapData,
  type PlayerState,
  type WeaponDef,
} from '@blockstrike/shared';
import { AudioSystem } from '../audio/AudioSystem.ts';
import { AUDIO, CHARACTERS, EFFECTS, GORE, RENDER, VIEW, VIEWMODEL } from '../config.ts';
import { Input } from '../input/Input.ts';
import { createBlockTexture } from '../render/blockTexture.ts';
import { CharacterPreview } from '../render/CharacterPreview.ts';
import { CharacterRenderer, type CharacterLook } from '../render/CharacterRenderer.ts';
import { Effects } from '../render/Effects.ts';
import { Gore } from '../render/Gore.ts';
import { createMapMesh } from '../render/mapMesh.ts';
import { createSky } from '../render/sky.ts';
import { Viewmodel } from '../render/Viewmodel.ts';
import { ModelLibrary } from '../render/weaponModels.ts';
import { SENSITIVITY_SCALE, loadSettings, saveSettings, type Settings } from '../settings.ts';
import { Hud, type LabelData, type ScoreRow, type ScreenPoint } from '../ui/Hud.ts';
import { Menu, type OnlineAction } from '../ui/Menu.ts';
import type { NetSession } from '../net/NetSession.ts';
import { CameraRig } from './CameraRig.ts';

/** Oltre questo numero di tick in un fotogramma si rinuncia a recuperare (es. scheda in pausa). */
const MAX_TICKS_PER_FRAME = 8;
/** Un fotogramma più lungo di così viene accorciato. */
const MAX_FRAME_TIME = 0.25;
const LOCAL_NAME = 'Tu';

/** Aspetto di riserva se in content/skins non ci sono skin dei personaggi. */
const DEFAULT_SKIN: CharacterSkinDef = {
  type: 'character',
  id: 'predefinita',
  name: 'Predefinita',
  order: 0,
  colors: {
    head: '#e0b48a',
    torso: '#4f7a3a',
    armLeft: '#4f7a3a',
    armRight: '#4f7a3a',
    legLeft: '#5b5141',
    legRight: '#5b5141',
    hair: '#3b2a1e',
    eyes: '#1b1b1b',
    hands: '#e0b48a',
    feet: '#2a2420',
    belt: '#2a2420',
  },
  accessories: [],
};

/** Ogni quanto il timer della rete controlla se è ora di un tick (ms). */
const NET_PUMP_MS = 4;
const MODE_NAMES: Record<string, string> = {
  ffa: 'tutti contro tutti',
  tdm: 'deathmatch a squadre',
  ctf: 'cattura la bandiera',
};

function byIdInput(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Ciclo di gioco: la partita (codice condiviso) avanza a passo fisso di 60 Hz; a ogni fotogramma
 * si disegna interpolando tra gli ultimi due stati, e gli eventi della partita diventano effetti,
 * suoni e segnali sull'HUD.
 */
export class Game {
  readonly match: Match;
  readonly local: Combatant;
  /** Partita online (null = allenamento con i bot, in locale). */
  readonly session: NetSession | null;
  /** Richiesta di passare online o di tornare all'allenamento (ricarica la pagina). */
  onOnline: (action: OnlineAction, mode: string, code: string) => void = () => {};
  onLeaveRoom: () => void = () => {};
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
  private readonly content: GameContent;
  private readonly library: ModelLibrary;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly viewmodel: Viewmodel;
  private readonly effects: Effects;
  private readonly audio: AudioSystem;
  private readonly characters = new CharacterRenderer(CHARACTERS.maxVisible);
  private readonly preview: CharacterPreview;
  /** Stato dell'animazione al tick precedente, per disegnare tra due tick. */
  private readonly prevAnim = new Map<number, AnimState>();
  /** Ultima posa disegnata di ogni personaggio (bocca dell'arma, nome sopra la testa). */
  private readonly drawnPoses = new Map<number, BodyPose>();
  private readonly hurt = new Map<number, number>();
  private readonly gore: Gore;
  private readonly looks = new Map<number, CharacterLook>();
  private readonly drawAnim = createAnimState();
  private readonly footsteps = new Map<number, number>();
  private settings: Settings;
  private accumulator = 0;
  private lastFrame = 0;
  private peakSpeed = 0;
  private appliedFov = 0;
  private appliedAspect = 0;
  private deathTime = 0;
  private lastPump = 0;
  private closed = false;
  private requestedClass = -1;
  /** Chiamate di disegno dell'ultimo fotogramma. */
  drawCalls = 0;
  private readonly labels: LabelData[] = [];
  private readonly temp = new Vector3();
  private readonly temp2 = new Vector3();
  private readonly projected = new Vector3();

  constructor(container: HTMLElement, map: MapData, content: GameContent, session: NetSession | null = null) {
    this.settings = loadSettings();
    this.content = content;
    this.library = new ModelLibrary(content);
    this.hud = new Hud(content.weapons, content.grenade.name);
    this.audio = new AudioSystem(content.sounds);
    this.session = session;
    if (session) {
      // Online: la partita è lo specchio del client (predizione e altri giocatori dal server).
      this.match = session.core.match;
      this.local = session.core.local!;
    } else {
      this.match = new Match(map, content, { seed: (Math.random() * 0xffffffff) >>> 0 });
      this.local = this.match.addCombatant(LOCAL_NAME, { classIndex: this.classIndexOf(this.settings.classId) });
      this.match.setBotCount(this.settings.botCount);
      this.match.botMode = this.settings.botMode;
    }

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
    this.viewmodel = new Viewmodel(aspect, this.library, content.weapons, this.settings.skins);

    this.sky = createSky(map);
    this.buildScene();
    this.scene.add(this.characters.object);
    this.effects = new Effects(this.scene, this.match.world, map, this.library);
    this.gore = new Gore(this.match.world);
    this.scene.add(this.gore.object);

    this.input = new Input(this.renderer.domElement);

    const skinChoices = content.weapons
      .map((def) => ({ weaponId: def.id, weaponName: def.name, skins: this.library.skinsFor(def.id) }))
      .filter((choice) => choice.skins.length > 0);
    const weaponName = (id: string | null) => (id ? (content.weapons.find((w) => w.id === id)?.name ?? id) : null);
    const classChoices = content.classes.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      health: c.health,
      speed: c.speed,
      jumpHeight: c.jumpHeight,
      weapons: [c.primary, c.secondary, c.melee].map(weaponName).filter((name): name is string => name !== null),
      grenades: c.grenades,
    }));
    const characterSkinChoices = content.characterSkins.map((s) => ({
      id: s.id,
      name: s.name,
      swatch: [s.colors.head, s.colors.torso, s.colors.legLeft, s.colors.hair],
      accessories: s.accessories.map((a) => a.name),
    }));
    this.menu = new Menu(this.settings, skinChoices, classChoices, characterSkinChoices);
    this.preview = new CharacterPreview(this.menu.previewCanvas, this.match.grips);
    this.applySettings(this.settings);
    this.menu.onPlay = () => {
      void this.audio.start();
      void this.input.requestLock();
      // In allenamento la nuova classe vale subito: si rinasce con quella.
      if (!this.session && this.local.pendingClass !== NO_CLASS_CHANGE) {
        this.match.forceRespawn(this.local);
        this.onLocalRespawn();
      }
      this.menu.setClassNote('');
    };
    this.menu.onChange = (settings) => {
      this.applySettings(settings);
      saveSettings(settings);
    };
    this.input.onLockChange = (locked) => (locked ? this.menu.hide() : this.menu.show());
    this.input.onLockError = () => this.menu.showLockError();

    this.menu.onOnline = (action, mode, code) => this.onOnline(action, mode, code);
    this.menu.onLeaveRoom = () => this.onLeaveRoom();
    if (session) {
      this.menu.setOnlineRoom(session.code, MODE_NAMES[session.mode] ?? session.mode);
      session.onChat = (message) => this.hud.chat(message.name, message.text);
      session.onClose = (reason) => {
        this.menu.show();
        this.menu.setOnlineStatus(reason);
        this.closed = true;
      };
      this.hud.chat('', `Stanza ${session.code}: invita gli amici con questo codice. Invio per scrivere.`, true);
    }
    window.addEventListener('keydown', this.handleChatKey);

    window.addEventListener('resize', this.handleResize);
    this.onLocalRespawn();
  }

  start(): void {
    requestAnimationFrame(this.frame);
    // Online la partita non si ferma con il menu: i tick vanno a tempo, anche a scheda nascosta.
    if (this.session) window.setInterval(this.pump, NET_PUMP_MS);
  }

  /** Tick online a passo fisso, guidati dall'orologio e non dai fotogrammi. */
  private readonly pump = (): void => {
    const now = performance.now();
    if (this.lastPump === 0) this.lastPump = now;
    this.accumulator = Math.min(this.accumulator + (now - this.lastPump) / 1000, TICK_DT * MAX_TICKS_PER_FRAME);
    this.lastPump = now;
    while (this.accumulator >= TICK_DT && !this.closed) {
      this.tick();
      this.accumulator -= TICK_DT;
    }
  };

  /** Invio apre la chat (online); Invio di nuovo la manda, Esc la chiude. */
  private readonly handleChatKey = (event: KeyboardEvent): void => {
    const session = this.session;
    if (!session || event.key !== 'Enter' || this.input.typing) return;
    const field = byIdInput('chat-input');
    field.hidden = false;
    field.value = '';
    this.input.typing = true;
    event.preventDefault();
    field.focus();
    const finish = (send: boolean) => {
      field.removeEventListener('keydown', onKey);
      if (send && field.value.trim()) session.sendChat(field.value.trim());
      field.hidden = true;
      field.blur();
      this.input.typing = false;
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    };
    field.addEventListener('keydown', onKey);
  };

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
    if (!this.session) {
      this.match.botMode = settings.botMode;
      if (this.match.combatants.filter((c) => c.bot).length !== settings.botCount) {
        this.match.setBotCount(settings.botCount);
      }
    }
    this.match.weapons.forEach((def, index) => this.viewmodel.setSkin(index, this.skinOf(def)));
    this.characters.showHitboxes = settings.showDebug;
    if (this.gore.level !== settings.goreLevel) {
      this.gore.level = settings.goreLevel;
      if (settings.goreLevel === 'off') this.gore.clear();
    }

    // Classe: vale dalla prossima rinascita (in allenamento, appena si torna a giocare).
    const classIndex = this.classIndexOf(settings.classId);
    if (this.session) {
      // Online decide il server: la classe vale dalla prossima rinascita.
      if (classIndex !== this.local.classIndex && classIndex >= 0) {
        if (this.requestedClass !== classIndex) this.session.sendClass(this.content.classes[classIndex]!.id);
        this.requestedClass = classIndex;
        this.menu.setClassNote('La nuova classe vale dalla prossima rinascita.');
      } else {
        this.menu.setClassNote('');
      }
    } else if (classIndex !== this.local.classIndex) {
      this.match.setClass(this.local, classIndex);
      this.menu.setClassNote('La nuova classe vale appena torni a giocare.');
    } else {
      this.local.pendingClass = NO_CLASS_CHANGE;
      this.menu.setClassNote('');
    }
    this.looks.delete(this.local.id);
    const primary = classIndex >= 0 ? this.match.weapons.findIndex((w) => w.id === this.content.classes[classIndex]!.primary) : 0;
    this.preview.setLook(this.lookFor(this.local), primary);
  }

  private classIndexOf(id: string): number {
    const index = this.content.classes.findIndex((c) => c.id === id);
    return index >= 0 ? index : this.content.classes.length > 0 ? 0 : -1;
  }

  /** Skin scelta nelle impostazioni per un'arma, se esiste ancora. */
  private skinOf(def: WeaponDef): string | null {
    const id = this.settings.skins[def.id];
    return id && this.library.skin(id)?.weapon === def.id ? id : null;
  }

  /**
   * Aspetto di un personaggio. Il giocatore usa skin e armi scelte nel menu; ogni bot ha una skin
   * del personaggio e skin delle armi a caso (sempre le stesse).
   */
  private lookFor(c: Combatant): CharacterLook {
    let look = this.looks.get(c.id);
    if (look) return look;
    const skins = this.content.characterSkins;
    const mine = c === this.local;
    const skin: CharacterSkinDef =
      (mine ? skins.find((s) => s.id === this.settings.characterSkin) : skins[(c.id * 5 + 3) % skins.length]) ??
      skins[0] ??
      DEFAULT_SKIN;
    look = {
      skin,
      weaponGeometry: (index) => {
        const def = this.match.weapons[index];
        if (!def) return null;
        let weaponSkin: string | null;
        if (mine) {
          weaponSkin = this.skinOf(def);
        } else {
          const choices = this.library.skinsFor(def.id);
          const pick = (c.id * 7 + index * 3) % (choices.length + 1);
          weaponSkin = pick < choices.length ? choices[pick]!.id : null;
        }
        return this.library.mergedGeometry(def.model, weaponSkin);
      },
    };
    this.looks.set(c.id, look);
    return look;
  }

  private weaponLabel(index: number): string {
    if (index === KILLED_BY_FALL) return 'caduta';
    if (index === KILLED_BY_GRENADE) return this.content.grenade.name;
    return this.match.weapons[index]?.name ?? '?';
  }

  private prevState(id: number): PlayerState {
    let state = this.previous.get(id);
    if (!state) {
      state = createPlayerState();
      this.previous.set(id, state);
    }
    return state;
  }

  private prevAnimOf(id: number): AnimState {
    let state = this.prevAnim.get(id);
    if (!state) {
      state = createAnimState();
      this.prevAnim.set(id, state);
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

    // Con il menu aperto la partita è in pausa (solo in allenamento: online va avanti a tempo).
    if (!this.session && (this.input.locked || this.forceRun)) {
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
    const respawn = this.input.consumeRespawn();
    if (respawn && !this.session) {
      this.match.forceRespawn(local);
      this.onLocalRespawn();
    }
    this.input.sample(local.input);
    if (this.session && !this.input.locked && !this.forceRun) {
      // Menu aperto online: si resta fermi (la visuale resta dov'era).
      const input = local.input;
      input.forward = 0;
      input.right = 0;
      input.jump = false;
      input.crouch = false;
      input.fire = false;
      input.ads = false;
      input.reload = false;
      input.grenade = false;
    }
    // I tasti scelgono tra le armi della classe.
    const loadout = local.loadout;
    local.input.weaponSlot = this.input.consumeWeaponRequest(
      Math.max(0, loadout.indexOf(local.weapon.current)),
      Math.max(0, loadout.indexOf(local.weapon.previous)),
      loadout.length,
    );

    for (const c of this.match.combatants) {
      copyPlayerState(this.prevState(c.id), c.player);
      copyAnimState(this.prevAnimOf(c.id), c.anim);
    }
    this.prevRecoilPitch = local.weapon.recoilPitch;
    this.prevRecoilYaw = local.weapon.recoilYaw;
    this.prevAds = local.weapon.adsAmount;

    if (this.session) {
      const wasAlive = local.alive;
      this.session.sendInput(this.session.core.tick(local.input));
      if (!wasAlive && local.alive) this.onLocalRespawn();
    } else {
      this.match.tick();
    }
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
      const def = this.match.weapons[shot.weapon]!;
      const melee = def.kind === 'melee';
      const mine = shot.shooter === localId;
      let from: Vector3;
      if (mine) {
        this.viewmodel.onShot(shot.weapon);
        from = this.viewmodel.worldPoint(this.camera, 'muzzle', this.temp) ?? this.temp.set(shot.ox, shot.oy, shot.oz);
        this.audio.play(def.sounds.fire);
        if (!melee) {
          this.effects.muzzleLightAt(from.x, from.y, from.z);
          this.ejectCasing();
        }
      } else {
        from = this.muzzleOf(shot.shooter, shot.weapon) ?? this.temp.set(shot.ox, shot.oy, shot.oz);
        if (!melee) this.effects.worldFlash(from.x, from.y, from.z);
        this.audio.play(def.sounds.fire, { x: from.x, y: from.y, z: from.z });
      }
      for (let k = 0; k < shot.pellets; k++) {
        const ex = shot.ends[k * 3]!;
        const ey = shot.ends[k * 3 + 1]!;
        const ez = shot.ends[k * 3 + 2]!;
        // Il coltello non lascia traccianti; i colpi a vuoto sì.
        if (!melee) this.effects.tracer(from.x, from.y, from.z, ex, ey, ez);
        if (shot.results[k] === SHOT_WORLD) {
          this.effects.impact(ex, ey, ez, shot.normals[k * 3]!, shot.normals[k * 3 + 1]!, shot.normals[k * 3 + 2]!, shot.targets[k]!);
        }
        if (melee && shot.results[k] === SHOT_BODY && def.sounds.hit) {
          this.audio.play(def.sounds.hit, { x: ex, y: ey, z: ez });
        }
      }
    }

    for (let i = 0; i < events.hits.count; i++) {
      const hit = events.hits.get(i);
      // Il sangue di chi guarda in prima persona non si vede (finirebbe davanti alla visuale).
      if (hit.target !== localId) this.gore.hit(hit.x, hit.y, hit.z, hit.dx, hit.dy, hit.dz, hit.damage, hit.headshot);
      this.hurt.set(hit.target, 1);
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
        this.weaponLabel(kill.weapon),
        kill.headshot,
        kill.killer === localId || kill.victim === localId,
      );
      if (kill.victim === localId) this.deathTime = 0;
      else this.splatterKill(kill);
      if (kill.killer === localId && kill.victim !== localId) this.announceKill(kill);
    }

    for (let i = 0; i < events.explosions.count; i++) {
      const blast = events.explosions.get(i);
      this.effects.explosion(blast.x, blast.y, blast.z, blast.radius);
      const projectile =
        blast.weapon === KILLED_BY_GRENADE ? this.content.grenade.projectile : this.match.weapons[blast.weapon]?.projectile;
      if (projectile) this.audio.play(projectile.sounds.explode, { x: blast.x, y: blast.y, z: blast.z });
      const distance = this.camera.position.distanceTo(this.temp2.set(blast.x, blast.y, blast.z));
      if (distance < EFFECTS.shakeRange) this.rig.addShake(1 - distance / EFFECTS.shakeRange);
    }

    for (let i = 0; i < events.actions.count; i++) {
      const action = events.actions.get(i);
      const mine = action.combatant === localId;
      if (action.type === 'respawn') {
        const c = this.match.getCombatant(action.combatant);
        if (c) {
          copyPlayerState(this.prevState(c.id), c.player);
          copyAnimState(this.prevAnimOf(c.id), c.anim);
        }
        if (mine) this.onLocalRespawn();
        continue;
      }
      // I suoni delle azioni vengono dai dati dell'arma in mano (o della granata).
      const c = this.match.getCombatant(action.combatant);
      const def = c ? this.match.weapons[c.weapon.current] : undefined;
      const grenade = this.content.grenade;
      let sound: string | null = null;
      if (action.type === 'reload') sound = def?.sounds.reload ?? null;
      else if (action.type === 'reloadEnd') sound = def?.sounds.reloadEnd ?? null;
      else if (action.type === 'switch') sound = def?.sounds.draw ?? null;
      else if (action.type === 'dryFire') sound = 'dry_fire';
      else if (action.type === 'throw') sound = grenade.sounds.throw;
      else if (action.type === 'bounce') sound = grenade.projectile.sounds.bounce;
      if (!sound) continue;
      if (mine && action.type !== 'bounce') this.audio.play(sound, { volume: 0.6 });
      else this.audio.play(sound, { x: action.x, y: action.y + 1, z: action.z, volume: 0.6 });
    }
  }

  /** Splatter della morte di un altro combattente: manichino, parte staccata, pezzi o niente. */
  private splatterKill(kill: Readonly<KillEvent>): void {
    const victim = this.match.getCombatant(kill.victim);
    if (!victim) return;
    let pose = this.drawnPoses.get(victim.id);
    if (!pose) {
      pose = new BodyPose();
      this.drawnPoses.set(victim.id, pose);
      poseBody(pose, victim.anim, this.match.grips);
    }
    const def = kill.weapon >= 0 ? this.match.weapons[kill.weapon] : undefined;
    const outcome = decideGore(kill, def?.gore ?? null, this.gore.level, goreRoll(victim.id, kill.victimDeaths));
    const p = victim.player;
    this.gore.kill({
      outcome,
      pose,
      look: this.lookFor(victim),
      part: kill.part,
      x: kill.x,
      y: kill.y,
      z: kill.z,
      dx: kill.dx,
      dy: kill.dy,
      dz: kill.dz,
      vx: p.vx,
      vy: p.vy,
      vz: p.vz,
      explosive: kill.explosive,
    });
    if (outcome === 'gib') this.audio.play('gore_gib', { x: kill.x, y: kill.y, z: kill.z });
    else if (outcome === 'dismember') this.audio.play('gore_dismember', { x: kill.x, y: kill.y, z: kill.z });
    else if (outcome === 'ragdoll' && kill.headshot) this.audio.play('gore_splat', { x: kill.x, y: kill.y, z: kill.z });
    // Uccisione da molto vicino: schizzi sulla visuale.
    const distance = this.camera.position.distanceTo(this.temp2.set(kill.x, kill.y, kill.z));
    if (this.gore.level !== 'off' && distance < GORE.screenSplatterRange && (kill.killer === this.local.id || outcome === 'gib')) {
      this.hud.splatter(1 - distance / GORE.screenSplatterRange + (outcome === 'gib' ? 0.5 : 0));
    }
  }

  /** Uccisioni speciali del giocatore: annuncio e suono. */
  private announceKill(kill: Readonly<KillEvent>): void {
    const labels: string[] = [];
    if (kill.multi >= 2) labels.push(kill.multi === 2 ? 'DOPPIETTA' : kill.multi === 3 ? 'TRIPLETTA' : 'STRAGE');
    if (kill.streak >= 3 && kill.streak % 2 === 1) labels.push(`SERIE DI ${kill.streak}`);
    if (kill.killerAirborne) labels.push('DALL\'ALTO');
    else if (kill.victimAirborne) labels.push('ABBATTUTO IN VOLO');
    if (kill.headshot) labels.push('COLPO ALLA TESTA');
    if (labels.length === 0) return;
    this.hud.announce(labels[0]!, labels.slice(1).join(' · '));
    this.audio.play(kill.multi >= 2 || kill.streak >= 3 ? 'announce_streak' : 'announce', { volume: 0.7 });
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
    const def = this.match.weapons[w.current]!;
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

    // Le chiamate di disegno si contano su tutto il fotogramma (ombre, mondo e arma in mano).
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    this.drawCalls = this.renderer.info.render.calls;

    this.audio.updateListener(this.camera);
    this.updateHud(dt, scoped);
    if (this.menu.visible) this.menu.setPreviewCaption(this.preview.render(dt));
  }

  /**
   * Personaggi degli altri combattenti: la posa nasce dallo stato dell'animazione interpolato tra
   * gli ultimi due tick, con la stessa funzione che dà le hitbox alla simulazione.
   */
  private updateCharacters(dt: number, alpha: number): void {
    this.characters.begin();
    for (const c of this.match.combatants) {
      // I morti diventano manichini o pezzi (Gore); il giocatore è in prima persona.
      if (c === this.local || !c.alive) continue;
      let pose = this.drawnPoses.get(c.id);
      if (!pose) {
        pose = new BodyPose();
        this.drawnPoses.set(c.id, pose);
      }
      lerpAnimState(this.drawAnim, this.prevAnimOf(c.id), c.anim, alpha);
      poseBody(pose, this.drawAnim, this.match.grips);
      const hurt = Math.max(0, (this.hurt.get(c.id) ?? 0) - dt * CHARACTERS.hurtDecay);
      this.hurt.set(c.id, hurt);
      this.characters.add(pose, this.lookFor(c), c.anim.weapon, { hurt, fall: 0, sink: 0 });
    }
    this.gore.update(dt);
    this.gore.draw(this.characters);
    this.characters.end();
    // Combattenti usciti dalla partita.
    for (const id of this.drawnPoses.keys()) {
      if (this.match.getCombatant(id)) continue;
      this.drawnPoses.delete(id);
      this.prevAnim.delete(id);
      this.hurt.delete(id);
      this.looks.delete(id);
      this.previous.delete(id);
    }
  }

  /** Bocca dell'arma di un altro combattente, dall'ultima posa disegnata. */
  private muzzleOf(id: number, weapon: number): Vector3 | null {
    const pose = this.drawnPoses.get(id);
    const def = this.match.weapons[weapon];
    if (!pose || !pose.armed || !def) return null;
    const [x, y, z] = this.library.model(def.model).muzzle;
    return CharacterRenderer.weaponPoint(pose, x, y, z, this.temp);
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
    const def = this.match.weapons[w.current]!;
    this.hud.frame(dt, local.player, this.peakSpeed, this.settings, this.settings.showDebug ? this.debugText() : '');
    this.hud.vitals(local.health, local.maxHealth, local.alive, local.protection);
    this.hud.setLoadout(local.loadout);
    const reloadProgress = w.reloadTimer > 0 ? 1 - w.reloadTimer / def.reloadTime : -1;
    this.hud.weapon(w.current, w.ammo[w.current]!, reloadProgress, w.grenades);

    // Mirino: la distanza delle linee corrisponde alla dispersione sullo schermo.
    const spread = MathUtils.degToRad(currentSpread(local, def));
    const halfFov = MathUtils.degToRad(this.camera.fov) / 2;
    const gap = (Math.tan(spread) / Math.tan(halfFov)) * (window.innerHeight / 2) + 3;
    this.hud.crosshairGap(gap, local.alive && !scoped);
    this.hud.scopeVisible(scoped);

    if (local.alive) {
      this.hud.deathScreen(false);
    } else {
      const killer = local.killedBy === local.id ? '' : (this.match.getCombatant(local.killedBy)?.name ?? '');
      this.hud.deathScreen(true, killer, this.weaponLabel(local.killedByWeapon), local.respawnTimer);
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
    this.updateMatchInfo();

    // Nome e vita sopra i bot vivi, vicini e visibili (niente scritte attraverso i muri).
    this.labels.length = 0;
    const camera = this.camera.position;
    for (const [id, pose] of this.drawnPoses) {
      const c = this.match.getCombatant(id);
      if (!c || !c.alive) continue;
      const point = CharacterRenderer.labelPoint(pose, this.temp);
      const distance = camera.distanceTo(point);
      const visible =
        distance < CHARACTERS.labelRange &&
        lineOfSight(this.match.world, camera.x, camera.y, camera.z, point.x, point.y - 0.3, point.z);
      this.labels.push({ id, name: c.name, health: c.health, maxHealth: c.maxHealth, x: point.x, y: point.y, z: point.z, visible });
    }
    this.hud.updateOverlays(dt, this.labels, this.project);
  }

  /** Tempo, punteggi e schermata finale della partita online. */
  private updateMatchInfo(): void {
    const session = this.session;
    if (!session) {
      this.hud.matchBar(null);
      return;
    }
    const info = session.core.info;
    const seconds = Math.max(0, Math.ceil(info.timeLeft));
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    let leader = this.local;
    for (const c of this.match.combatants) if (c.kills > leader.kills) leader = c;
    const leaderName = leader === this.local ? LOCAL_NAME : leader.name;
    if (info.phase === 0) {
      this.hud.matchBar(`${clock} · prima a ${info.scoreLimit}: ${leaderName} ${leader.kills}`);
      this.hud.endScreen(false);
      return;
    }
    this.hud.matchBar(null);
    const winner = this.match.getCombatant(info.winner);
    const title = winner ? (winner === this.local ? 'Hai vinto!' : `Vince ${winner.name}`) : 'Partita finita';
    const rows = this.match.combatants.map((c) => ({
      name: c === this.local ? LOCAL_NAME : c.name,
      kills: c.kills,
      deaths: c.deaths,
      local: c === this.local,
    }));
    this.hud.endScreen(true, title, rows, info.timeLeft);
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
    const g = this.gore.stats();
    const goreText = `particelle ${g.particles}  macchie ${g.decals}  manichini ${g.ragdolls}  pezzi ${g.pieces}`;
    return [
      `pos    ${f(p.x)} ${f(p.y)} ${f(p.z)}`,
      `vel    ${f(p.vx)} ${f(p.vy)} ${f(p.vz)}`,
      `suolo  ${p.grounded ? 'sì' : 'no'}   pendenza ${f(p.groundGradX)} ${f(p.groundGradZ)}`,
      `stato  ${p.sliding ? 'scivolata' : p.crouched ? 'accovacciato' : 'in piedi'}`,
      `arma   ${this.match.weapons[this.local.weapon.current]!.id}  dispersione ${currentSpread(this.local, this.match.weapons[this.local.weapon.current]!).toFixed(2)}°  rinculo ${f(MathUtils.radToDeg(this.local.weapon.recoilPitch))}°`,
      `tick   ${this.match.tickCount}   proiettili ${projectiles}   chiamate di disegno ${this.drawCalls}`,
      `gore   ${goreText}`,
      `velocità max di corsa ${(MOVE.runSpeed * p.speedScale).toFixed(2)} m/s`,
    ].join('\n');
  }

  private readonly handleResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.viewmodel.setAspect(window.innerWidth / window.innerHeight);
    this.appliedAspect = 0;
  };
}
