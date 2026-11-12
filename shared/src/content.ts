/**
 * Contenuti di gioco letti da JSON: armi (/content/weapons), equipaggiamento (/content/equipment),
 * classi (/content/classes), modelli delle armi (/content/weapon-models), skin di armi e personaggi
 * (/content/skins) e suoni (/content/sounds).
 *
 * Il caricamento controlla ogni file e i riferimenti tra file (modelli, suoni, parti colorate dalle
 * skin) e raccoglie tutti i problemi: se qualcosa non va, si ferma all'avvio con un elenco chiaro.
 * Il codice è puro: chi chiama legge i file (bundle di Vite nel browser, fs in Node).
 */
import { MAX_PELLETS } from './events.ts';
import type { Vec3Tuple } from './map.ts';
import { Validator, type JsonObject } from './validation.ts';
import { PART_NAMES, type PartName } from './pose.ts';
import type { ClassDef, MeleeDef, ProjectileDef, ThrowableDef, WeaponDef, CombatContent } from './weapons.ts';

/** Parti del modello con un'animazione propria. */
export type PartRole = 'magazine' | 'slide' | 'pump' | 'bolt' | 'cylinder';
export const PART_ROLES: readonly PartRole[] = ['magazine', 'slide', 'pump', 'bolt', 'cylinder'];

export interface ModelPart {
  /** Nome della parte: le skin cambiano colore per nome. */
  name: string;
  /** Animazione: caricatore (ricarica), carrello e otturatore (sparo), pompa, tamburo. */
  role: PartRole | null;
  /** Centro del box. */
  pos: Vec3Tuple;
  size: Vec3Tuple;
  /** Rotazione in gradi (ordine XYZ). */
  rotation: Vec3Tuple;
  color: string;
}

export interface WeaponModelDef {
  id: string;
  parts: readonly ModelPart[];
  /** Bocca della canna. */
  muzzle: Vec3Tuple;
  /** Finestra di espulsione dei bossoli (null = niente bossoli). */
  eject: Vec3Tuple | null;
  /** Mirando, la linea di mira (a questa quota del modello) va al centro dello schermo, a questa distanza. */
  sight: { height: number; distance: number };
  hands: { right: Vec3Tuple; left: Vec3Tuple };
}

/** Skin di un'arma: nuovi colori per le parti del modello, per nome. */
export interface SkinDef {
  type: 'weapon';
  id: string;
  name: string;
  weapon: string;
  /** Nuovo colore per ogni nome di parte del modello. */
  colors: Readonly<Record<string, string>>;
}

/** Dettagli del personaggio con un colore proprio, oltre alle sei parti. */
export const CHARACTER_DETAILS = ['hair', 'eyes', 'hands', 'feet', 'belt'] as const;
export type CharacterDetail = (typeof CHARACTER_DETAILS)[number];

/** Box di un accessorio, nello spazio della parte a cui è attaccato (origine nel giunto). */
export interface AccessoryBox {
  pos: Vec3Tuple;
  size: Vec3Tuple;
  /** Rotazione in gradi (ordine XYZ). */
  rotation: Vec3Tuple;
  color: string;
}

/** Accessorio fatto di box (cappello, zaino...), attaccato a una parte del corpo. */
export interface AccessoryDef {
  name: string;
  part: PartName;
  boxes: readonly AccessoryBox[];
}

/** Skin di un personaggio: colore di ogni parte, dettagli e accessori. */
export interface CharacterSkinDef {
  type: 'character';
  id: string;
  name: string;
  /** Posizione nell'elenco delle skin (la prima è quella predefinita). */
  order: number;
  colors: Readonly<Record<PartName | CharacterDetail, string>>;
  accessories: readonly AccessoryDef[];
}

/** Box massimi negli accessori di una skin (tutti i personaggi si disegnano insieme). */
export const MAX_ACCESSORY_BOXES = 16;

/** Colori dei dettagli quando la skin non li indica. */
const DETAIL_DEFAULTS: Readonly<Record<CharacterDetail, string>> = {
  hair: '#3b2a1e',
  eyes: '#1b1b1b',
  hands: '#e0b48a',
  feet: '#2a2420',
  belt: '#2a2420',
};

