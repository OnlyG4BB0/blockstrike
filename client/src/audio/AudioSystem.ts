/**
 * Audio del gioco con Howler.js. I suoni sono descritti nei file di /content/sounds (livelli di
 * rumore filtrato e toni): all'avvio vengono sintetizzati con un OfflineAudioContext, convertiti
 * in WAV in memoria e caricati in Howler, che li riproduce con la posizione nello spazio (plugin
 * spaziale: si sente da dove arriva uno sparo). Anche la musica del menu è generata qui.
 * Nessun file audio esterno: vedi CREDITS.md.
 */
import { Howl, Howler } from 'howler';
import type { Camera } from 'three';
import { Vector3 } from 'three';
import type { SoundDef, SoundLayer } from '@blockstrike/shared';
import { AUDIO } from '../config.ts';
import { renderMusic } from './music.ts';

const SAMPLE_RATE = 44100;

function noiseBuffer(context: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  return buffer;
}

/** Aggiunge un livello (rumore filtrato o tono) al grafo: attacco lineare, poi decadimento esponenziale. */
function addLayer(context: OfflineAudioContext, layer: SoundLayer): void {
  const gain = context.createGain();
  const g = gain.gain;
  g.setValueAtTime(0.0001, layer.start);
  g.linearRampToValueAtTime(layer.peak, layer.start + layer.attack);
  g.exponentialRampToValueAtTime(0.0001, layer.start + layer.attack + layer.duration);
  gain.connect(context.destination);

  if (layer.type === 'noise') {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context, layer.duration + layer.attack + 0.05);
    const filter = context.createBiquadFilter();
    filter.type = layer.filter;
    filter.Q.value = layer.q;
    filter.frequency.setValueAtTime(layer.from, layer.start);
    if (layer.to !== null) filter.frequency.exponentialRampToValueAtTime(layer.to, layer.start + layer.duration);
    source.connect(filter).connect(gain);
    source.start(layer.start);
    return;
  }
  const osc = context.createOscillator();
  osc.type = layer.wave;
  osc.frequency.setValueAtTime(layer.from, layer.start);
  if (layer.to !== null) osc.frequency.exponentialRampToValueAtTime(layer.to, layer.start + layer.duration);
  osc.connect(gain);
  osc.start(layer.start);
  osc.stop(layer.start + layer.attack + layer.duration + 0.05);
}

/** WAV a 16 bit, mono: Howler lo carica come un file qualsiasi. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const samples = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

function howlFrom(buffer: AudioBuffer, options: { loop?: boolean; pool?: number } = {}): Howl {
  const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }));
  return new Howl({ src: [url], format: ['wav'], loop: options.loop ?? false, pool: options.pool ?? AUDIO.pool });
}

export class AudioSystem {
  private readonly sounds: ReadonlyMap<string, SoundDef>;
  private readonly howls = new Map<string, Howl>();
  private music: Howl | null = null;
  private musicId = 0;
  private musicWanted = false;
  private musicVolume: number = AUDIO.musicVolume;
  private starting: Promise<void> | null = null;
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

  constructor(sounds: ReadonlyMap<string, SoundDef>) {
    this.sounds = sounds;
  }

  /** Va chiamato da un gesto dell'utente (clic): prepara i suoni una volta sola. */
  start(): Promise<void> {
    void Howler.ctx?.resume();
    this.starting ??= (async () => {
      await Promise.all(
        [...this.sounds.values()].map(async (sound) => {
          const offline = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * sound.seconds), SAMPLE_RATE);
          for (const layer of sound.layers) addLayer(offline, layer);
          this.howls.set(sound.id, howlFrom(await offline.startRendering()));
        }),
      );
      this.music = howlFrom(await renderMusic(), { loop: true, pool: 1 });
      this.applyMusic();
    })();
    return this.starting;
  }

  setVolume(volume: number): void {
    Howler.volume(volume);
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = volume;
    this.applyMusic();
  }

  /** Musica del menu: si sente con il menu aperto, sfuma quando si gioca. */
  setMusic(playing: boolean): void {
    this.musicWanted = playing;
    this.applyMusic();
  }

  private applyMusic(): void {
    const music = this.music;
    if (!music) return;
    const target = this.musicWanted ? this.musicVolume : 0;
    if (target > 0 && !music.playing(this.musicId)) {
      this.musicId = music.play();
      music.volume(0, this.musicId);
    }
    if (!music.playing(this.musicId)) return;
    music.fade(music.volume(this.musicId) as number, target, AUDIO.musicFade, this.musicId);
    if (target === 0) {
      const id = this.musicId;
      window.setTimeout(() => {
        if (!this.musicWanted) music.pause(id);
      }, AUDIO.musicFade + 50);
    }
  }

  /** Riproduce un suono per id. Con una posizione è spazializzato, altrimenti si sente "in testa". */
  play(id: string, options: { x?: number; y?: number; z?: number; volume?: number; rate?: number } = {}): void {
    const howl = this.howls.get(id);
    if (!howl) return;
    const sound = howl.play();
    howl.volume(options.volume ?? 1, sound);
    howl.rate((options.rate ?? 1) * (0.96 + Math.random() * 0.08), sound);
    if (options.x !== undefined && options.y !== undefined && options.z !== undefined) {
      howl.pannerAttr(
        {
          panningModel: 'equalpower',
          distanceModel: 'inverse',
          refDistance: AUDIO.refDistance,
          maxDistance: AUDIO.maxDistance,
          rolloffFactor: AUDIO.rolloff,
        },
        sound,
      );
      howl.pos(options.x, options.y, options.z, sound);
    }
  }

  /** L'ascoltatore segue la telecamera. */
  updateListener(camera: Camera): void {
    if (!Howler.ctx) return;
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const p = camera.position;
    Howler.pos(p.x, p.y, p.z);
    Howler.orientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
  }
}
