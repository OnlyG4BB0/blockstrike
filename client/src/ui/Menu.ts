import type { BotMode, GoreLevel } from '@blockstrike/shared';
import { KEY_ACTIONS, KEY_ACTION_NAMES, defaultBindings, keyName, type KeyAction } from '../input/Input.ts';
import { DEFAULT_CROSSHAIR, type CrosshairSettings, type Settings } from '../settings.ts';
import type { Quality } from '../config.ts';
import { byId } from './dom.ts';

type NumberKey = 'sensitivity' | 'fov' | 'volume' | 'botCount' | 'musicVolume';
type BooleanKey = 'dynamicFov' | 'showFps' | 'showDebug' | 'damageNumbers' | 'minimap';

/** Applica le impostazioni del mirino a un elemento (quello del gioco o l'anteprima). */
export function applyCrosshair(element: HTMLElement, c: Readonly<CrosshairSettings>): void {
  element.style.setProperty('--ch-color', c.color);
  element.style.setProperty('--ch-length', `${c.length}px`);
  element.style.setProperty('--ch-thickness', `${c.thickness}px`);
  element.style.setProperty('--ch-outline', c.outline ? 'rgba(0, 0, 0, 0.55)' : 'transparent');
  const dot = element.querySelector<HTMLElement>('.ch-dot');
  if (dot) dot.hidden = !c.dot;
}

/** Armi che hanno skin, con le skin disponibili. */
export interface SkinChoice {
  weaponId: string;
  weaponName: string;
  skins: readonly { id: string; name: string }[];
}

/** Classe da mostrare nella schermata di scelta. */
export interface ClassChoice {
  id: string;
  name: string;
  description: string;
  health: number;
  speed: number;
  jumpHeight: number;
  weapons: readonly string[];
  grenades: number;
}

/** Skin di un personaggio: nome e colori principali (testa, busto, gambe) per il campione. */
export interface CharacterSkinChoice {
  id: string;
  name: string;
  swatch: readonly string[];
  accessories: readonly string[];
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Menu di pausa: avvio della partita, classe e aspetto con anteprima, impostazioni e skin delle armi. */
export type OnlineAction = 'quick' | 'create' | 'code';

export class Menu {
  onPlay: () => void = () => {};
  onChange: (settings: Settings) => void = () => {};
  /** Richiesta di giocare online (partita veloce, nuova stanza, stanza con codice). */
  onOnline: (action: OnlineAction, mode: string, code: string) => void = () => {};
  onLeaveRoom: () => void = () => {};
  /** Mappa scelta (in allenamento si riparte con quella). */
  onMapChange: (mapId: string) => void = () => {};

  readonly previewCanvas = byId<HTMLCanvasElement>('preview');
  private readonly root = byId('menu');
  private readonly lockError = byId('lock-error');
  private readonly previewCaption = byId('preview-caption');
  private readonly classNote = byId('class-note');
  private readonly settings: Settings;
  private readonly classButtons = new Map<string, HTMLButtonElement>();
  private readonly skinButtons = new Map<string, HTMLButtonElement>();

  constructor(
    settings: Settings,
    skinChoices: readonly SkinChoice[],
    classes: readonly ClassChoice[],
    characterSkins: readonly CharacterSkinChoice[],
  ) {
    this.settings = {
      ...settings,
      skins: { ...settings.skins },
      crosshair: { ...settings.crosshair },
      keys: { ...settings.keys },
    };
    byId<HTMLButtonElement>('play').addEventListener('click', () => this.onPlay());

    this.bindRange('set-sensitivity', 'out-sensitivity', 'sensitivity', (v) => v.toFixed(1));
    this.bindRange('set-fov', 'out-fov', 'fov', (v) => `${Math.round(v)}°`);
    this.bindRange('set-volume', 'out-volume', 'volume', (v) => `${Math.round(v * 100)}%`, 100);
    this.bindRange('set-bot-count', 'out-bot-count', 'botCount', (v) => String(Math.round(v)));
    this.bindRange('set-music', 'out-music', 'musicVolume', (v) => `${Math.round(v * 100)}%`, 100);
    this.bindCheck('set-minimap', 'minimap');
    const quality = byId<HTMLSelectElement>('set-quality');
    quality.value = this.settings.quality;
    quality.addEventListener('change', () => {
      this.settings.quality = quality.value as Quality;
      this.emit();
    });
    this.bindCrosshair();
    this.bindKeys();
    this.bindTabs();
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
    const gore = byId<HTMLSelectElement>('set-gore');
    gore.value = this.settings.goreLevel;
    gore.addEventListener('change', () => {
      this.settings.goreLevel = gore.value as GoreLevel;
      this.emit();
    });

    this.buildClasses(classes);
    this.buildCharacterSkins(characterSkins);
    this.buildSkins(skinChoices);
    this.bindOnline();
  }

