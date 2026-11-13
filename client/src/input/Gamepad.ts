/**
 * Controller con la Gamepad API. Si legge una volta per fotogramma (`poll`), anche con il menu
 * aperto: in gioco dà movimento, visuale e azioni; nel menu sposta la selezione, preme, torna
 * indietro e cambia scheda. Start mette in pausa e riprende.
 */
import { GAMEPAD } from '../config.ts';
import {
  PAD,
  applyDeadzone,
  buttonValue,
  lookRate,
  navDirection,
  padActivity,
  padStyleOf,
  toDigital,
  type NavDirection,
  type PadStyle,
} from './devices.ts';

/** Cosa fa il controller nel menu (lo implementa il menu). */
export interface PadMenuHandler {
  navigate(direction: NavDirection): void;
  activate(): void;
  back(): void;
  switchTab(delta: number): void;
  start(): void;
}

const BUTTONS = 17;

export class GamepadInput {
  connected = false;
  style: PadStyle = 'generic';
  /** Moltiplicatore della velocità della visuale (impostazioni). */
  sensitivity = 1;
  invertY = false;
  vibration = true;

  // Stato per il prossimo tick (letto e in parte azzerato da Input).
  forward = 0;
  right = 0;
  fire = false;
  ads = false;
  crouch = false;
  jumpHeld = false;
  scoreboard = false;
  jumpLatch = false;
  reloadLatch = false;
  grenadeLatch = false;
  nextWeaponLatch = false;
  lastWeaponLatch = false;
  respawnLatch = false;
  /** Arma richiesta dalla croce (1, 2, 3), 0 se nessuna. */
  slot = 0;

  /** Rotazione da aggiungere alla visuale in questo fotogramma (radianti). */
  lookYaw = 0;
  lookPitch = 0;

  /** Il controller è stato usato (tasto o levetta): si mostrano i suoi tasti. */
  onActivity: (style: PadStyle) => void = () => {};
  onConnectionChange: (connected: boolean) => void = () => {};
  /** Start in gioco: pausa. */
  onPause: () => void = () => {};

  private readonly previous: boolean[] = new Array<boolean>(BUTTONS).fill(false);
  private readonly current: boolean[] = new Array<boolean>(BUTTONS).fill(false);
  private readonly stick = { x: 0, y: 0 };
  private navHeld: NavDirection | null = null;
  private navTimer = 0;
  private padIndex = -1;

  /** Da chiamare a ogni fotogramma. `menu` è null quando si sta giocando. */
  poll(dt: number, menu: PadMenuHandler | null): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
    const pad = this.find();
    if (!pad) {
      if (this.connected) {
        this.connected = false;
        this.clear();
        this.onConnectionChange(false);
      }
      return;
    }
    if (!this.connected) {
      this.connected = true;
      this.style = padStyleOf(pad.id);
      this.onConnectionChange(true);
    }
    if (padActivity(pad, GAMEPAD.activity)) this.onActivity(this.style);

    for (let i = 0; i < BUTTONS; i++) {
      this.previous[i] = this.current[i]!;
      const trigger = i === PAD.lt || i === PAD.rt;
      this.current[i] = buttonValue(pad.buttons, i) > (trigger ? GAMEPAD.trigger : 0.5);
    }

    if (menu) {
      this.clear();
      this.menuInput(dt, pad, menu);
      return;
    }
    this.navHeld = null;

    applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, GAMEPAD.deadzone, this.stick);
    this.right = toDigital(this.stick.x, GAMEPAD.moveThreshold);
    this.forward = toDigital(-this.stick.y, GAMEPAD.moveThreshold);

    applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, GAMEPAD.deadzone, this.stick);
    const speed = GAMEPAD.lookSpeed * this.sensitivity * dt;
    this.lookYaw = -lookRate(this.stick.x, GAMEPAD.lookCurve) * speed;
    this.lookPitch = -lookRate(this.stick.y, GAMEPAD.lookCurve) * speed * GAMEPAD.lookVerticalScale * (this.invertY ? -1 : 1);

    this.fire = this.current[PAD.rt]!;
    this.ads = this.current[PAD.lt]!;
    this.crouch = this.current[PAD.b]! || this.current[PAD.ls]!;
    this.jumpHeld = this.current[PAD.a]!;
    this.scoreboard = this.current[PAD.back]!;
    if (this.pressed(PAD.a)) this.jumpLatch = true;
    if (this.pressed(PAD.x)) this.reloadLatch = true;
    if (this.pressed(PAD.rb)) this.grenadeLatch = true;
    if (this.pressed(PAD.y)) this.nextWeaponLatch = true;
    if (this.pressed(PAD.lb)) this.lastWeaponLatch = true;
    if (this.pressed(PAD.down)) this.respawnLatch = true;
    if (this.pressed(PAD.left)) this.slot = 1;
    if (this.pressed(PAD.up)) this.slot = 2;
    if (this.pressed(PAD.right)) this.slot = 3;
    if (this.pressed(PAD.start)) this.onPause();
  }

  /** Vibrazione breve (se il controller la supporta e non è disattivata). */
  rumble(durationMs: number, weak: number, strong: number): void {
    if (!this.vibration || this.padIndex < 0) return;
    const pad = navigator.getGamepads?.()[this.padIndex];
    const actuator = pad?.vibrationActuator;
    if (!actuator) return;
    try {
      void actuator
        .playEffect('dual-rumble', { duration: durationMs, weakMagnitude: weak, strongMagnitude: strong })
        .catch(() => {});
    } catch {
      // Alcuni browser espongono l'attuatore senza supportare l'effetto.
    }
  }

  /** Lascia tutto: nessun tasto tenuto, nessuna richiesta in sospeso. */
  clear(): void {
    this.forward = 0;
    this.right = 0;
    this.fire = false;
    this.ads = false;
    this.crouch = false;
    this.jumpHeld = false;
    this.scoreboard = false;
    this.jumpLatch = false;
    this.reloadLatch = false;
    this.grenadeLatch = false;
    this.nextWeaponLatch = false;
    this.lastWeaponLatch = false;
    this.respawnLatch = false;
    this.slot = 0;
  }

  private pressed(index: number): boolean {
    return this.current[index]! && !this.previous[index]!;
  }

  /** Il primo controller collegato, preferendo uno con la disposizione standard. */
  private find(): Gamepad | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let fallback: Gamepad | null = null;
    let fallbackIndex = -1;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;
      if (pad.mapping === 'standard') {
        this.padIndex = i;
        return pad;
      }
      if (!fallback) {
        fallback = pad;
        fallbackIndex = i;
      }
    }
    this.padIndex = fallbackIndex;
    return fallback;
  }

  private menuInput(dt: number, pad: Gamepad, menu: PadMenuHandler): void {
    if (this.pressed(PAD.start)) {
      menu.start();
      return;
    }
    if (this.pressed(PAD.a)) menu.activate();
    if (this.pressed(PAD.b)) menu.back();
    if (this.pressed(PAD.lb)) menu.switchTab(-1);
    if (this.pressed(PAD.rb)) menu.switchTab(1);

    const dpadX = (this.current[PAD.right] ? 1 : 0) - (this.current[PAD.left] ? 1 : 0);
    const dpadY = (this.current[PAD.down] ? 1 : 0) - (this.current[PAD.up] ? 1 : 0);
    const direction =
      navDirection(dpadX, dpadY, 0.5) ?? navDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0, GAMEPAD.navThreshold);
    if (!direction) {
      this.navHeld = null;
      return;
    }
    if (direction !== this.navHeld) {
      this.navHeld = direction;
      this.navTimer = GAMEPAD.navDelay;
      menu.navigate(direction);
      return;
    }
    this.navTimer -= dt;
    if (this.navTimer <= 0) {
      this.navTimer = GAMEPAD.navRepeat;
      menu.navigate(direction);
    }
  }
}
