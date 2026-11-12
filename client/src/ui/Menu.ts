import type { BotMode } from '@blockstrike/shared';
import type { Settings } from '../settings.ts';
import { byId } from './dom.ts';

type NumberKey = 'sensitivity' | 'fov' | 'volume' | 'botCount';
type BooleanKey = 'dynamicFov' | 'showFps' | 'showDebug' | 'damageNumbers';

/** Armi che hanno skin, con le skin disponibili. */
export interface SkinChoice {
  weaponId: string;
  weaponName: string;
  skins: readonly { id: string; name: string }[];
}

/** Menu di pausa: avvio della partita, impostazioni e skin delle armi. */
export class Menu {
  onPlay: () => void = () => {};
  onChange: (settings: Settings) => void = () => {};

  private readonly root = byId('menu');
  private readonly lockError = byId('lock-error');
  private readonly settings: Settings;

  constructor(settings: Settings, skinChoices: readonly SkinChoice[]) {
    this.settings = { ...settings, skins: { ...settings.skins } };
    byId<HTMLButtonElement>('play').addEventListener('click', () => this.onPlay());

    this.bindRange('set-sensitivity', 'out-sensitivity', 'sensitivity', (v) => v.toFixed(1));
    this.bindRange('set-fov', 'out-fov', 'fov', (v) => `${Math.round(v)}°`);
    this.bindRange('set-volume', 'out-volume', 'volume', (v) => `${Math.round(v * 100)}%`, 100);
    this.bindRange('set-bot-count', 'out-bot-count', 'botCount', (v) => String(Math.round(v)));
    this.bindCheck('set-dynamic-fov', 'dynamicFov');
    this.bindCheck('set-show-fps', 'showFps');
    this.bindCheck('set-show-debug', 'showDebug');
    this.bindCheck('set-damage-numbers', 'damageNumbers');

    const mode = byId<HTMLSelectElement>('set-bot-mode');
    mode.value = this.settings.botMode;
    mode.addEventListener('change', () => {
      this.settings.botMode = mode.value as BotMode;
      this.emit();
    });

    this.buildSkins(skinChoices);
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

  private emit(): void {
    this.onChange({ ...this.settings, skins: { ...this.settings.skins } });
  }

  /** Un menu a tendina per ogni arma che ha skin. */
  private buildSkins(choices: readonly SkinChoice[]): void {
    const list = byId('skin-list');
    list.replaceChildren();
    byId('skins-section').hidden = choices.length === 0;
    for (const choice of choices) {
      const label = document.createElement('label');
      label.className = 'row select-row';
      const name = document.createElement('span');
      name.textContent = choice.weaponName;
      const select = document.createElement('select');
      select.append(new Option('Predefinita', ''));
      for (const skin of choice.skins) select.append(new Option(skin.name, skin.id));
      const current = this.settings.skins[choice.weaponId] ?? '';
      select.value = choice.skins.some((s) => s.id === current) ? current : '';
      select.addEventListener('change', () => {
        if (select.value) this.settings.skins[choice.weaponId] = select.value;
        else delete this.settings.skins[choice.weaponId];
        this.emit();
      });
      label.append(name, select);
      list.append(label);
    }
  }

  /** @param scale il cursore mostra valore × scale (es. volume 0-1 come 0-100). */
  private bindRange(inputId: string, outputId: string, key: NumberKey, format: (value: number) => string, scale = 1): void {
    const input = byId<HTMLInputElement>(inputId);
    const output = byId<HTMLOutputElement>(outputId);
    input.value = String(this.settings[key] * scale);
    output.textContent = format(this.settings[key]);
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value) / scale;
      output.textContent = format(this.settings[key]);
      this.emit();
    });
  }

  private bindCheck(inputId: string, key: BooleanKey): void {
    const input = byId<HTMLInputElement>(inputId);
    input.checked = this.settings[key];
    input.addEventListener('change', () => {
      this.settings[key] = input.checked;
      this.emit();
    });
  }
}
