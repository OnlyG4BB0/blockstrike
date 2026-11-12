/**
 * Controlli sui dati letti da JSON (mappe, armi, modelli, skin, suoni). Ogni errore indica il file
 * e il campo, per esempio: `content/weapons/smg.json: "spread.base" deve essere un numero`.
 */
import type { Vec3Tuple } from './map.ts';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type JsonObject = Record<string, unknown>;

interface NumberOptions {
  min?: number;
  max?: number;
  /** Strettamente maggiore di zero. */
  positive?: boolean;
  integer?: boolean;
}

export class Validator {
  readonly source: string;
  private readonly makeError: (message: string) => Error;

  constructor(source: string, makeError: (message: string) => Error = (message) => new ValidationError(message)) {
    this.source = source;
    this.makeError = makeError;
  }

  fail(path: string, message: string): never {
    throw this.makeError(`${this.source}: "${path}" ${message}`);
  }

  object(value: unknown, path: string): JsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) this.fail(path, 'deve essere un oggetto');
    return value as JsonObject;
  }

  optionalObject(value: unknown, path: string): JsonObject | undefined {
    return value === undefined ? undefined : this.object(value, path);
  }

  array(value: unknown, path: string, minLength = 0): unknown[] {
    if (!Array.isArray(value)) this.fail(path, 'deve essere una lista');
    if (value.length < minLength) this.fail(path, `deve contenere almeno ${minLength} elementi`);
    return value;
  }

  number(value: unknown, path: string, options: NumberOptions = {}): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(path, 'deve essere un numero');
    if (options.integer && !Number.isInteger(value)) this.fail(path, 'deve essere un numero intero');
    if (options.positive && value <= 0) this.fail(path, 'deve essere maggiore di zero');
    if (options.min !== undefined && value < options.min) this.fail(path, `deve essere almeno ${options.min}`);
    if (options.max !== undefined && value > options.max) this.fail(path, `deve essere al massimo ${options.max}`);
    return value;
  }

  optionalNumber(value: unknown, path: string, fallback: number, options: NumberOptions = {}): number {
    return value === undefined ? fallback : this.number(value, path, options);
  }

  string(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.length === 0) this.fail(path, 'deve essere un testo non vuoto');
    return value;
  }

  optionalString(value: unknown, path: string, fallback: string): string {
    return value === undefined ? fallback : this.string(value, path);
  }

  /** Identificatore: lettere minuscole, cifre, trattini bassi e trattini. */
  id(value: unknown, path: string): string {
    const text = this.string(value, path);
    if (!/^[a-z0-9_-]+$/.test(text)) this.fail(path, `deve contenere solo a-z, 0-9, "_" e "-" (trovato "${text}")`);
    return text;
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') this.fail(path, 'deve essere true oppure false');
    return value;
  }

  optionalBoolean(value: unknown, path: string, fallback: boolean): boolean {
    return value === undefined ? fallback : this.boolean(value, path);
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
    if (typeof value !== 'string' || !options.includes(value as T)) {
      this.fail(path, `deve essere uno tra ${options.map((o) => `"${o}"`).join(', ')}`);
    }
    return value as T;
  }

  color(value: unknown, path: string): string {
    const text = this.string(value, path);
    if (!/^#[0-9a-fA-F]{6}$/.test(text)) this.fail(path, `deve essere un colore #rrggbb (trovato "${text}")`);
    return text;
  }

  vec3(value: unknown, path: string, options: NumberOptions = {}): Vec3Tuple {
    const list = this.array(value, path, 3);
    if (list.length !== 3) this.fail(path, 'deve contenere esattamente 3 numeri');
    return [
      this.number(list[0], `${path}[0]`, options),
      this.number(list[1], `${path}[1]`, options),
      this.number(list[2], `${path}[2]`, options),
    ];
  }
}
