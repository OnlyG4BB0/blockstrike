import type { Settings } from '../settings.ts';
import { byId } from './dom.ts';

/** Menu di pausa: avvio della partita e impostazioni. */
export class Menu {
  onPlay: () => void = () => {};
  onChange: (settings: Settings) => void = () => {};

  private readonly root = byId('menu');
  private readonly lockError = byId('lock-error');
  private readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = { ...settings };
    byId<HTMLButtonElement>('play').addEventListener('click', () => this.onPlay());

    this.bindRange('set-sensitivity', 'out-sensitivity', 'sensitivity', (v) => v.toFixed(1));
    this.bindRange('set-fov', 'out-fov', 'fov', (v) => `${Math.round(v)}°`);
    this.bindCheck('set-dynamic-fov', 'dynamicFov');
    this.bindCheck('set-show-fps', 'showFps');
    this.bindCheck('set-show-debug', 'showDebug');
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.lockError.hidden = true;
  }

  showLockError(): void {
    this.lockError.hidden = false;
  }

  private bindRange(
    inputId: string,
    outputId: string,
    key: 'sensitivity' | 'fov',
    format: (value: number) => string,
  ): void {
    const input = byId<HTMLInputElement>(inputId);
    const output = byId<HTMLOutputElement>(outputId);
    input.value = String(this.settings[key]);
    output.textContent = format(this.settings[key]);
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value);
      output.textContent = format(this.settings[key]);
      this.onChange({ ...this.settings });
    });
  }

  private bindCheck(inputId: string, key: 'dynamicFov' | 'showFps' | 'showDebug'): void {
    const input = byId<HTMLInputElement>(inputId);
    input.checked = this.settings[key];
    input.addEventListener('change', () => {
      this.settings[key] = input.checked;
      this.onChange({ ...this.settings });
    });
  }
}
