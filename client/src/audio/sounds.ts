/**
 * Suoni generati al volo con la Web Audio API: nessun file audio, quindi nessun problema di licenze.
 * Ogni suono è una ricetta che costruisce un piccolo grafo (rumore filtrato, oscillatori, inviluppi)
 * e viene "registrata" una volta sola in un buffer con un OfflineAudioContext.
 */

export type SoundName =
  | 'assault_rifle'
  | 'sniper'
  | 'shotgun'
  | 'pistol'
  | 'rocket_launcher'
  | 'explosion'
  | 'reload'
  | 'reloadEnd'
  | 'switch'
  | 'dryFire'
  | 'hit'
  | 'headshot'
  | 'kill'
  | 'hurt'
  | 'throw'
  | 'bounce'
  | 'step'
  | 'land';

type Context = OfflineAudioContext;

function noiseBuffer(ctx: Context, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  return buffer;
}

/** Inviluppo: attacco lineare, poi decadimento esponenziale. */
function envelope(gain: GainNode, start: number, peak: number, attack: number, decay: number): void {
  const g = gain.gain;
  g.setValueAtTime(0.0001, start);
  g.linearRampToValueAtTime(peak, start + attack);
  g.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

interface NoiseOptions {
  start?: number;
  duration: number;
  peak: number;
  attack?: number;
  type: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
}

function noise(ctx: Context, options: NoiseOptions): void {
  const start = options.start ?? 0;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, options.duration + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = options.type;
  filter.Q.value = options.q ?? 0.8;
  filter.frequency.setValueAtTime(options.from, start);
  if (options.to !== undefined) filter.frequency.exponentialRampToValueAtTime(options.to, start + options.duration);
  const gain = ctx.createGain();
  envelope(gain, start, options.peak, options.attack ?? 0.002, options.duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
}

interface ToneOptions {
  start?: number;
  duration: number;
  peak: number;
  type: OscillatorType;
  from: number;
  to?: number;
  attack?: number;
}

function tone(ctx: Context, options: ToneOptions): void {
  const start = options.start ?? 0;
  const osc = ctx.createOscillator();
  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, start);
  if (options.to !== undefined) osc.frequency.exponentialRampToValueAtTime(options.to, start + options.duration);
  const gain = ctx.createGain();
  envelope(gain, start, options.peak, options.attack ?? 0.002, options.duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + options.duration + 0.05);
}

const click = (ctx: Context, start: number, frequency: number, peak: number) =>
  tone(ctx, { start, duration: 0.025, peak, type: 'square', from: frequency, to: frequency * 0.6 });

export const RECIPES: Record<SoundName, { seconds: number; build: (ctx: Context) => void }> = {
  assault_rifle: {
    seconds: 0.3,
    build: (ctx) => {
      noise(ctx, { duration: 0.14, peak: 0.9, type: 'lowpass', from: 7000, to: 900 });
      noise(ctx, { duration: 0.06, peak: 0.5, type: 'bandpass', from: 2400, q: 1.2 });
      tone(ctx, { duration: 0.08, peak: 0.7, type: 'sine', from: 150, to: 45 });
    },
  },
  sniper: {
    seconds: 1.0,
    build: (ctx) => {
      noise(ctx, { duration: 0.4, peak: 1, type: 'lowpass', from: 6000, to: 500 });
      tone(ctx, { duration: 0.2, peak: 0.9, type: 'sine', from: 110, to: 32 });
      noise(ctx, { start: 0.14, duration: 0.6, peak: 0.25, type: 'lowpass', from: 1200, to: 250 });
      click(ctx, 0.55, 1400, 0.25);
      click(ctx, 0.75, 1000, 0.25);
    },
  },
  shotgun: {
    seconds: 0.9,
    build: (ctx) => {
      noise(ctx, { duration: 0.3, peak: 1, type: 'lowpass', from: 4000, to: 350 });
      tone(ctx, { duration: 0.18, peak: 0.9, type: 'sine', from: 90, to: 30 });
      noise(ctx, { start: 0.42, duration: 0.07, peak: 0.35, type: 'bandpass', from: 1800, q: 2 });
      noise(ctx, { start: 0.56, duration: 0.07, peak: 0.35, type: 'bandpass', from: 1300, q: 2 });
    },
  },
  pistol: {
    seconds: 0.25,
    build: (ctx) => {
      noise(ctx, { duration: 0.09, peak: 0.8, type: 'bandpass', from: 3200, to: 1200, q: 0.7 });
      tone(ctx, { duration: 0.05, peak: 0.6, type: 'sine', from: 200, to: 70 });
    },
  },
  rocket_launcher: {
    seconds: 0.7,
    build: (ctx) => {
      noise(ctx, { duration: 0.12, peak: 0.8, type: 'lowpass', from: 2500, to: 300 });
      noise(ctx, { duration: 0.6, peak: 0.45, attack: 0.08, type: 'bandpass', from: 400, to: 1800, q: 1 });
      tone(ctx, { duration: 0.12, peak: 0.6, type: 'sine', from: 80, to: 40 });
    },
  },
  explosion: {
    seconds: 1.8,
    build: (ctx) => {
      noise(ctx, { duration: 1.4, peak: 1, attack: 0.005, type: 'lowpass', from: 2200, to: 120 });
      tone(ctx, { duration: 0.8, peak: 1, type: 'sine', from: 70, to: 24 });
      noise(ctx, { start: 0.05, duration: 0.5, peak: 0.35, type: 'highpass', from: 2500 });
    },
  },
  reload: {
    seconds: 0.5,
    build: (ctx) => {
      click(ctx, 0, 1700, 0.3);
      noise(ctx, { start: 0.02, duration: 0.05, peak: 0.25, type: 'bandpass', from: 2600, q: 3 });
      click(ctx, 0.2, 1200, 0.3);
    },
  },
  reloadEnd: {
    seconds: 0.25,
    build: (ctx) => {
      noise(ctx, { duration: 0.06, peak: 0.35, type: 'highpass', from: 1800 });
      click(ctx, 0.05, 900, 0.35);
    },
  },
  switch: {
    seconds: 0.2,
    build: (ctx) => {
      click(ctx, 0, 1100, 0.25);
      noise(ctx, { start: 0.04, duration: 0.05, peak: 0.2, type: 'bandpass', from: 2000, q: 2 });
    },
  },
  dryFire: {
    seconds: 0.1,
    build: (ctx) => click(ctx, 0, 2400, 0.3),
  },
  hit: {
    seconds: 0.12,
    build: (ctx) => tone(ctx, { duration: 0.05, peak: 0.35, type: 'triangle', from: 1700, to: 1300 }),
  },
  headshot: {
    seconds: 0.45,
    build: (ctx) => {
      tone(ctx, { duration: 0.35, peak: 0.35, type: 'sine', from: 2400 });
      tone(ctx, { duration: 0.25, peak: 0.2, type: 'sine', from: 3600 });
      tone(ctx, { duration: 0.05, peak: 0.3, type: 'triangle', from: 1800, to: 1400 });
    },
  },
  kill: {
    seconds: 0.6,
    build: (ctx) => {
      tone(ctx, { duration: 0.12, peak: 0.6, type: 'sine', from: 160, to: 60 });
      tone(ctx, { start: 0.02, duration: 0.45, peak: 0.25, type: 'sine', from: 1320 });
      tone(ctx, { start: 0.02, duration: 0.45, peak: 0.2, type: 'sine', from: 1980 });
    },
  },
  hurt: {
    seconds: 0.3,
    build: (ctx) => {
      noise(ctx, { duration: 0.16, peak: 0.6, type: 'lowpass', from: 600, to: 150 });
      tone(ctx, { duration: 0.12, peak: 0.4, type: 'sine', from: 120, to: 60 });
    },
  },
  throw: {
    seconds: 0.25,
    build: (ctx) => noise(ctx, { duration: 0.18, peak: 0.35, attack: 0.03, type: 'bandpass', from: 700, to: 1500, q: 1 }),
  },
  bounce: {
    seconds: 0.1,
    build: (ctx) => {
      click(ctx, 0, 700, 0.35);
      noise(ctx, { duration: 0.03, peak: 0.25, type: 'bandpass', from: 1500, q: 2 });
    },
  },
  step: {
    seconds: 0.12,
    build: (ctx) => {
      noise(ctx, { duration: 0.06, peak: 0.45, type: 'lowpass', from: 900, to: 250 });
      noise(ctx, { duration: 0.02, peak: 0.12, type: 'bandpass', from: 3000, q: 2 });
    },
  },
  land: {
    seconds: 0.2,
    build: (ctx) => {
      noise(ctx, { duration: 0.1, peak: 0.6, type: 'lowpass', from: 500, to: 120 });
      tone(ctx, { duration: 0.08, peak: 0.3, type: 'sine', from: 90, to: 50 });
    },
  },
};
