import type { Camera } from 'three';
import { Vector3 } from 'three';
import type { SoundDef, SoundLayer } from '@blockstrike/shared';
import { AUDIO } from '../config.ts';

const SAMPLE_RATE = 44100;

function noiseBuffer(context: OfflineAudioContext, seconds: number): AudioBuffer {
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

/**
 * Audio del gioco con la Web Audio API. I suoni sono descritti nei file di /content/sounds e
 * vengono sintetizzati una volta all'avvio; si riproducono con posizione nello spazio (si sente da
 * dove arriva uno sparo). Il contesto audio parte al primo clic su "Gioca", come richiedono i browser.
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly sounds: ReadonlyMap<string, SoundDef>;
  private volume = 0.6;
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

  constructor(sounds: ReadonlyMap<string, SoundDef>) {
    this.sounds = sounds;
  }

  /** Va chiamato da un gesto dell'utente (clic). */
  async start(): Promise<void> {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    const context = new AudioContext();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(context.destination);
    await Promise.all(
      [...this.sounds.values()].map(async (sound) => {
        const offline = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * sound.seconds), SAMPLE_RATE);
        for (const layer of sound.layers) addLayer(offline, layer);
        this.buffers.set(sound.id, await offline.startRendering());
      }),
    );
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  /** Riproduce un suono per id. Con una posizione è spazializzato, altrimenti si sente "in testa". */
  play(id: string, options: { x?: number; y?: number; z?: number; volume?: number; rate?: number } = {}): void {
    const context = this.context;
    const buffer = this.buffers.get(id);
    if (!context || !this.master || !buffer || context.state !== 'running') return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = (options.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const gain = context.createGain();
    gain.gain.value = options.volume ?? 1;
    if (options.x !== undefined && options.y !== undefined && options.z !== undefined) {
      const panner = context.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = AUDIO.refDistance;
      panner.maxDistance = AUDIO.maxDistance;
      panner.rolloffFactor = AUDIO.rolloff;
      panner.positionX.value = options.x;
      panner.positionY.value = options.y;
      panner.positionZ.value = options.z;
      source.connect(gain).connect(panner).connect(this.master);
    } else {
      source.connect(gain).connect(this.master);
    }
    source.start();
  }

  /** L'ascoltatore segue la telecamera. */
  updateListener(camera: Camera): void {
    const context = this.context;
    if (!context) return;
    const listener = context.listener;
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const p = camera.position;
    if (listener.positionX) {
      listener.positionX.value = p.x;
      listener.positionY.value = p.y;
      listener.positionZ.value = p.z;
      listener.forwardX.value = this.forward.x;
      listener.forwardY.value = this.forward.y;
      listener.forwardZ.value = this.forward.z;
      listener.upX.value = this.up.x;
      listener.upY.value = this.up.y;
      listener.upZ.value = this.up.z;
    } else {
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
    }
  }
}
