/**
 * Musica del menu, generata: un giro di 8 battute in la minore (La-, Fa, Do, Sol) con basso,
 * arpeggio a onda quadra, accordi lunghi e batteria di rumore filtrato. Si ripete senza stacco.
 */
const RATE = 22050;
const BPM = 112;
const BARS = 8;
const BEAT = 60 / BPM;

/** Accordi: fondamentale (Hz, ottava bassa) e terza minore o maggiore; due battute ciascuno. */
const CHORDS: readonly { root: number; minor: boolean }[] = [
  { root: 110, minor: true },
  { root: 87.31, minor: false },
  { root: 130.81, minor: false },
  { root: 98, minor: false },
];

function note(root: number, semitones: number): number {
  return root * 2 ** (semitones / 12);
}

function tone(
  context: OfflineAudioContext,
  type: OscillatorType,
  frequency: number,
  start: number,
  length: number,
  peak: number,
  filter?: number,
): void {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  if (filter) {
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = filter;
    osc.connect(lowpass).connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(context.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

function noise(context: OfflineAudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(RATE * seconds), RATE);
  const data = buffer.getChannelData(0);
  let seed = 99;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  return buffer;
}

function hit(
  context: OfflineAudioContext,
  source: AudioBuffer,
  start: number,
  length: number,
  peak: number,
  type: BiquadFilterType,
  frequency: number,
): void {
  const node = context.createBufferSource();
  node.buffer = source;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  node.connect(filter).connect(gain).connect(context.destination);
  node.start(start);
  node.stop(start + length + 0.02);
}

export async function renderMusic(): Promise<AudioBuffer> {
  const seconds = BARS * 4 * BEAT;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  const noiseSource = noise(context, 0.5);
  for (let bar = 0; bar < BARS; bar++) {
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length]!;
    const third = chord.minor ? 3 : 4;
    const barStart = bar * 4 * BEAT;
    // Accordo lungo (all'inizio di ogni coppia di battute).
    if (bar % 2 === 0) {
      for (const semis of [12, 12 + third, 19]) tone(context, 'sawtooth', note(chord.root, semis), barStart, 8 * BEAT, 0.035, 900);
    }
    for (let eighth = 0; eighth < 8; eighth++) {
      const t = barStart + eighth * (BEAT / 2);
      // Basso: fondamentale, con l'ottava sugli ottavi dispari.
      tone(context, 'triangle', note(chord.root, eighth % 2 === 1 ? 12 : 0), t, BEAT / 2.2, 0.22);
      // Charleston.
      hit(context, noiseSource, t, 0.04, eighth % 2 === 0 ? 0.05 : 0.03, 'highpass', 7000);
    }
    for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
      const t = barStart + sixteenth * (BEAT / 4);
      const steps = [12, 12 + third, 19, 24];
      tone(context, 'square', note(chord.root, steps[sixteenth % 4]! + (bar % 4 === 3 && sixteenth >= 8 ? 12 : 0)), t, BEAT / 4.5, 0.045, 2200);
    }
    for (let beat = 0; beat < 4; beat++) {
      const t = barStart + beat * BEAT;
      if (beat % 2 === 0) {
        // Cassa: un tono che scende in fretta.
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain).connect(context.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      } else {
        hit(context, noiseSource, t, 0.14, 0.16, 'bandpass', 1800);
      }
    }
  }
  return context.startRendering();
}
