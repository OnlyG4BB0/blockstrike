import { COMBAT, MOVE, horizontalSpeed, type PlayerState, type WeaponDef } from '@blockstrike/shared';
import { HUD } from '../config.ts';
import type { Settings } from '../settings.ts';
import { byId } from './dom.ts';

/** Punto proiettato sullo schermo (pixel); `visible` è false se è dietro la telecamera. */
export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export type Projector = (x: number, y: number, z: number, out: ScreenPoint) => ScreenPoint;

export interface LabelData {
  id: number;
  name: string;
  health: number;
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  local: boolean;
}

interface FloatingNumber {
  element: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  life: number;
}

const DAMAGE_NUMBER_LIFE = 0.8;
const KILLFEED_LIFE = 5;
const KILLFEED_MAX = 5;
const HITMARKER_TIME = 0.22;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** HUD in DOM: mirino, vita, munizioni, segnali di colpo, uccisioni, punteggi e dati di debug. */
export class Hud {
  private readonly fps = byId('fps');
  private readonly chips = byId('chips');
  private readonly speedometer = byId('speedometer');
  private readonly speedValue = byId('speed-value');
  private readonly speedFill = byId('speed-fill');
  private readonly speedPeak = byId('speed-peak');
  private readonly debug = byId('debug');
  private readonly crosshair = byId('crosshair');
  private readonly hitmarker = byId('hitmarker');
  private readonly healthValue = byId('health-value');
  private readonly healthFill = byId('health-fill');
  private readonly ammoMag = byId('ammo-mag');
  private readonly ammoMax = byId('ammo-max');
  private readonly weaponName = byId('weapon-name');
  private readonly reloadBar = byId('reload-bar');
  private readonly reloadFill = byId('reload-fill');
  private readonly slots = byId('weapon-slots');
  private readonly grenades = byId('grenades');
  private readonly protection = byId('protection');
  private readonly vignette = byId('vignette');
  private readonly scope = byId('scope');
  private readonly death = byId('death');
  private readonly deathBy = byId('death-by');
  private readonly deathTimer = byId('death-timer');
  private readonly killfeed = byId('killfeed');
  private readonly scoreboard = byId('scoreboard');
  private readonly scoreRows = byId('score-rows');
  private readonly labelsLayer = byId('labels');
  private readonly numbersLayer = byId('damage-numbers');

  private frames = 0;
  private elapsed = 0;
  private hitTimer = 0;
  private hurtLevel = 0;
  private scoreTimer = 0;
  private readonly numbers: FloatingNumber[] = [];
  private readonly labels = new Map<number, { root: HTMLDivElement; fill: HTMLDivElement; name: string }>();
  private readonly point: ScreenPoint = { x: 0, y: 0, visible: false };
  private readonly shown = new Map<string, string>();
  private readonly weapons: readonly WeaponDef[];
  private readonly grenadeName: string;

  constructor(weapons: readonly WeaponDef[], grenadeName: string) {
    this.weapons = weapons;
    this.grenadeName = grenadeName;
    byId('speed-mark').style.left = `${(100 / HUD.speedBarMaxFactor).toFixed(2)}%`;
    // Le armi dei tasti 1-9; le altre si raggiungono con la rotella.
    this.slots.innerHTML = weapons
      .map(
        (def, i) =>
          `<span class="slot" data-slot="${i}"><b>${i < 9 ? i + 1 : '·'}</b>${escapeHtml(def.shortName)}</span>`,
      )
      .join('');
    for (let i = 0; i < 24; i++) {
      const element = document.createElement('div');
      element.className = 'damage-number';
      element.hidden = true;
      this.numbersLayer.append(element);
      this.numbers.push({ element, x: 0, y: 0, z: 0, life: 0 });
    }
  }

  /** Scrive nel DOM solo se il valore è cambiato. */
  private set(key: string, value: string, write: (value: string) => void): void {
    if (this.shown.get(key) === value) return;
    this.shown.set(key, value);
    write(value);
  }

  // -------------------------------------------------------------------------------------------
  // Movimento, FPS, debug
  // -------------------------------------------------------------------------------------------

