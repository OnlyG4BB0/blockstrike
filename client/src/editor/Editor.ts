/**
 * Editor di mappe nel browser: blocchi e rampe, punti di rinascita, basi delle bandiere e luci.
 * Si posiziona, ridimensiona, colora, duplica, annulla; la mappa si salva da sola nel browser, si
 * esporta e importa come JSON e si prova subito nel gioco («Prova»). Il formato è quello di
 * content/maps, controllato con lo stesso parseMap del gioco.
 */
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { MAX_MAP_LIGHTS, parseMap, type MapBlock, type MapData, type RampDirection } from '@blockstrike/shared';
import { createBlockTexture } from '../render/blockTexture.ts';
import { createBlockGeometry } from '../render/mapMesh.ts';
import { createSky } from '../render/sky.ts';

type Kind = 'block' | 'spawn' | 'flag' | 'light';

interface Selection {
  kind: Kind;
  index: number;
}

/** Chiave del salvataggio nel browser: è anche quella che il gioco legge con ?mappa=editor. */
export const EDITOR_STORAGE_KEY = 'blockstrike.editor.map';

const TEAM_COLORS = ['#e8e3d6', '#e2483d', '#3d7be2'];
const LOOK_SPEED = 0.004;
const MOVE_SPEED = 14;
const UNDO_LIMIT = 100;
const RAMP_DIRECTIONS: readonly RampDirection[] = ['+x', '-x', '+z', '-z'];

