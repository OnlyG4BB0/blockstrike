import { MOVE, horizontalSpeed, type PlayerState } from '@blockstrike/shared';
import { HUD } from '../config.ts';
import type { Settings } from '../settings.ts';
import { byId } from './dom.ts';

/** HUD in DOM: mirino, FPS, tachimetro, stato del movimento e dati di debug. */
export class Hud {
  private readonly fps = byId('fps');
  private readonly chips = byId('chips');
  private readonly speedometer = byId('speedometer');
  private readonly speedValue = byId('speed-value');
  private readonly speedFill = byId('speed-fill');
  private readonly speedPeak = byId('speed-peak');
  private readonly debug = byId('debug');

  private frames = 0;
  private elapsed = 0;
  // Ultimi valori scritti: il DOM si tocca solo quando qualcosa cambia.
  private shownSpeed = '';
  private shownPeak = '';
  private shownChips = '';
  private shownTier = '';
  private shownDebug = '';

  constructor() {
    byId('speed-mark').style.left = `${(100 / HUD.speedBarMaxFactor).toFixed(2)}%`;
  }

  update(dt: number, state: Readonly<PlayerState>, peakSpeed: number, settings: Readonly<Settings>, debugText: string): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= HUD.fpsInterval) {
      this.fps.textContent = `${Math.round(this.frames / this.elapsed)} FPS`;
      this.frames = 0;
      this.elapsed = 0;
    }
    this.fps.hidden = !settings.showFps;

    const speed = horizontalSpeed(state);
    const speedText = speed.toFixed(1);
    if (speedText !== this.shownSpeed) {
      this.shownSpeed = speedText;
      this.speedValue.textContent = speedText;
      const fill = Math.min(1, speed / (MOVE.runSpeed * HUD.speedBarMaxFactor));
      this.speedFill.style.width = `${(fill * 100).toFixed(1)}%`;
    }
    const tier =
      speed >= MOVE.runSpeed * HUD.blazingFactor ? 'blazing' : speed >= MOVE.runSpeed * HUD.fastFactor ? 'fast' : '';
    if (tier !== this.shownTier) {
      this.shownTier = tier;
      this.speedometer.className = tier;
    }
    const peakText = `record ${peakSpeed.toFixed(1)}`;
    if (peakText !== this.shownPeak) {
      this.shownPeak = peakText;
      this.speedPeak.textContent = peakText;
    }

    const chips = [
      state.grounded ? '' : '<span class="chip air">IN ARIA</span>',
      state.sliding ? '<span class="chip slide">SCIVOLATA</span>' : '',
      state.crouched && !state.sliding ? '<span class="chip">ACCOVACCIATO</span>' : '',
    ].join('');
    if (chips !== this.shownChips) {
      this.shownChips = chips;
      this.chips.innerHTML = chips;
    }

    const debug = settings.showDebug ? debugText : '';
    if (debug !== this.shownDebug) {
      this.shownDebug = debug;
      this.debug.textContent = debug;
    }
  }
}
