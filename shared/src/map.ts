/**
 * Formato delle mappe (file JSON in /content/maps) e relativa validazione.
 * Una mappa non valida produce un errore chiaro al caricamento, mai un crash in partita.
 */

export type Vec3Tuple = [number, number, number];

/** Direzione verso cui sale una rampa. */
export type RampDirection = '+x' | '-x' | '+z' | '-z';

export interface MapBlock {
  /** Angolo minimo del blocco (x, y, z). */
  pos: Vec3Tuple;
  /** Dimensioni: larghezza (x), altezza (y), profondità (z). Tutte maggiori di zero. */
  size: Vec3Tuple;
  /** Colore nel formato #rrggbb. */
  color: string;
  /** "box" = blocco pieno; "ramp" = cuneo pieno che sale da 0 all'altezza del blocco. */
  type: 'box' | 'ramp';
  /** Solo per le rampe: direzione verso cui la rampa sale. */
  dir?: RampDirection;
}

export interface SpawnPoint {
  /** Posizione dei piedi. */
  pos: Vec3Tuple;
  /** Direzione dello sguardo in gradi. 0 = verso -z, 90 = verso -x. */
  yaw: number;
}

export interface MapData {
  version: 1;
  name: string;
  /** Sotto questa quota il giocatore viene riportato a un punto di rinascita. */
  killY: number;
  spawns: SpawnPoint[];
  blocks: MapBlock[];
  /** Punti di navigazione dei bot (all'altezza dei piedi). Facoltativi. */
  waypoints: Vec3Tuple[];
  sky: { top: string; horizon: string; bottom: string };
  fog: { color: string; near: number; far: number };
  /** Luce del sole. `direction` è la direzione in cui viaggia la luce. */
  sun: { direction: Vec3Tuple; color: string; intensity: number };
  /** Luce ambiente emisferica. */
  ambient: { sky: string; ground: string; intensity: number };
}

export class MapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapValidationError';
  }
}

type JsonObject = Record<string, unknown>;

class Validator {
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  fail(path: string, message: string): never {
    throw new MapValidationError(`${this.source}: "${path}" ${message}`);
  }

  object(value: unknown, path: string): JsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'deve essere un oggetto');
    }
    return value as JsonObject;
  }

  array(value: unknown, path: string, minLength: number): unknown[] {
    if (!Array.isArray(value)) this.fail(path, 'deve essere una lista');
    if (value.length < minLength) this.fail(path, `deve contenere almeno ${minLength} elementi`);
    return value;
  }

  number(value: unknown, path: string, options: { positive?: boolean } = {}): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(path, 'deve essere un numero');
    if (options.positive && value <= 0) this.fail(path, 'deve essere maggiore di zero');
    return value;
  }

  string(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.length === 0) this.fail(path, 'deve essere un testo non vuoto');
    return value;
  }

  color(value: unknown, path: string): string {
    const text = this.string(value, path);
    if (!/^#[0-9a-fA-F]{6}$/.test(text)) this.fail(path, `deve essere un colore #rrggbb (trovato "${text}")`);
    return text;
  }

  vec3(value: unknown, path: string, options: { positive?: boolean } = {}): Vec3Tuple {
    const list = this.array(value, path, 3);
    if (list.length !== 3) this.fail(path, 'deve contenere esattamente 3 numeri');
    return [
      this.number(list[0], `${path}[0]`, options),
      this.number(list[1], `${path}[1]`, options),
      this.number(list[2], `${path}[2]`, options),
    ];
  }
}

const RAMP_DIRECTIONS: readonly RampDirection[] = ['+x', '-x', '+z', '-z'];

/**
 * Controlla un oggetto letto da JSON e restituisce una mappa tipizzata.
 * @param source nome del file, usato nei messaggi di errore.
 */
export function parseMap(raw: unknown, source = 'mappa'): MapData {
  const v = new Validator(source);
  const root = v.object(raw, '(radice)');

  if (root.version !== 1) v.fail('version', 'deve essere 1');
  const name = v.string(root.name, 'name');
  const killY = v.number(root.killY, 'killY');

  const spawns = v.array(root.spawns, 'spawns', 1).map((item, i): SpawnPoint => {
    const spawn = v.object(item, `spawns[${i}]`);
    return { pos: v.vec3(spawn.pos, `spawns[${i}].pos`), yaw: v.number(spawn.yaw, `spawns[${i}].yaw`) };
  });

  const blocks = v.array(root.blocks, 'blocks', 1).map((item, i): MapBlock => {
    const path = `blocks[${i}]`;
    const block = v.object(item, path);
    const rawType = block.type ?? 'box';
    if (rawType !== 'box' && rawType !== 'ramp') v.fail(`${path}.type`, 'deve essere "box" oppure "ramp"');
    const type: MapBlock['type'] = rawType === 'ramp' ? 'ramp' : 'box';
    const parsed: MapBlock = {
      pos: v.vec3(block.pos, `${path}.pos`),
      size: v.vec3(block.size, `${path}.size`, { positive: true }),
      color: v.color(block.color, `${path}.color`),
      type,
    };
    if (type === 'ramp') {
      const dir = block.dir;
      if (typeof dir !== 'string' || !RAMP_DIRECTIONS.includes(dir as RampDirection)) {
        v.fail(`${path}.dir`, 'deve essere "+x", "-x", "+z" oppure "-z" per una rampa');
      }
      parsed.dir = dir as RampDirection;
    }
    return parsed;
  });

  const waypoints =
    root.waypoints === undefined
      ? []
      : v.array(root.waypoints, 'waypoints', 0).map((item, i) => v.vec3(item, `waypoints[${i}]`));

  const sky = v.object(root.sky, 'sky');
  const fog = v.object(root.fog, 'fog');
  const sun = v.object(root.sun, 'sun');
  const ambient = v.object(root.ambient, 'ambient');

  const fogNear = v.number(fog.near, 'fog.near');
  const fogFar = v.number(fog.far, 'fog.far');
  if (fogFar <= fogNear) v.fail('fog.far', 'deve essere maggiore di fog.near');

  const sunDirection = v.vec3(sun.direction, 'sun.direction');
  if (Math.hypot(...sunDirection) < 1e-6) v.fail('sun.direction', 'non può essere nulla');

  return {
    version: 1,
    name,
    killY,
    spawns,
    blocks,
    waypoints,
    sky: {
      top: v.color(sky.top, 'sky.top'),
      horizon: v.color(sky.horizon, 'sky.horizon'),
      bottom: v.color(sky.bottom, 'sky.bottom'),
    },
    fog: { color: v.color(fog.color, 'fog.color'), near: fogNear, far: fogFar },
    sun: {
      direction: sunDirection,
      color: v.color(sun.color, 'sun.color'),
      intensity: v.number(sun.intensity, 'sun.intensity'),
    },
    ambient: {
      sky: v.color(ambient.sky, 'ambient.sky'),
      ground: v.color(ambient.ground, 'ambient.ground'),
      intensity: v.number(ambient.intensity, 'ambient.intensity'),
    },
  };
}