/** Mappa nuova: pavimento 40 x 40, muri alti, due punti di rinascita. */
export function emptyMap(): MapData {
  const wall = '#8c7b6a';
  return {
    version: 1,
    name: 'Nuova mappa',
    killY: -20,
    spawns: [
      { pos: [0, 0, 12], yaw: 0, team: 1 },
      { pos: [0, 0, -12], yaw: 180, team: 2 },
    ],
    blocks: [
      { pos: [-20, -1, -20], size: [40, 1, 40], color: '#cfc6b0', type: 'box' },
      { pos: [-20, 0, -20], size: [40, 12, 1], color: wall, type: 'box' },
      { pos: [-20, 0, 19], size: [40, 12, 1], color: wall, type: 'box' },
      { pos: [-20, 0, -19], size: [1, 12, 38], color: wall, type: 'box' },
      { pos: [19, 0, -19], size: [1, 12, 38], color: wall, type: 'box' },
    ],
    waypoints: [],
    flags: [],
    lights: [],
    sky: { top: '#3f86d6', horizon: '#cfe7f7', bottom: '#e8dcc0' },
    fog: { color: '#cfe7f7', near: 55, far: 170 },
    sun: { direction: [-0.45, -1, -0.3], color: '#fff2dc', intensity: 2.4 },
    ambient: { sky: '#d6ecff', ground: '#bba27a', intensity: 1.5 },
  };
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} mancante`);
  return element as T;
}

export class Editor {
  private map: MapData;
  private selection: Selection | null = null;
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.05, 1000);
  private readonly content = new Group();
  private readonly outline: LineSegments;
  private readonly texture: Texture;
  private readonly blockMaterial: MeshLambertMaterial;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly keys = new Set<string>();
  private sky: Mesh | null = null;
  private sun = new DirectionalLight();
  private hemisphere = new HemisphereLight();
  private yaw = 0;
  private pitch = -0.35;
  private looking = false;
  private dragged = 0;
  private last = 0;
  private readonly bundled: ReadonlyMap<string, unknown>;

  constructor(bundled: ReadonlyMap<string, unknown>) {
    this.bundled = bundled;
    this.map = this.loadSaved() ?? emptyMap();
    const viewport = byId('viewport');
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    viewport.append(this.renderer.domElement);
    this.texture = createBlockTexture(this.renderer.capabilities.getMaxAnisotropy());
    this.blockMaterial = new MeshLambertMaterial({ vertexColors: true, map: this.texture });
    this.outline = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1, 1, 1)),
      new LineBasicMaterial({ color: '#ffe14d', depthTest: false }),
    );
    this.outline.renderOrder = 10;
    this.outline.visible = false;
    const grid = new GridHelper(200, 200, '#6b6b6b', '#4a4a4a');
    grid.position.y = 0.005;
    (grid.material as LineBasicMaterial).transparent = true;
    (grid.material as LineBasicMaterial).opacity = 0.35;
    this.scene.add(this.content, this.outline, grid, this.sun, this.sun.target, this.hemisphere, new AmbientLight('#ffffff', 0.2));
    this.camera.position.set(0, 14, 26);
    this.bindUi();
    this.bindViewport();
    this.rebuild();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(this.frame);
  }

  // -------------------------------------------------------------------------------------------
  // Stato, salvataggio, annulla
  // -------------------------------------------------------------------------------------------

  private loadSaved(): MapData | null {
    try {
      const raw = localStorage.getItem(EDITOR_STORAGE_KEY);
      return raw ? parseMap(JSON.parse(raw), 'mappa salvata') : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(this.map));
    } catch {
      // Senza archiviazione si lavora lo stesso; si può esportare.
    }
  }

  /** Da chiamare prima di ogni modifica. */
  private checkpoint(): void {
    this.undoStack.push(JSON.stringify(this.map));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private changed(): void {
    this.save();
    this.rebuild();
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(JSON.stringify(this.map));
    this.map = JSON.parse(previous) as MapData;
    this.selection = null;
    this.changed();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.map));
    this.map = JSON.parse(next) as MapData;
    this.selection = null;
    this.changed();
  }

  /** Sostituisce la mappa (aperta, importata, nuova), con annulla. */
  private replace(map: MapData): void {
    this.checkpoint();
    this.map = map;
    this.selection = null;
    this.changed();
    this.camera.position.set(0, 14, 26);
    this.yaw = 0;
    this.pitch = -0.35;
  }

  /** Controllo con lo stesso codice del gioco: null se va bene, altrimenti il problema. */
  private validate(): string | null {
    try {
      parseMap(JSON.parse(JSON.stringify(this.map)), this.map.name);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Scena
  // -------------------------------------------------------------------------------------------

  private rebuild(): void {
    for (const child of [...this.content.children]) {
      child.removeFromParent();
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (child.material !== this.blockMaterial) (child.material as MeshBasicMaterial).dispose();
      }
    }
    const map = this.map;
    map.blocks.forEach((block, index) => {
      const mesh = new Mesh(createBlockGeometry(block), this.blockMaterial);
      mesh.userData = { kind: 'block', index };
      this.content.add(mesh);
    });
    map.spawns.forEach((spawn, index) => {
      const color = TEAM_COLORS[spawn.team ?? 0]!;
      const body = new Mesh(new BoxGeometry(0.8, 1.8, 0.8), new MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
      body.position.set(spawn.pos[0], spawn.pos[1] + 0.9, spawn.pos[2]);
      body.rotation.y = (spawn.yaw * Math.PI) / 180;
      const nose = new Mesh(new BoxGeometry(0.2, 0.2, 0.6), new MeshBasicMaterial({ color }));
      nose.position.set(0, 0.5, -0.6);
      body.add(nose);
      body.userData = { kind: 'spawn', index };
      this.content.add(body);
    });
    (map.flags ?? []).forEach((flag, index) => {
      const color = TEAM_COLORS[flag.team]!;
      const pole = new Mesh(new BoxGeometry(0.1, 2.2, 0.1), new MeshBasicMaterial({ color: '#d9d4c8' }));
      pole.position.set(flag.pos[0], flag.pos[1] + 1.1, flag.pos[2]);
      const cloth = new Mesh(new BoxGeometry(0.9, 0.55, 0.06), new MeshBasicMaterial({ color }));
      cloth.position.set(0.45, 0.8, 0);
      pole.add(cloth);
      pole.userData = { kind: 'flag', index };
      this.content.add(pole);
    });
    (map.lights ?? []).forEach((light, index) => {
      const bulb = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: light.color }));
      bulb.position.set(...light.pos);
      bulb.userData = { kind: 'light', index };
      bulb.add(new PointLight(new Color(light.color), light.intensity, light.distance, 2));
      this.content.add(bulb);
    });
    // Cielo, nebbia, sole e luce ambiente come nel gioco.
    this.sky?.removeFromParent();
    this.sky = createSky(map);
    this.scene.add(this.sky);
    this.scene.background = new Color(map.fog.color);
    this.scene.fog = new Fog(new Color(map.fog.color), map.fog.near, map.fog.far);
    this.sun.color.set(map.sun.color);
    this.sun.intensity = map.sun.intensity;
    this.sun.position.set(-map.sun.direction[0] * 50, -map.sun.direction[1] * 50, -map.sun.direction[2] * 50);
    this.hemisphere.color.set(map.ambient.sky);
    this.hemisphere.groundColor.set(map.ambient.ground);
    this.hemisphere.intensity = map.ambient.intensity;
    this.updateOutline();
    this.updatePanel();
    this.updateStatus();
  }

  private updateOutline(): void {
    const box = this.selectionBox();
    this.outline.visible = box !== null;
    if (!box) return;
    this.outline.position.set(box[0] + box[3] / 2, box[1] + box[4] / 2, box[2] + box[5] / 2);
    this.outline.scale.set(Math.max(0.05, box[3]), Math.max(0.05, box[4]), Math.max(0.05, box[5]));
  }

  /** Box della selezione: angolo minimo e dimensioni. */
  private selectionBox(): [number, number, number, number, number, number] | null {
    const s = this.selection;
    if (!s) return null;
    const map = this.map;
    if (s.kind === 'block') {
      const b = map.blocks[s.index];
      return b ? [b.pos[0], b.pos[1], b.pos[2], b.size[0], b.size[1], b.size[2]] : null;
    }
    const point =
      s.kind === 'spawn' ? map.spawns[s.index]?.pos : s.kind === 'flag' ? map.flags?.[s.index]?.pos : map.lights?.[s.index]?.pos;
    if (!point) return null;
    const height = s.kind === 'light' ? 0.5 : 2.2;
    const y = s.kind === 'light' ? point[1] - 0.25 : point[1];
    return [point[0] - 0.5, y, point[2] - 0.5, 1, height, 1];
  }

  private updateStatus(): void {
    const status = byId('ed-status');
    const problem = this.validate();
    status.textContent = problem
      ? problem
      : `Mappa valida · ${this.map.blocks.length} blocchi, ${this.map.spawns.length} rinascite, ${this.map.flags?.length ?? 0} bandiere, ${this.map.lights?.length ?? 0} luci`;
    status.classList.toggle('error', problem !== null);
    byId<HTMLInputElement>('ed-name').value = this.map.name;
  }

  private resize(): void {
    const viewport = byId('viewport');
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = this.last === 0 ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.move(dt);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.sky) this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  };

  private move(dt: number): void {
    if (this.typing()) return;
    const speed = MOVE_SPEED * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1) * dt;
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const right = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const up = (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const cp = Math.cos(this.pitch);
    const p = this.camera.position;
    p.x += (-sy * cp * forward + cy * right) * speed;
    p.y += (Math.sin(this.pitch) * forward + up) * speed;
    p.z += (-cy * cp * forward - sy * right) * speed;
  }

  // -------------------------------------------------------------------------------------------
  // Vista: sguardo, scelta, tastiera
  // -------------------------------------------------------------------------------------------

  private typing(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement;
  }

  private bindViewport(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => {
      (document.activeElement as HTMLElement | null)?.blur();
      this.dragged = 0;
      if (event.button === 2) {
        this.looking = true;
        canvas.setPointerCapture(event.pointerId);
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      this.dragged += Math.abs(event.movementX) + Math.abs(event.movementY);
      if (!this.looking) return;
      this.yaw -= event.movementX * LOOK_SPEED;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - event.movementY * LOOK_SPEED));
    });
    canvas.addEventListener('pointerup', (event) => {
      if (event.button === 2) this.looking = false;
      if (event.button === 0 && this.dragged < 6) this.pick(event);
    });
    window.addEventListener('keydown', (event) => {
      if (this.typing()) return;
      this.keys.add(event.code);
      this.shortcut(event);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private pick(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    // Il primo oggetto colpito (il più vicino): blocco, rinascita, bandiera o luce.
    let target: Object3D | null = null;
    for (const hit of hits) {
      let object: Object3D | null = hit.object;
      while (object && !object.userData.kind) object = object.parent;
      if (object) {
        target = object;
        break;
      }
    }
    this.selection = target ? { kind: target.userData.kind as Kind, index: target.userData.index as number } : null;
    this.updateOutline();
    this.updatePanel();
  }

  private gridStep(): number {
    const value = Number(byId<HTMLInputElement>('grid-step').value);
    return Number.isFinite(value) && value > 0 ? value : 0.5;
  }

  private shortcut(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ctrl && event.code === 'KeyY') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (ctrl && event.code === 'KeyD') {
      event.preventDefault();
      this.duplicate();
      return;
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
      this.remove();
      return;
    }
    if (event.code === 'Escape') {
      this.selection = null;
      this.updateOutline();
      this.updatePanel();
      return;
    }
    const step = this.gridStep();
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (event.code === 'ArrowLeft') dx = -step;
    else if (event.code === 'ArrowRight') dx = step;
    else if (event.code === 'ArrowUp') dz = -step;
    else if (event.code === 'ArrowDown') dz = step;
    else if (event.code === 'PageUp') dy = step;
    else if (event.code === 'PageDown') dy = -step;
    else return;
    event.preventDefault();
    if (event.altKey) this.resizeSelection(dx, dy, dz);
    else this.moveSelection(dx, dy, dz);
  }

  private moveSelection(dx: number, dy: number, dz: number): void {
    const s = this.selection;
    if (!s) return;
    this.checkpoint();
    const point = this.pointOf(s);
    if (point) {
      point[0] = round(point[0] + dx, 0.001);
      point[1] = round(point[1] + dy, 0.001);
      point[2] = round(point[2] + dz, 0.001);
    }
    this.changed();
  }

  private resizeSelection(dx: number, dy: number, dz: number): void {
    const s = this.selection;
    if (!s || s.kind !== 'block') return;
    const block = this.map.blocks[s.index]!;
    this.checkpoint();
    const step = this.gridStep();
    block.size[0] = Math.max(step, round(block.size[0] + dx, 0.001));
    block.size[1] = Math.max(step, round(block.size[1] + dy, 0.001));
    block.size[2] = Math.max(step, round(block.size[2] + dz, 0.001));
    this.changed();
  }

  /** Posizione modificabile della selezione (l'angolo per i blocchi). */
  private pointOf(s: Selection): [number, number, number] | null {
    if (s.kind === 'block') return this.map.blocks[s.index]?.pos ?? null;
    if (s.kind === 'spawn') return this.map.spawns[s.index]?.pos ?? null;
    if (s.kind === 'flag') return this.map.flags?.[s.index]?.pos ?? null;
    return this.map.lights?.[s.index]?.pos ?? null;
  }

  private duplicate(): void {
    const s = this.selection;
    if (!s) return;
    this.checkpoint();
    const offset = this.gridStep() * 2;
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    if (s.kind === 'block') {
      const block = copy(this.map.blocks[s.index]!);
      block.pos[0] += Math.max(offset, block.size[0]);
      this.map.blocks.push(block);
      this.selection = { kind: 'block', index: this.map.blocks.length - 1 };
    } else if (s.kind === 'spawn') {
      const spawn = copy(this.map.spawns[s.index]!);
      spawn.pos[0] += offset;
      this.map.spawns.push(spawn);
      this.selection = { kind: 'spawn', index: this.map.spawns.length - 1 };
    } else if (s.kind === 'light') {
      const lights = (this.map.lights ??= []);
      if (lights.length >= MAX_MAP_LIGHTS) return;
      const light = copy(lights[s.index]!);
      light.pos[0] += offset;
      lights.push(light);
      this.selection = { kind: 'light', index: lights.length - 1 };
    }
    this.changed();
  }

  private remove(): void {
    const s = this.selection;
    if (!s) return;
    this.checkpoint();
    if (s.kind === 'block') this.map.blocks.splice(s.index, 1);
    else if (s.kind === 'spawn') this.map.spawns.splice(s.index, 1);
    else if (s.kind === 'flag') this.map.flags?.splice(s.index, 1);
    else this.map.lights?.splice(s.index, 1);
    this.selection = null;
    this.changed();
  }

  /** Punto davanti alla visuale (sulla superficie guardata, o a 8 m), sulla griglia. */
  private placementPoint(): [number, number, number] {
    this.raycaster.setFromCamera(new Vector2(0, 0), this.camera);
    const hit = this.raycaster.intersectObjects(this.content.children, true)[0];
    const point = hit ? hit.point.clone() : this.camera.position.clone().add(new Vector3(0, 0, -8).applyEuler(this.camera.rotation));
    if (hit?.face) point.addScaledVector(hit.face.normal.clone().transformDirection(hit.object.matrixWorld), 0.01);
    const step = this.gridStep();
    return [round(point.x, step), Math.max(0, round(point.y, step)), round(point.z, step)];
  }

  // -------------------------------------------------------------------------------------------
  // Pannelli
  // -------------------------------------------------------------------------------------------

  private bindUi(): void {
    const open = byId<HTMLSelectElement>('ed-open');
    open.append(new Option('—', ''));
    for (const id of this.bundled.keys()) open.append(new Option(id, id));
    open.addEventListener('change', () => {
      const raw = this.bundled.get(open.value);
      open.value = '';
      if (!raw) return;
      this.replace(parseMap(JSON.parse(JSON.stringify(raw)), open.value));
    });
    byId('ed-new').addEventListener('click', () => this.replace(emptyMap()));
    const file = byId<HTMLInputElement>('ed-import-file');
    byId('ed-import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (!chosen) return;
      void chosen.text().then((text) => {
        try {
          this.replace(parseMap(JSON.parse(text), chosen.name));
        } catch (error) {
          byId('ed-status').textContent = `Importazione non riuscita: ${error instanceof Error ? error.message : String(error)}`;
          byId('ed-status').classList.add('error');
        }
      });
    });
    byId('ed-export').addEventListener('click', () => this.exportJson());
    byId('ed-undo').addEventListener('click', () => this.undo());
    byId('ed-redo').addEventListener('click', () => this.redo());
    byId('ed-test').addEventListener('click', () => {
      const problem = this.validate();
      if (problem) {
        byId('ed-status').textContent = `Prima di provarla: ${problem}`;
        return;
      }
      this.save();
      window.open('./?mappa=editor', '_blank');
    });
    const name = byId<HTMLInputElement>('ed-name');
    name.addEventListener('change', () => {
      this.checkpoint();
      this.map.name = name.value.trim() || 'Senza nome';
      this.changed();
    });
    const color = () => byId<HTMLInputElement>('new-color').value;
    byId('add-box').addEventListener('click', () => this.addBlock('box', color()));
    byId('add-ramp').addEventListener('click', () => this.addBlock('ramp', color()));
    byId('add-spawn').addEventListener('click', () => {
      this.checkpoint();
      this.map.spawns.push({ pos: this.placementPoint(), yaw: 0, team: 0 });
      this.selection = { kind: 'spawn', index: this.map.spawns.length - 1 };
      this.changed();
    });
    for (const team of [1, 2]) {
      byId(`add-flag-${team}`).addEventListener('click', () => {
        this.checkpoint();
        const flags = (this.map.flags ??= []);
        const existing = flags.findIndex((f) => f.team === team);
        const point = this.placementPoint();
        if (existing >= 0) flags[existing]!.pos = point;
        else flags.push({ team, pos: point });
        this.selection = { kind: 'flag', index: existing >= 0 ? existing : flags.length - 1 };
        this.changed();
      });
    }
    byId('add-light').addEventListener('click', () => {
      const lights = (this.map.lights ??= []);
      if (lights.length >= MAX_MAP_LIGHTS) {
        byId('ed-status').textContent = `Al massimo ${MAX_MAP_LIGHTS} luci.`;
        return;
      }
      this.checkpoint();
      const point = this.placementPoint();
      lights.push({ pos: [point[0], point[1] + 3, point[2]], color: '#ffd38a', intensity: 15, distance: 14 });
      this.selection = { kind: 'light', index: lights.length - 1 };
      this.changed();
    });
    byId('sel-duplicate').addEventListener('click', () => this.duplicate());
    byId('sel-delete').addEventListener('click', () => this.remove());
  }

  private addBlock(type: MapBlock['type'], color: string): void {
    this.checkpoint();
    const [x, y, z] = this.placementPoint();
    const block: MapBlock = { pos: [x - 1, y, z - 1], size: [2, 2, 2], color, type };
    if (type === 'ramp') {
      block.size = [2, 1, 4];
      block.dir = '-z';
    }
    this.map.blocks.push(block);
    this.selection = { kind: 'block', index: this.map.blocks.length - 1 };
    this.changed();
  }

  private exportJson(): void {
    const text = JSON.stringify(this.map, null, 2) + '\n';
    const slug = this.map.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mappa';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = `${slug}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /** Campi della selezione, o delle impostazioni della mappa se non c'è selezione. */
  private updatePanel(): void {
    const fields = byId('sel-fields');
    fields.replaceChildren();
    const s = this.selection;
    byId('sel-actions').hidden = s === null || s.kind === 'flag';
    const title = byId('sel-title');
    const number = (label: string, get: () => number, set: (v: number) => void, step = this.gridStep()) =>
      this.field(fields, label, 'number', String(get()), (value) => set(Number(value)), step);
    const color = (label: string, get: () => string, set: (v: string) => void) => this.field(fields, label, 'color', get(), set);
    const vec = (label: string, v: number[], step?: number) => {
      ['x', 'y', 'z'].forEach((axis, i) => number(`${label} ${axis}`, () => v[i]!, (value) => (v[i] = value), step));
    };
    if (!s) {
      title.textContent = 'Mappa';
      const m = this.map;
      number('Quota di caduta (m)', () => m.killY, (v) => (m.killY = v), 1);
      color('Cielo in alto', () => m.sky.top, (v) => (m.sky.top = v));
      color('Cielo all\'orizzonte', () => m.sky.horizon, (v) => (m.sky.horizon = v));
      color('Cielo in basso', () => m.sky.bottom, (v) => (m.sky.bottom = v));
      color('Nebbia', () => m.fog.color, (v) => (m.fog.color = v));
      number('Nebbia da (m)', () => m.fog.near, (v) => (m.fog.near = v), 5);
      number('Nebbia fino a (m)', () => m.fog.far, (v) => (m.fog.far = v), 5);
      color('Sole', () => m.sun.color, (v) => (m.sun.color = v));
      number('Intensità del sole', () => m.sun.intensity, (v) => (m.sun.intensity = v), 0.1);
      vec('Direzione del sole', m.sun.direction, 0.05);
      color('Luce dal cielo', () => m.ambient.sky, (v) => (m.ambient.sky = v));
      color('Luce dal suolo', () => m.ambient.ground, (v) => (m.ambient.ground = v));
      number('Intensità ambiente', () => m.ambient.intensity, (v) => (m.ambient.intensity = v), 0.1);
      return;
    }
    if (s.kind === 'block') {
      const b = this.map.blocks[s.index]!;
      title.textContent = b.type === 'ramp' ? 'Rampa' : 'Blocco';
      vec('Posizione', b.pos);
      vec('Dimensione', b.size);
      color('Colore', () => b.color, (v) => (b.color = v));
      this.select(fields, 'Tipo', ['box', 'ramp'], b.type, (v) => {
        b.type = v as MapBlock['type'];
        if (b.type === 'ramp') b.dir ??= '-z';
        else delete b.dir;
      });
      if (b.type === 'ramp') this.select(fields, 'Sale verso', RAMP_DIRECTIONS, b.dir ?? '-z', (v) => (b.dir = v as RampDirection));
    } else if (s.kind === 'spawn') {
      const spawn = this.map.spawns[s.index]!;
      title.textContent = 'Rinascita';
      vec('Posizione', spawn.pos);
      number('Sguardo (gradi)', () => spawn.yaw, (v) => (spawn.yaw = v), 15);
      this.select(fields, 'Squadra', ['0', '1', '2'], String(spawn.team ?? 0), (v) => (spawn.team = Number(v)));
    } else if (s.kind === 'flag') {
      const flag = this.map.flags![s.index]!;
      title.textContent = flag.team === 1 ? 'Bandiera rossa' : 'Bandiera blu';
      vec('Posizione', flag.pos);
    } else {
      const light = this.map.lights![s.index]!;
      title.textContent = 'Luce';
      vec('Posizione', light.pos);
      color('Colore', () => light.color, (v) => (light.color = v));
      number('Intensità', () => light.intensity, (v) => (light.intensity = v), 1);
      number('Portata (m)', () => light.distance, (v) => (light.distance = v), 1);
    }
  }

  private field(parent: HTMLElement, label: string, type: string, value: string, apply: (value: string) => void, step = 0.5): void {
    const row = document.createElement('label');
    row.className = 'row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    if (type === 'number') input.step = String(step);
    input.addEventListener('change', () => {
      if (type === 'number' && !Number.isFinite(Number(input.value))) return;
      this.checkpoint();
      apply(input.value);
      this.changed();
    });
    row.append(text, input);
    parent.append(row);
  }

  private select(parent: HTMLElement, label: string, options: readonly string[], value: string, apply: (value: string) => void): void {
    const row = document.createElement('label');
    row.className = 'row';
    const text = document.createElement('span');
    text.textContent = label;
    const select = document.createElement('select');
    for (const option of options) select.append(new Option(option, option));
    select.value = value;
    select.addEventListener('change', () => {
      this.checkpoint();
      apply(select.value);
      this.changed();
    });
    row.append(text, select);
    parent.append(row);
  }
}