export interface SoundLayer {
  type: 'noise' | 'tone';
  start: number;
  duration: number;
  peak: number;
  attack: number;
  /** Rumore: filtro applicato. */
  filter: 'lowpass' | 'highpass' | 'bandpass';
  q: number;
  /** Tono: forma d'onda. */
  wave: 'sine' | 'square' | 'triangle' | 'sawtooth';
  /** Frequenza iniziale (Hz) e finale (null = costante). */
  from: number;
  to: number | null;
}

export interface SoundDef {
  id: string;
  seconds: number;
  layers: readonly SoundLayer[];
}

export interface ContentFile {
  /** Percorso del file, usato nei messaggi di errore. */
  path: string;
  data: unknown;
}

export interface ContentSources {
  weapons: readonly ContentFile[];
  equipment: readonly ContentFile[];
  models: readonly ContentFile[];
  skins: readonly ContentFile[];
  sounds: readonly ContentFile[];
  /** Classi dei personaggi (facoltative: senza classi ognuno ha tutte le armi). */
  classes?: readonly ContentFile[];
}

export interface GameContent extends CombatContent {
  models: ReadonlyMap<string, WeaponModelDef>;
  /** Skin delle armi. */
  skins: readonly SkinDef[];
  characterSkins: readonly CharacterSkinDef[];
  classes: readonly ClassDef[];
  sounds: ReadonlyMap<string, SoundDef>;
}

