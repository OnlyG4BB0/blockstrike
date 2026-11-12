import type { Camera } from 'three';
import { Vector3 } from 'three';
import { AUDIO } from '../config.ts';
import { RECIPES, type SoundName } from './sounds.ts';

const SAMPLE_RATE = 44100;

/**
 * Audio del gioco con la Web Audio API: suoni generati all'avvio e riprodotti con posizione nello
 * spazio (si sente da dove arriva uno sparo). Il contesto audio parte al primo clic su "Gioca",
 * come richiedono i browser.
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private volume = 0.6;
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

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
      (Object.keys(RECIPES) as SoundName[]).map(async (name) => {
        const recipe = RECIPES[name];
        const offline = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * recipe.seconds), SAMPLE_RATE);
        recipe.build(offline);
        this.buffers.set(name, await offline.startRendering());
      }),
    );
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  /** Riproduce un suono. Con una posizione è spazializzato, altrimenti si sente "in testa". */
  play(name: SoundName, options: { x?: number; y?: number; z?: number; volume?: number; rate?: number } = {}): void {
    const context = this.context;
    const buffer = this.buffers.get(name);
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