  private bindOnline(): void {
    const name = byId<HTMLInputElement>('online-name');
    const mode = byId<HTMLSelectElement>('online-mode');
    const code = byId<HTMLInputElement>('online-code');
    name.value = this.settings.playerName;
    mode.value = this.settings.onlineMode;
    name.addEventListener('change', () => {
      this.settings.playerName = name.value.trim().slice(0, 16);
      this.emit();
    });
    mode.addEventListener('change', () => {
      this.settings.onlineMode = mode.value;
      this.emit();
    });
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    byId('online-quick').addEventListener('click', () => this.onOnline('quick', mode.value, ''));
    byId('online-create').addEventListener('click', () => this.onOnline('create', mode.value, ''));
    const join = () => {
      if (code.value.length === 5) this.onOnline('code', mode.value, code.value);
      else this.setOnlineStatus('Il codice ha 5 caratteri.');
    };
    byId('online-join').addEventListener('click', join);
    code.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') join();
    });
    byId('online-leave').addEventListener('click', () => this.onLeaveRoom());
  }

  /** Elenco delle mappe; `current` è quella in uso. */
  setMaps(maps: readonly { id: string; name: string }[], current: string, locked: boolean): void {
    const select = byId<HTMLSelectElement>('set-map');
    select.replaceChildren(...maps.map((m) => new Option(m.name, m.id)));
    select.value = current;
    select.disabled = locked;
    select.title = locked ? 'In una stanza online la mappa la decide chi la crea.' : '';
    select.addEventListener('change', () => {
      this.settings.mapId = select.value;
      this.emit();
      this.onMapChange(select.value);
    });
  }

  setOnlineStatus(text: string): void {
    byId('online-status').textContent = text;
  }

  /** In una stanza: codice e modalità al posto dei pulsanti per entrare. */
  setOnlineRoom(code: string, mode: string): void {
    byId('online-lobby').hidden = true;
    byId('online-room').hidden = false;
    byId('online-room-code').textContent = code;
    byId('online-room-mode').textContent = mode;
    byId('online-copy').addEventListener('click', () => {
      const link = `${location.origin}${location.pathname}?stanza=${code}`;
      void navigator.clipboard?.writeText(link).then(
        () => this.setOnlineStatus(`Invito copiato: ${link}`),
        () => this.setOnlineStatus(`Invito: ${link}`),
      );
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
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

  setPreviewCaption(text: string): void {
    if (this.previewCaption.textContent !== text) this.previewCaption.textContent = text;
  }

  /** Avviso sotto le classi (per esempio: la nuova classe vale dalla prossima rinascita). */
  setClassNote(text: string): void {
    this.classNote.textContent = text;
    this.classNote.hidden = text === '';
  }

  private emit(): void {
    this.onChange({
      ...this.settings,
      skins: { ...this.settings.skins },
      crosshair: { ...this.settings.crosshair },
      keys: { ...this.settings.keys },
    });
  }

  /** Schede del menu: ricorda l'ultima aperta. */
  private bindTabs(): void {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.tabs button')];
    const panels = [...document.querySelectorAll<HTMLElement>('.tab-panel')];
    const open = (tab: string) => {
      for (const button of buttons) {
        const active = button.dataset.tab === tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      }
      for (const panel of panels) panel.hidden = panel.dataset.panel !== tab;
      try {
        sessionStorage.setItem('blockstrike.tab', tab);
      } catch {
        // Niente memoria della scheda: pazienza.
      }
    };
    for (const button of buttons) button.addEventListener('click', () => open(button.dataset.tab ?? 'gioca'));
    let saved = 'personaggio';
    try {
      saved = sessionStorage.getItem('blockstrike.tab') ?? saved;
    } catch {
      // Archiviazione non disponibile.
    }
    open(buttons.some((b) => b.dataset.tab === saved) ? saved : 'personaggio');
  }

  /** Mirino: colore, misure, punto e bordo, con anteprima. */
  private bindCrosshair(): void {
    const c = this.settings.crosshair;
    const preview = byId('crosshair-preview');
    const refresh = () => {
      applyCrosshair(preview, c);
      preview.style.setProperty('--gap', `${c.gap}px`);
    };
    const color = byId<HTMLInputElement>('ch-color');
    color.value = c.color;
    color.addEventListener('input', () => {
      c.color = color.value;
      refresh();
      this.emit();
    });
    for (const key of ['length', 'thickness', 'gap'] as const) {
      const input = byId<HTMLInputElement>(`ch-${key}`);
      input.value = String(c[key]);
      input.addEventListener('input', () => {
        c[key] = Number(input.value);
        refresh();
        this.emit();
      });
    }
    for (const key of ['dot', 'outline'] as const) {
      const input = byId<HTMLInputElement>(`ch-${key}`);
      input.checked = c[key];
      input.addEventListener('change', () => {
        c[key] = input.checked;
        refresh();
        this.emit();
      });
    }
    if (!c.color) Object.assign(c, DEFAULT_CROSSHAIR);
    refresh();
  }

  /** Tasti: clic su un'azione, poi il tasto nuovo (Esc annulla). */
  private bindKeys(): void {
    const list = byId('key-list');
    const render = () => {
      list.replaceChildren();
      for (const action of KEY_ACTIONS) {
        const label = document.createElement('span');
        label.textContent = KEY_ACTION_NAMES[action];
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = this.settings.keys[action].map(keyName).join(' · ');
        button.addEventListener('click', () => this.captureKey(action, button, render));
        list.append(label, button);
      }
    };
    byId('keys-reset').addEventListener('click', () => {
      this.settings.keys = defaultBindings();
      render();
      this.emit();
    });
    render();
  }

  private captureKey(action: KeyAction, button: HTMLButtonElement, render: () => void): void {
    button.textContent = 'Premi un tasto…';
    button.classList.add('waiting');
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      if (event.code !== 'Escape') {
        // Un tasto fa una cosa sola: lo si toglie dalle altre azioni.
        for (const other of KEY_ACTIONS) {
          this.settings.keys[other] = this.settings.keys[other].filter((code) => code !== event.code);
          if (this.settings.keys[other].length === 0 && other !== action) this.settings.keys[other] = [...defaultBindings()[other]];
        }
        this.settings.keys[action] = [event.code];
        this.emit();
      }
      render();
    };
    window.addEventListener('keydown', onKey, true);
  }

  /** Schede delle classi: statistiche a barre e armi. */
  private buildClasses(classes: readonly ClassChoice[]): void {
    const list = byId('class-list');
    list.replaceChildren();
    byId('loadout').hidden = classes.length === 0;
    const most = {
      health: Math.max(...classes.map((c) => c.health)),
      speed: Math.max(...classes.map((c) => c.speed)),
      jump: Math.max(...classes.map((c) => c.jumpHeight)),
    };
    for (const choice of classes) {
      const button = element('button', 'class-card');
      button.type = 'button';
      button.append(element('span', 'class-name', choice.name), element('span', 'class-description', choice.description));
      const stats = element('span', 'class-stats');
      const stat = (label: string, value: number, max: number, text: string) => {
        const row = element('span', 'stat');
        const bar = element('span', 'stat-bar');
        const fill = element('span', 'stat-fill');
        fill.style.width = `${Math.round((value / max) * 100)}%`;
        bar.append(fill);
        row.append(element('span', 'stat-label', label), bar, element('span', 'stat-value', text));
        stats.append(row);
      };
      stat('Vita', choice.health, most.health, String(choice.health));
      stat('Velocità', choice.speed, most.speed, `${Math.round(choice.speed * 100)}%`);
      stat('Salto', choice.jumpHeight, most.jump, `${choice.jumpHeight.toFixed(2)} m`);
      button.append(stats, element('span', 'class-weapons', `${choice.weapons.join(' · ')} · granate ×${choice.grenades}`));
      button.addEventListener('click', () => {
        this.settings.classId = choice.id;
        this.highlight(this.classButtons, choice.id);
        this.emit();
      });
      this.classButtons.set(choice.id, button);
      list.append(button);
    }
    if (!this.classButtons.has(this.settings.classId) && classes[0]) this.settings.classId = classes[0].id;
    this.highlight(this.classButtons, this.settings.classId);
  }

  /** Skin dei personaggi: nome, campione di colori e accessori. */
  private buildCharacterSkins(skins: readonly CharacterSkinChoice[]): void {
    const list = byId('character-skin-list');
    list.replaceChildren();
    for (const skin of skins) {
      const button = element('button', 'skin-card');
      button.type = 'button';
      const swatch = element('span', 'swatch');
      for (const color of skin.swatch) {
        const chip = element('span', 'chip');
        chip.style.background = color;
        swatch.append(chip);
      }
      button.append(swatch, element('span', 'skin-name', skin.name));
      if (skin.accessories.length > 0) button.title = skin.accessories.join(', ');
      button.addEventListener('click', () => {
        this.settings.characterSkin = skin.id;
        this.highlight(this.skinButtons, skin.id);
        this.emit();
      });
      this.skinButtons.set(skin.id, button);
      list.append(button);
    }
    if (!this.skinButtons.has(this.settings.characterSkin) && skins[0]) this.settings.characterSkin = skins[0].id;
    this.highlight(this.skinButtons, this.settings.characterSkin);
  }

  private highlight(buttons: Map<string, HTMLButtonElement>, selected: string): void {
    for (const [id, button] of buttons) {
      button.classList.toggle('selected', id === selected);
      button.setAttribute('aria-pressed', String(id === selected));
    }
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