  frame(dt: number, state: Readonly<PlayerState>, peakSpeed: number, settings: Readonly<Settings>, debugText: string): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= HUD.fpsInterval) {
      this.fps.textContent = `${Math.round(this.frames / this.elapsed)} FPS`;
      this.frames = 0;
      this.elapsed = 0;
    }
    this.fps.hidden = !settings.showFps;

    const speed = horizontalSpeed(state);
    this.set('speed', speed.toFixed(1), (text) => {
      this.speedValue.textContent = text;
      const fill = Math.min(1, speed / (MOVE.runSpeed * HUD.speedBarMaxFactor));
      this.speedFill.style.width = `${(fill * 100).toFixed(1)}%`;
    });
    const tier =
      speed >= MOVE.runSpeed * HUD.blazingFactor ? 'blazing' : speed >= MOVE.runSpeed * HUD.fastFactor ? 'fast' : '';
    this.set('tier', tier, (value) => (this.speedometer.className = value));
    this.set('peak', `record ${peakSpeed.toFixed(1)}`, (text) => (this.speedPeak.textContent = text));

    const chips = [
      state.grounded ? '' : '<span class="chip air">IN ARIA</span>',
      state.sliding ? '<span class="chip slide">SCIVOLATA</span>' : '',
      state.crouched && !state.sliding ? '<span class="chip">ACCOVACCIATO</span>' : '',
    ].join('');
    this.set('chips', chips, (html) => (this.chips.innerHTML = html));
    this.set('debug', settings.showDebug ? debugText : '', (text) => (this.debug.textContent = text));
  }

  // -------------------------------------------------------------------------------------------
  // Combattimento
  // -------------------------------------------------------------------------------------------

  vitals(health: number, alive: boolean, protection: number): void {
    const value = alive ? Math.max(0, Math.ceil(health)) : 0;
    this.set('health', String(value), (text) => {
      this.healthValue.textContent = text;
      this.healthFill.style.width = `${(value / COMBAT.maxHealth) * 100}%`;
      this.healthFill.className = value <= 30 ? 'low' : '';
    });
    this.set('protection', String(alive && protection > 0), (v) => (this.protection.hidden = v !== 'true'));
  }

  weapon(current: number, ammo: number, reloadProgress: number, grenades: number): void {
    const def = this.weapons[current]!;
    // Caricatore 0: munizioni infinite (coltello).
    const infinite = def.magazine === 0;
    this.set('ammo', infinite ? '∞' : String(ammo), (text) => {
      this.ammoMag.textContent = text;
      this.ammoMag.className = infinite ? '' : ammo === 0 ? 'empty' : ammo <= def.magazine * 0.25 ? 'low' : '';
    });
    this.set('ammoMax', infinite ? '' : String(def.magazine), (text) => {
      this.ammoMax.textContent = text;
      this.ammoMax.hidden = text === '';
      (this.ammoMax.previousElementSibling as HTMLElement).hidden = text === '';
    });
    this.set('weaponName', def.name, (text) => (this.weaponName.textContent = text));
    this.set('reloading', String(reloadProgress >= 0), (v) => (this.reloadBar.hidden = v !== 'true'));
    if (reloadProgress >= 0) this.reloadFill.style.width = `${(reloadProgress * 100).toFixed(1)}%`;
    this.set('slot', String(current), (value) => {
      for (const element of this.slots.children) {
        (element as HTMLElement).classList.toggle('active', (element as HTMLElement).dataset.slot === value);
      }
    });
    this.set('grenades', String(grenades), (text) => (this.grenades.textContent = `G · ${this.grenadeName} ×${text}`));
  }

  /** Mirino: lo spazio tra le linee segue la dispersione. */
  crosshairGap(gapPx: number, visible: boolean): void {
    this.set('crossVisible', String(visible), (v) => (this.crosshair.hidden = v !== 'true'));
    this.crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
  }

  scopeVisible(visible: boolean): void {
    this.set('scope', String(visible), (v) => (this.scope.hidden = v !== 'true'));
  }

  hitMarker(head: boolean, kill: boolean): void {
    this.hitTimer = HITMARKER_TIME * (kill ? 1.6 : 1);
    this.hitmarker.className = `show${head ? ' head' : ''}${kill ? ' kill' : ''}`;
  }

  hurt(amount: number): void {
    this.hurtLevel = Math.min(1, this.hurtLevel + amount / 60 + 0.15);
  }

  damageNumber(x: number, y: number, z: number, amount: number, head: boolean, kill: boolean): void {
    const slot = this.numbers.find((n) => n.life <= 0) ?? this.numbers[0]!;
    slot.x = x + (Math.random() - 0.5) * 0.3;
    slot.y = y;
    slot.z = z + (Math.random() - 0.5) * 0.3;
    slot.life = DAMAGE_NUMBER_LIFE;
    slot.element.textContent = String(Math.max(1, Math.round(amount)));
    slot.element.className = `damage-number${head ? ' head' : ''}${kill ? ' kill' : ''}`;
    slot.element.hidden = false;
  }

  killFeed(killer: string, victim: string, weapon: string, headshot: boolean, involvesLocal: boolean): void {
    const entry = document.createElement('div');
    entry.className = `kill-entry${involvesLocal ? ' mine' : ''}`;
    entry.innerHTML =
      killer === victim
        ? `<span class="victim">${escapeHtml(victim)}</span> <span class="weapon">${escapeHtml(weapon)}</span>`
        : `<span class="killer">${escapeHtml(killer)}</span> <span class="weapon">[${escapeHtml(weapon)}]</span>` +
          `${headshot ? ' <span class="head">testa</span>' : ''} <span class="victim">${escapeHtml(victim)}</span>`;
    this.killfeed.prepend(entry);
    while (this.killfeed.children.length > KILLFEED_MAX) this.killfeed.lastElementChild?.remove();
    window.setTimeout(() => entry.remove(), KILLFEED_LIFE * 1000);
  }

  deathScreen(visible: boolean, killer = '', weapon = '', secondsLeft = 0): void {
    this.set('death', String(visible), (v) => (this.death.hidden = v !== 'true'));
    if (!visible) return;
    this.set('deathBy', `${killer}|${weapon}`, () => {
      this.deathBy.textContent = killer ? `da ${killer} · ${weapon}` : weapon;
    });
    this.set('deathTimer', String(Math.ceil(secondsLeft)), (text) => (this.deathTimer.textContent = `Rinasci tra ${text}`));
  }

  scores(rows: ScoreRow[] | null, dt: number): void {
    this.set('scoreboard', String(rows !== null), (v) => (this.scoreboard.hidden = v !== 'true'));
    if (!rows) return;
    this.scoreTimer -= dt;
    if (this.scoreTimer > 0) return;
    this.scoreTimer = 0.25;
    const sorted = [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.scoreRows.innerHTML = sorted
      .map(
        (row) =>
          `<tr class="${row.local ? 'mine' : ''}"><td>${escapeHtml(row.name)}</td><td>${row.kills}</td><td>${row.deaths}</td></tr>`,
      )
      .join('');
  }

  /** Nomi e vita sopra i bot, numeri di danno, segnali che svaniscono. */
  updateOverlays(dt: number, labels: readonly LabelData[], project: Projector): void {
    // Segnale di colpo.
    this.hitTimer -= dt;
    this.hitmarker.style.opacity = this.hitTimer > 0 ? String(Math.min(1, this.hitTimer / 0.08)) : '0';
    // Bordo rosso quando si viene colpiti.
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.8);
    this.vignette.style.opacity = this.hurtLevel.toFixed(3);

    for (const n of this.numbers) {
      if (n.life <= 0) continue;
      n.life -= dt;
      const t = 1 - n.life / DAMAGE_NUMBER_LIFE;
      project(n.x, n.y + t * 0.6, n.z, this.point);
      if (n.life <= 0 || !this.point.visible) {
        n.element.hidden = true;
        continue;
      }
      n.element.style.transform = `translate(${this.point.x.toFixed(1)}px, ${this.point.y.toFixed(1)}px) translate(-50%, -50%)`;
      n.element.style.opacity = String(Math.min(1, (1 - t) * 2));
    }

    const seen = new Set<number>();
    for (const label of labels) {
      seen.add(label.id);
      let entry = this.labels.get(label.id);
      if (!entry) {
        const root = document.createElement('div');
        root.className = 'label';
        root.innerHTML = '<div class="label-name"></div><div class="label-bar"><div></div></div>';
        this.labelsLayer.append(root);
        entry = { root, fill: root.querySelector('.label-bar div') as HTMLDivElement, name: '' };
        this.labels.set(label.id, entry);
      }
      if (entry.name !== label.name) {
        entry.name = label.name;
        (entry.root.firstElementChild as HTMLElement).textContent = label.name;
      }
      project(label.x, label.y, label.z, this.point);
      const visible = label.visible && this.point.visible;
      entry.root.hidden = !visible;
      if (!visible) continue;
      entry.root.style.transform = `translate(${this.point.x.toFixed(1)}px, ${this.point.y.toFixed(1)}px) translate(-50%, -100%)`;
      entry.fill.style.width = `${Math.max(0, (label.health / COMBAT.maxHealth) * 100).toFixed(0)}%`;
    }
    for (const [id, entry] of this.labels) {
      if (seen.has(id)) continue;
      entry.root.remove();
      this.labels.delete(id);
    }
  }
}