export class ContentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Contenuti non validi (${problems.length}):\n${problems.join('\n')}`);
    this.name = 'ContentError';
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------------------------
// Singoli file
// ---------------------------------------------------------------------------------------------

function optionalId(v: Validator, value: unknown, path: string, fallback: string): string {
  return value === undefined ? fallback : v.id(value, path);
}

function parseProjectile(v: Validator, raw: unknown, path: string): ProjectileDef {
  const o = v.object(raw, path);
  const sounds = v.optionalObject(o.sounds, `${path}.sounds`);
  return {
    kind: v.oneOf(o.kind, `${path}.kind`, ['rocket', 'grenade'] as const),
    speed: v.number(o.speed, `${path}.speed`, { positive: true }),
    gravity: v.optionalNumber(o.gravity, `${path}.gravity`, 0, { min: 0 }),
    radius: v.number(o.radius, `${path}.radius`, { positive: true }),
    lifetime: v.number(o.lifetime, `${path}.lifetime`, { positive: true }),
    fuse: v.optionalNumber(o.fuse, `${path}.fuse`, 0, { min: 0 }),
    bounce: v.optionalNumber(o.bounce, `${path}.bounce`, 0, { min: 0, max: 1 }),
    friction: v.optionalNumber(o.friction, `${path}.friction`, 0, { min: 0, max: 1 }),
    splashRadius: v.number(o.splashRadius, `${path}.splashRadius`, { positive: true }),
    splashDamage: v.number(o.splashDamage, `${path}.splashDamage`, { min: 0 }),
    minSplashFactor: v.optionalNumber(o.minSplashFactor, `${path}.minSplashFactor`, 0, { min: 0, max: 1 }),
    selfDamageFactor: v.optionalNumber(o.selfDamageFactor, `${path}.selfDamageFactor`, 1, { min: 0 }),
    knockback: v.optionalNumber(o.knockback, `${path}.knockback`, 0, { min: 0 }),
    selfKnockbackFactor: v.optionalNumber(o.selfKnockbackFactor, `${path}.selfKnockbackFactor`, 1, { min: 0 }),
    model: v.id(o.model, `${path}.model`),
    sounds: {
      explode: optionalId(v, sounds?.explode, `${path}.sounds.explode`, 'explosion'),
      bounce: optionalId(v, sounds?.bounce, `${path}.sounds.bounce`, 'bounce'),
    },
  };
}

function parseMelee(v: Validator, raw: unknown, path: string): MeleeDef {
  const o = v.object(raw, path);
  return {
    reach: v.number(o.reach, `${path}.reach`, { positive: true }),
    radius: v.optionalNumber(o.radius, `${path}.radius`, 0, { min: 0 }),
    backstabMultiplier: v.optionalNumber(o.backstabMultiplier, `${path}.backstabMultiplier`, 1, { min: 1 }),
  };
}

export function parseWeapon(raw: unknown, source: string): WeaponDef {
  const v = new Validator(source);
  const o = v.object(raw, '(radice)');
  const id = v.id(o.id, 'id');
  const name = v.string(o.name, 'name');
  const kind = v.oneOf(o.type, 'type', ['hitscan', 'projectile', 'melee'] as const);
  const melee = kind === 'melee';
  const range: JsonObject = v.optionalObject(o.range, 'range') ?? {};
  const spread: JsonObject = v.optionalObject(o.spread, 'spread') ?? {};
  const recoil: JsonObject = v.optionalObject(o.recoil, 'recoil') ?? {};
  const ads: JsonObject = v.optionalObject(o.ads, 'ads') ?? {};
  const gore: JsonObject = v.optionalObject(o.gore, 'gore') ?? {};
  const sounds = v.object(o.sounds, 'sounds');
  const bot = v.optionalObject(o.bot, 'bot');

  const pattern =
    recoil.pattern === undefined
      ? [[0, 0] as const]
      : v.array(recoil.pattern, 'recoil.pattern', 1).map((entry, i) => {
          const pair = v.array(entry, `recoil.pattern[${i}]`, 2);
          if (pair.length !== 2) v.fail(`recoil.pattern[${i}]`, 'deve contenere 2 numeri: [in alto, a destra]');
          return [v.number(pair[0], `recoil.pattern[${i}][0]`), v.number(pair[1], `recoil.pattern[${i}][1]`)] as const;
        });

  const nonNegative = { min: 0 };
  const def: WeaponDef = {
    id,
    name,
    shortName: v.optionalString(o.shortName, 'shortName', name),
    order: v.optionalNumber(o.order, 'order', 100),
    kind,
    damage: v.number(o.damage, 'damage', nonNegative),
    headMultiplier: v.optionalNumber(o.headMultiplier, 'headMultiplier', 1, { positive: true }),
    limbMultiplier: v.optionalNumber(o.limbMultiplier, 'limbMultiplier', 1, { positive: true }),
    fireRate: v.number(o.fireRate, 'fireRate', { positive: true }),
    auto: v.optionalBoolean(o.auto, 'auto', false),
    magazine: melee ? 0 : v.number(o.magazine, 'magazine', { integer: true, min: 1 }),
    reloadTime: melee ? 0 : v.number(o.reloadTime, 'reloadTime', nonNegative),
    drawTime: v.optionalNumber(o.drawTime, 'drawTime', 0.4, nonNegative),
    pellets: v.optionalNumber(o.pellets, 'pellets', 1, { integer: true, min: 1, max: MAX_PELLETS }),
    range: {
      start: v.optionalNumber(range.start, 'range.start', 0, nonNegative),
      end: v.optionalNumber(range.end, 'range.end', 0, nonNegative),
      minDamageFactor: v.optionalNumber(range.minDamageFactor, 'range.minDamageFactor', 1, { min: 0, max: 1 }),
    },
    spread: {
      base: v.optionalNumber(spread.base, 'spread.base', 0, nonNegative),
      moving: v.optionalNumber(spread.moving, 'spread.moving', 0, nonNegative),
      air: v.optionalNumber(spread.air, 'spread.air', 0, nonNegative),
      perShot: v.optionalNumber(spread.perShot, 'spread.perShot', 0, nonNegative),
      max: v.optionalNumber(spread.max, 'spread.max', 0, nonNegative),
      recovery: v.optionalNumber(spread.recovery, 'spread.recovery', 0, nonNegative),
      ads: v.optionalNumber(spread.ads, 'spread.ads', 1, nonNegative),
    },
    recoil: {
      pattern,
      recovery: v.optionalNumber(recoil.recovery, 'recoil.recovery', 6, nonNegative),
      ads: v.optionalNumber(recoil.ads, 'recoil.ads', 1, nonNegative),
    },
    ads: {
      zoom: v.optionalNumber(ads.zoom, 'ads.zoom', 1, { min: 1 }),
      time: v.optionalNumber(ads.time, 'ads.time', 0.15, nonNegative),
      moveFactor: v.optionalNumber(ads.moveFactor, 'ads.moveFactor', 1, { positive: true }),
      scope: v.optionalBoolean(ads.scope, 'ads.scope', false),
    },
    moveSpeedFactor: v.optionalNumber(o.moveSpeedFactor, 'moveSpeedFactor', 1, { positive: true }),
    projectile: kind === 'projectile' ? parseProjectile(v, o.projectile, 'projectile') : null,
    melee: melee ? parseMelee(v, o.melee, 'melee') : null,
    gore: {
      dismember: v.optionalBoolean(gore.dismember, 'gore.dismember', false),
      gibChance: v.optionalNumber(gore.gibChance, 'gore.gibChance', 0, { min: 0, max: 1 }),
    },
    model: v.id(o.model, 'model'),
    sounds: {
      fire: v.id(sounds.fire, 'sounds.fire'),
      reload: optionalId(v, sounds.reload, 'sounds.reload', 'reload'),
      reloadEnd: optionalId(v, sounds.reloadEnd, 'sounds.reloadEnd', 'reload_end'),
      draw: optionalId(v, sounds.draw, 'sounds.draw', 'switch'),
      hit: sounds.hit === undefined ? null : v.id(sounds.hit, 'sounds.hit'),
    },
    bot: bot ? { preferredRange: v.number(bot.preferredRange, 'bot.preferredRange', { positive: true }) } : null,
  };
  if (def.range.end < def.range.start) v.fail('range.end', 'deve essere almeno uguale a range.start');
  return def;
}

export function parseThrowable(raw: unknown, source: string): ThrowableDef {
  const v = new Validator(source);
  const o = v.object(raw, '(radice)');
  v.oneOf(o.type, 'type', ['grenade'] as const);
  const sounds = v.optionalObject(o.sounds, 'sounds');
  return {
    id: v.id(o.id, 'id'),
    name: v.string(o.name, 'name'),
    count: v.number(o.count, 'count', { integer: true, min: 0 }),
    cooldown: v.optionalNumber(o.cooldown, 'cooldown', 0.8, { min: 0 }),
    throwUp: v.optionalNumber(o.throwUp, 'throwUp', 0),
    inheritVelocity: v.optionalNumber(o.inheritVelocity, 'inheritVelocity', 0, { min: 0, max: 1 }),
    projectile: parseProjectile(v, o.projectile, 'projectile'),
    sounds: { throw: optionalId(v, sounds?.throw, 'sounds.throw', 'throw') },
  };
}

/** Bocca, mirino e mani sono facoltativi: i modelli dei proiettili (razzo, granata) non li usano. */
export function parseWeaponModel(raw: unknown, source: string): WeaponModelDef {
  const v = new Validator(source);
  const o = v.object(raw, '(radice)');
  const sight: JsonObject = v.optionalObject(o.sight, 'sight') ?? { height: 0, distance: 0.3 };
  const hands: JsonObject = v.optionalObject(o.hands, 'hands') ?? { right: [0, 0, 0], left: [0, 0, 0] };
  return {
    id: v.id(o.id, 'id'),
    parts: v.array(o.parts, 'parts', 1).map((item, i): ModelPart => {
      const path = `parts[${i}]`;
      const part = v.object(item, path);
      return {
        name: v.id(part.name, `${path}.name`),
        role: part.role === undefined ? null : v.oneOf(part.role, `${path}.role`, PART_ROLES),
        pos: v.vec3(part.pos, `${path}.pos`),
        size: v.vec3(part.size, `${path}.size`, { positive: true }),
        rotation: part.rotation === undefined ? [0, 0, 0] : v.vec3(part.rotation, `${path}.rotation`),
        color: v.color(part.color, `${path}.color`),
      };
    }),
    muzzle: o.muzzle === undefined ? [0, 0, 0] : v.vec3(o.muzzle, 'muzzle'),
    eject: o.eject === undefined || o.eject === null ? null : v.vec3(o.eject, 'eject'),
    sight: {
      height: v.number(sight.height, 'sight.height'),
      distance: v.number(sight.distance, 'sight.distance', { positive: true }),
    },
    hands: { right: v.vec3(hands.right, 'hands.right'), left: v.vec3(hands.left, 'hands.left') },
  };
}

/**
 * Una skin: di un'arma (`"type": "weapon"`, oppure nessun tipo ma il campo `weapon`) o di un
 * personaggio (`"type": "character"`).
 */
export function parseSkin(raw: unknown, source: string): SkinDef | CharacterSkinDef {
  const v = new Validator(source);
  const o = v.object(raw, '(radice)');
  const type =
    o.type === undefined && o.weapon !== undefined ? 'weapon' : v.oneOf(o.type, 'type', ['weapon', 'character'] as const);
  if (type === 'character') return parseCharacterSkin(v, o);
  const colorsRaw = v.object(o.colors, 'colors');
  const colors: Record<string, string> = {};
  for (const [part, color] of Object.entries(colorsRaw)) colors[part] = v.color(color, `colors.${part}`);
  if (Object.keys(colors).length === 0) v.fail('colors', 'deve cambiare almeno una parte');
  return { type: 'weapon', id: v.id(o.id, 'id'), name: v.string(o.name, 'name'), weapon: v.id(o.weapon, 'weapon'), colors };
}

function parseCharacterSkin(v: Validator, o: JsonObject): CharacterSkinDef {
  const colorsRaw = v.object(o.colors, 'colors');
  const known: readonly string[] = [...PART_NAMES, ...CHARACTER_DETAILS];
  for (const key of Object.keys(colorsRaw)) {
    if (!known.includes(key)) v.fail(`colors.${key}`, `non è una parte del personaggio (parti: ${known.join(', ')})`);
  }
  const colors = {} as Record<PartName | CharacterDetail, string>;
  for (const part of PART_NAMES) colors[part] = v.color(colorsRaw[part], `colors.${part}`);
  for (const detail of CHARACTER_DETAILS) {
    colors[detail] = colorsRaw[detail] === undefined ? DETAIL_DEFAULTS[detail] : v.color(colorsRaw[detail], `colors.${detail}`);
  }
  const accessories = o.accessories === undefined ? [] : v.array(o.accessories, 'accessories');
  let boxes = 0;
  const result: CharacterSkinDef = {
    type: 'character',
    id: v.id(o.id, 'id'),
    name: v.string(o.name, 'name'),
    order: v.optionalNumber(o.order, 'order', 0),
    colors,
    accessories: accessories.map((item, i): AccessoryDef => {
      const path = `accessories[${i}]`;
      const accessory = v.object(item, path);
      return {
        name: v.string(accessory.name, `${path}.name`),
        part: v.oneOf(accessory.part, `${path}.part`, PART_NAMES),
        boxes: v.array(accessory.boxes, `${path}.boxes`, 1).map((boxRaw, j): AccessoryBox => {
          const boxPath = `${path}.boxes[${j}]`;
          const box = v.object(boxRaw, boxPath);
          boxes++;
          return {
            pos: v.vec3(box.pos, `${boxPath}.pos`),
            size: v.vec3(box.size, `${boxPath}.size`, { positive: true }),
            rotation: box.rotation === undefined ? [0, 0, 0] : v.vec3(box.rotation, `${boxPath}.rotation`),
            color: v.color(box.color, `${boxPath}.color`),
          };
        }),
      };
    }),
  };
  if (boxes > MAX_ACCESSORY_BOXES) v.fail('accessories', `al massimo ${MAX_ACCESSORY_BOXES} box in tutto (ce ne sono ${boxes})`);
  return result;
}

export function parseClass(raw: unknown, source: string): ClassDef {
  const v = new Validator(source);
  const o = v.object(raw, '(radice)');
  return {
    id: v.id(o.id, 'id'),
    name: v.string(o.name, 'name'),
    description: v.optionalString(o.description, 'description', ''),
    order: v.optionalNumber(o.order, 'order', 0),
    health: v.number(o.health, 'health', { min: 1, max: 1000 }),
    speed: v.number(o.speed, 'speed', { min: 0.5, max: 1.6 }),
    jumpHeight: v.number(o.jumpHeight, 'jumpHeight', { min: 0.5, max: 3 }),
    primary: v.id(o.primary, 'primary'),
    secondary: v.id(o.secondary, 'secondary'),
    melee: o.melee === undefined || o.melee === null ? null : v.id(o.melee, 'melee'),
    grenades: v.optionalNumber(o.grenades, 'grenades', -1, { min: 0, max: 9, integer: true }),
  };
}

export function parseSound(raw: unknown, source: string): SoundDef {
  const v = new Validator(source);
  const o = v.object(raw, '(radice)');
  return {
    id: v.id(o.id, 'id'),
    seconds: v.number(o.seconds, 'seconds', { positive: true, max: 10 }),
    layers: v.array(o.layers, 'layers', 1).map((item, i): SoundLayer => {
      const path = `layers[${i}]`;
      const layer = v.object(item, path);
      const type = v.oneOf(layer.type, `${path}.type`, ['noise', 'tone'] as const);
      return {
        type,
        start: v.optionalNumber(layer.start, `${path}.start`, 0, { min: 0 }),
        duration: v.number(layer.duration, `${path}.duration`, { positive: true }),
        peak: v.number(layer.peak, `${path}.peak`, { min: 0, max: 2 }),
        attack: v.optionalNumber(layer.attack, `${path}.attack`, 0.002, { min: 0 }),
        filter:
          layer.filter === undefined
            ? 'lowpass'
            : v.oneOf(layer.filter, `${path}.filter`, ['lowpass', 'highpass', 'bandpass'] as const),
        q: v.optionalNumber(layer.q, `${path}.q`, 0.8, { positive: true }),
        wave:
          layer.wave === undefined
            ? 'sine'
            : v.oneOf(layer.wave, `${path}.wave`, ['sine', 'square', 'triangle', 'sawtooth'] as const),
        from: v.number(layer.from, `${path}.from`, { positive: true }),
        to: layer.to === undefined ? null : v.number(layer.to, `${path}.to`, { positive: true }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Caricamento completo
// ---------------------------------------------------------------------------------------------

export interface LoadOptions {
  /** Suoni che il client usa direttamente (colpi a segno, passi...): devono esistere. */
  requiredSounds?: readonly string[];
}

/** Controlla e collega tutti i contenuti. Se ci sono problemi lancia ContentError con l'elenco completo. */
export function loadContent(sources: ContentSources, options: LoadOptions = {}): GameContent {
  const problems: string[] = [];
  const pathOf = new Map<object, string>();
  // Id dei file che non si sono potuti leggere: i riferimenti a questi non generano altri errori
  // (il problema vero è già nell'elenco).
  const broken = new Set<string>();

  const parseAll = <T extends { id: string }>(files: readonly ContentFile[], parse: (raw: unknown, path: string) => T): T[] => {
    const items: T[] = [];
    const byId = new Map<string, string>();
    for (const file of files) {
      try {
        const item = parse(file.data, file.path);
        const previous = byId.get(item.id);
        if (previous) {
          problems.push(`${file.path}: "id" "${item.id}" è già usato da ${previous}`);
          continue;
        }
        byId.set(item.id, file.path);
        pathOf.set(item, file.path);
        items.push(item);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : `${file.path}: ${String(error)}`);
        const id = (file.data as { id?: unknown } | null)?.id;
        if (typeof id === 'string') broken.add(id);
      }
    }
    return items;
  };

  const weapons = parseAll(sources.weapons, parseWeapon);
  const throwables = parseAll(sources.equipment, parseThrowable);
  const models = new Map(parseAll(sources.models, parseWeaponModel).map((m) => [m.id, m]));
  const allSkins = parseAll(sources.skins, parseSkin);
  const skins = allSkins.filter((s): s is SkinDef => s.type === 'weapon');
  const characterSkins = allSkins.filter((s): s is CharacterSkinDef => s.type === 'character');
  const sounds = new Map(parseAll(sources.sounds, parseSound).map((s) => [s.id, s]));
  const classes = parseAll(sources.classes ?? [], parseClass);

  const needModel = (owner: object, model: string, field: string) => {
    if (models.has(model) || broken.has(model)) return;
    problems.push(`${pathOf.get(owner)}: "${field}" indica il modello "${model}", che non esiste in content/weapon-models`);
  };
  const needSound = (owner: object, sound: string, field: string) => {
    if (sounds.has(sound) || broken.has(sound)) return;
    problems.push(`${pathOf.get(owner)}: "${field}" indica il suono "${sound}", che non esiste in content/sounds`);
  };

  for (const weapon of weapons) {
    needModel(weapon, weapon.model, 'model');
    needSound(weapon, weapon.sounds.fire, 'sounds.fire');
    needSound(weapon, weapon.sounds.reload, 'sounds.reload');
    needSound(weapon, weapon.sounds.reloadEnd, 'sounds.reloadEnd');
    needSound(weapon, weapon.sounds.draw, 'sounds.draw');
    if (weapon.sounds.hit) needSound(weapon, weapon.sounds.hit, 'sounds.hit');
    if (weapon.projectile) {
      needModel(weapon, weapon.projectile.model, 'projectile.model');
      needSound(weapon, weapon.projectile.sounds.explode, 'projectile.sounds.explode');
      needSound(weapon, weapon.projectile.sounds.bounce, 'projectile.sounds.bounce');
    }
  }

  const grenade = throwables.find((t) => t.id === 'grenade');
  if (grenade) {
    needModel(grenade, grenade.projectile.model, 'projectile.model');
    needSound(grenade, grenade.sounds.throw, 'sounds.throw');
    needSound(grenade, grenade.projectile.sounds.explode, 'projectile.sounds.explode');
    needSound(grenade, grenade.projectile.sounds.bounce, 'projectile.sounds.bounce');
  } else {
    problems.push('content/equipment: manca la granata (un file con "id": "grenade")');
  }

  const weaponsById = new Map(weapons.map((w) => [w.id, w]));
  for (const skin of skins) {
    const weapon = weaponsById.get(skin.weapon);
    if (!weapon) {
      if (!broken.has(skin.weapon)) {
        problems.push(`${pathOf.get(skin)}: "weapon" indica l'arma "${skin.weapon}", che non esiste in content/weapons`);
      }
      continue;
    }
    const model = models.get(weapon.model);
    if (!model) continue;
    const partNames = new Set(model.parts.map((p) => p.name));
    for (const part of Object.keys(skin.colors)) {
      if (!partNames.has(part)) {
        problems.push(
          `${pathOf.get(skin)}: "colors.${part}" non è una parte del modello "${model.id}" (parti: ${[...partNames].join(', ')})`,
        );
      }
    }
  }

  for (const playerClass of classes) {
    for (const field of ['primary', 'secondary', 'melee'] as const) {
      const id = playerClass[field];
      if (id === null || weaponsById.has(id) || broken.has(id)) continue;
      problems.push(`${pathOf.get(playerClass)}: "${field}" indica l'arma "${id}", che non esiste in content/weapons`);
    }
    const melee = playerClass.melee ? weaponsById.get(playerClass.melee) : undefined;
    if (melee && melee.kind !== 'melee') {
      problems.push(`${pathOf.get(playerClass)}: "melee" indica "${melee.id}", che non è un'arma corpo a corpo`);
    }
  }

  for (const sound of options.requiredSounds ?? []) {
    if (!sounds.has(sound)) problems.push(`content/sounds: manca il suono "${sound}", usato dal gioco`);
  }
  if (weapons.length === 0 && sources.weapons.length === 0) problems.push('content/weapons: serve almeno un\'arma');

  if (problems.length > 0) throw new ContentError(problems);
  weapons.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  classes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  characterSkins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  // Granate per vita: la classe può indicarle, altrimenti vale il file della granata.
  const resolved = classes.map((c) => (c.grenades >= 0 ? c : { ...c, grenades: grenade!.count }));
  return { weapons, grenade: grenade!, models, skins, characterSkins, classes: resolved, sounds };
}
