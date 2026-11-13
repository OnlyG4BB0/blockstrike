import { PLAYER, type PlayerInput } from '@blockstrike/shared';
import { GamepadInput, type PadMenuHandler } from './Gamepad.ts';
import { TouchControls } from './Touch.ts';
import type { DeviceKind, PadStyle } from './devices.ts';

/** Azioni assegnabili a un tasto dalle impostazioni. */
export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'reload'
  | 'grenade'
  | 'lastWeapon'
  | 'respawn'
  | 'scoreboard';

export type KeyBindings = Record<KeyAction, string[]>;

export const KEY_ACTIONS: readonly KeyAction[] = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'reload',
  'grenade',
  'lastWeapon',
  'respawn',
  'scoreboard',
];

/** Nomi delle azioni nel menu dei tasti. */
export const KEY_ACTION_NAMES: Readonly<Record<KeyAction, string>> = {
  forward: 'Avanti',
  back: 'Indietro',
  left: 'Sinistra',
  right: 'Destra',
  jump: 'Salto',
  crouch: 'Accovacciarsi / scivolare',
  reload: 'Ricarica',
  grenade: 'Granata',
  lastWeapon: 'Arma precedente',
  respawn: 'Ricomincia (allenamento)',
  scoreboard: 'Punteggi',
};

export const DEFAULT_BINDINGS: Readonly<KeyBindings> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ShiftLeft', 'ShiftRight', 'KeyC'],
  reload: ['KeyR'],
  grenade: ['KeyG'],
  lastWeapon: ['KeyQ'],
  respawn: ['KeyK'],
  scoreboard: ['Tab'],
};

/** Copia indipendente delle assegnazioni predefinite. */
export function defaultBindings(): KeyBindings {
  const copy = {} as KeyBindings;
  for (const action of KEY_ACTIONS) copy[action] = [...DEFAULT_BINDINGS[action]];
  return copy;
}

/** Nome leggibile di un tasto (dal codice fisico). */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Spazio',
    ShiftLeft: 'Maiusc sx',
    ShiftRight: 'Maiusc dx',
    ControlLeft: 'Ctrl sx',
    ControlRight: 'Ctrl dx',
    AltLeft: 'Alt',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    CapsLock: 'Bloc Maiusc',
    Escape: 'Esc',
    Enter: 'Invio',
  };
  return names[code] ?? code;
}

const SLOTS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

const TWO_PI = Math.PI * 2;

/** Un tocco o un mouse appena mosso sposta i tasti mostrati (sopra questa soglia, in px). */
const MOUSE_SWITCH_PX = 3;

/** Schermo touch senza mouse: telefono o tablet. */
export function isTouchDevice(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
}

/**
 * Comandi del giocatore da tre fonti insieme: tastiera e mouse (con il puntatore bloccato), schermo
 * touch e controller. I tasti si leggono per posizione fisica (`code`), quindi WASD funziona con
 * qualsiasi layout.
 *
 * Si gioca quando il puntatore è bloccato (mouse) oppure dopo `play()` con touch o controller, che
 * non bloccano il puntatore: per uscire ci sono Esc, Start e il tasto di pausa sullo schermo.
 * Il dispositivo usato per ultimo (`device`) decide quali tasti mostrare.
 */
export class Input {
  /** Rotazione orizzontale corrente (radianti). */
  yaw = 0;
  /** Rotazione verticale corrente (radianti). */
  pitch = 0;
  /** Radianti per pixel di movimento del mouse. */
  radiansPerPixel = 0.002;
  /** Moltiplicatore della sensibilità (ridotta quando si mira con lo zoom). */
  sensitivityScale = 1;

  readonly pad = new GamepadInput();
  readonly touch: TouchControls;

  device: DeviceKind;

  /** Si gioca (o si torna al menu): con il mouse coincide con il puntatore bloccato. */
  onActiveChange: (active: boolean) => void = () => {};
  onLockError: () => void = () => {};
  /** Cambiato il dispositivo usato (o il modello di controller). */
  onDeviceChange: (device: DeviceKind, style: PadStyle) => void = () => {};

  private readonly target: HTMLElement;
  private readonly pressed = new Set<string>();
  private bindings: KeyBindings = defaultBindings();
  private gameKeys = new Set<string>();
  private playing = false;
  private scoreboardKey = false;

  /** Tasti scelti nelle impostazioni (i numeri 1-9 restano per le armi). */
  setBindings(bindings: Readonly<KeyBindings>): void {
    const next = defaultBindings();
    for (const action of KEY_ACTIONS) if (bindings[action]?.length) next[action] = [...bindings[action]];
    this.bindings = next;
    this.gameKeys = new Set([...KEY_ACTIONS.flatMap((action) => next[action]), ...SLOTS]);
    this.pressed.clear();
  }

  get keys(): Readonly<KeyBindings> {
    return this.bindings;
  }

  private fireHeld = false;
  private fireLatch = false;
  private adsHeld = false;
  private jumpLatch = false;
  private reloadLatch = false;
  private grenadeLatch = false;
  private respawnLatch = false;
  private lastWeaponLatch = false;
  private requestedSlot = 0;
  private wheel = 0;

  constructor(target: HTMLElement, overlayParent: HTMLElement) {
    this.target = target;
    this.device = isTouchDevice() ? 'touch' : 'keyboard';
    this.setBindings(this.bindings);
    this.touch = new TouchControls(overlayParent);
    this.touch.onLook = (dx, dy) => this.turn(-dx * this.sensitivityScale, -dy * this.sensitivityScale);
    this.touch.onPause = () => this.pause();
    this.touch.onActivity = () => this.useDevice('touch');
    this.pad.onActivity = () => this.useDevice('gamepad');
    this.pad.onPause = () => this.pause();
    this.pad.onConnectionChange = (connected) => {
      // Controller scollegato: si torna ai comandi del dispositivo.
      if (!connected && this.device === 'gamepad') this.useDevice(isTouchDevice() ? 'touch' : 'keyboard');
      else this.onDeviceChange(this.device, this.pad.style);
    };
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.releaseAll);
    window.addEventListener('pointerdown', this.handlePointerDevice, true);
    window.addEventListener('pointermove', this.handlePointerDevice, true);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('wheel', this.handleWheel, { passive: false });
    document.addEventListener('contextmenu', this.handleContextMenu);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('pointerlockerror', this.handleLockError);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Si sta giocando: puntatore bloccato, oppure partita avviata con touch o controller. */
  get active(): boolean {
    return this.locked || this.playing;
  }

  /** Tabellone dei punteggi visibile (tasto tenuto premuto, da qualunque dispositivo). */
  get scoreboard(): boolean {
    return this.scoreboardKey || this.pad.scoreboard || this.touch.scoreboard;
  }

  /** Comincia a giocare (va chiamato da un'azione dell'utente: clic, tocco o tasto del controller). */
  play(): void {
    if (this.device === 'keyboard') {
      void this.requestLock();
      return;
    }
    if (this.device === 'touch') enterFullscreen();
    if (!this.playing) {
      this.playing = true;
      this.onActiveChange(true);
    }
  }

  /** Torna al menu. */
  pause(): void {
    const wasActive = this.active;
    this.playing = false;
    this.releaseAll();
    if (this.locked) document.exitPointerLock();
    else if (wasActive) this.onActiveChange(false);
  }

  /** Chiede al browser di bloccare il puntatore (va chiamato da un clic dell'utente). */
  async requestLock(): Promise<void> {
    try {
      // Movimento grezzo del mouse, senza l'accelerazione del sistema operativo, dove supportato.
      await this.target.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.target.requestPointerLock();
      } catch {
        this.onLockError();
      }
    }
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /**
   * A ogni fotogramma: legge il controller (visuale integrata con il tempo vero del fotogramma) e,
   * con il menu aperto, lo usa per navigarlo.
   */
  update(dt: number, menu: PadMenuHandler | null): void {
    this.pad.poll(dt, menu);
    if (!menu && (this.pad.lookYaw !== 0 || this.pad.lookPitch !== 0)) {
      this.turn(this.pad.lookYaw * this.sensitivityScale, this.pad.lookPitch * this.sensitivityScale);
    }
  }

  /** Piccola rotazione decisa dal gioco (automira), con gli stessi limiti del dito e del mouse. */
  nudge(yaw: number, pitch: number): void {
    this.turn(yaw, pitch);
  }

  /** Riempie i comandi per il prossimo tick di simulazione (tranne l'arma: vedi consumeWeaponRequest). */
  sample(out: PlayerInput): void {
    const pad = this.pad;
    const touch = this.touch;
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    // Il server accetta solo -1, 0, 1: vince la tastiera, poi il controller, poi il touch.
    const keyForward = this.axis(this.bindings.forward, this.bindings.back);
    const keyRight = this.axis(this.bindings.right, this.bindings.left);
    out.forward = keyForward !== 0 ? keyForward : pad.forward !== 0 ? pad.forward : touch.forward;
    out.right = keyRight !== 0 ? keyRight : pad.right !== 0 ? pad.right : touch.right;
    // Una pressione breve avvenuta tra due tick non va persa.
    out.jump = this.any(this.bindings.jump) || this.jumpLatch || pad.jumpHeld || pad.jumpLatch || touch.jumpHeld || touch.jumpLatch;
    out.crouch = this.any(this.bindings.crouch) || pad.crouch || touch.crouch;
    out.fire = this.fireHeld || this.fireLatch || pad.fire || touch.fire;
    out.ads = this.adsHeld || pad.ads || touch.ads;
    out.reload = this.any(this.bindings.reload) || this.reloadLatch || pad.reloadLatch || touch.reloadLatch;
    out.grenade = this.any(this.bindings.grenade) || this.grenadeLatch || pad.grenadeLatch || touch.grenadeLatch;
    this.jumpLatch = false;
    this.fireLatch = false;
    this.reloadLatch = false;
    this.grenadeLatch = false;
    pad.jumpLatch = false;
    pad.reloadLatch = false;
    pad.grenadeLatch = false;
    touch.jumpLatch = false;
    touch.reloadLatch = false;
    touch.grenadeLatch = false;
  }

  /**
   * Arma richiesta (1 = prima posizione) da tasti numerici, Q (arma precedente), rotella, croce
   * del controller, Y o il tasto touch; 0 se nessuna richiesta.
   */
  consumeWeaponRequest(current: number, previous: number, count: number): number {
    const pad = this.pad;
    const touch = this.touch;
    let slot = 0;
    if (this.requestedSlot > 0) slot = this.requestedSlot;
    else if (pad.slot > 0) slot = pad.slot;
    else if (this.lastWeaponLatch || pad.lastWeaponLatch || touch.lastWeaponLatch) slot = previous + 1;
    else if (pad.nextWeaponLatch || touch.nextWeaponLatch) slot = ((current + 1) % count) + 1;
    else if (this.wheel !== 0) slot = ((current + Math.sign(this.wheel) + count) % count) + 1;
    this.requestedSlot = 0;
    this.lastWeaponLatch = false;
    this.wheel = 0;
    pad.slot = 0;
    pad.lastWeaponLatch = false;
    pad.nextWeaponLatch = false;
    touch.lastWeaponLatch = false;
    touch.nextWeaponLatch = false;
    return slot <= count ? slot : 0;
  }

  consumeRespawn(): boolean {
    const value = this.respawnLatch || this.pad.respawnLatch || this.touch.respawnLatch;
    this.respawnLatch = false;
    this.pad.respawnLatch = false;
    this.touch.respawnLatch = false;
    return value;
  }

  /** Mentre si scrive in chat i tasti non muovono il giocatore. */
  get typing(): boolean {
    return this.typingFlag;
  }

  set typing(value: boolean) {
    this.typingFlag = value;
    if (value) this.pressed.clear();
  }

  private typingFlag = false;

  /** Ruota la visuale (radianti), tenendo lo sguardo verticale nei limiti e lo yaw tra -π e π. */
  private turn(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch = Math.max(-PLAYER.pitchLimit, Math.min(PLAYER.pitchLimit, this.pitch + pitch));
    this.yaw -= TWO_PI * Math.floor((this.yaw + Math.PI) / TWO_PI);
  }

  private useDevice(device: DeviceKind): void {
    const style = this.pad.style;
    if (device === this.device && (device !== 'gamepad' || style === this.lastStyle)) return;
    this.device = device;
    this.lastStyle = style;
    this.onDeviceChange(device, style);
  }

  private lastStyle: PadStyle = 'generic';

  private axis(positive: readonly string[], negative: readonly string[]): number {
    return (this.any(positive) ? 1 : 0) - (this.any(negative) ? 1 : 0);
  }

  private any(codes: readonly string[]): boolean {
    for (const code of codes) if (this.pressed.has(code)) return true;
    return false;
  }

  private readonly handlePointerDevice = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      if (event.type === 'pointerdown') this.useDevice('touch');
    } else if (event.pointerType === 'mouse') {
      // Sui telefoni dopo un tocco arrivano anche eventi del mouse finti: si decide da pointerType.
      if (event.type === 'pointerdown' || Math.abs(event.movementX) + Math.abs(event.movementY) > MOUSE_SWITCH_PX) {
        this.useDevice('keyboard');
      }
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // La tastiera del telefono, mentre si scrive in un campo, non conta come tastiera fisica.
    const field = event.target instanceof HTMLElement && event.target.closest('input, textarea, select');
    if (!field && event.key !== 'Unidentified' && !event.isComposing) this.useDevice('keyboard');
    if (event.code === 'Escape' && this.playing && !this.locked && !this.typing) {
      event.preventDefault();
      this.pause();
      return;
    }
    if (this.typing || !this.active || !this.gameKeys.has(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    this.pressed.add(event.code);
    const b = this.bindings;
    if (b.jump.includes(event.code)) this.jumpLatch = true;
    if (b.reload.includes(event.code)) this.reloadLatch = true;
    if (b.grenade.includes(event.code)) this.grenadeLatch = true;
    if (b.respawn.includes(event.code)) this.respawnLatch = true;
    if (b.lastWeapon.includes(event.code)) this.lastWeaponLatch = true;
    if (b.scoreboard.includes(event.code)) this.scoreboardKey = true;
    const slot = SLOTS.indexOf(event.code);
    if (slot >= 0) this.requestedSlot = slot + 1;
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
    if (this.bindings.scoreboard.includes(event.code)) this.scoreboardKey = false;
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    // Partita avviata con il controller e poi si prende il mouse: un clic blocca il puntatore.
    if (this.playing && !this.locked && this.device === 'keyboard' && event.target === this.target) {
      void this.requestLock();
      return;
    }
    if (!this.locked) return;
    if (event.button === 0) {
      this.fireHeld = true;
      this.fireLatch = true;
    } else if (event.button === 2) {
      this.adsHeld = true;
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.fireHeld = false;
    else if (event.button === 2) this.adsHeld = false;
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.locked) return;
    event.preventDefault();
    if (event.deltaY !== 0) this.wheel += Math.sign(event.deltaY);
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (this.locked) event.preventDefault();
  };

  private readonly releaseAll = (): void => {
    this.pressed.clear();
    this.fireHeld = false;
    this.adsHeld = false;
    this.jumpLatch = false;
    this.fireLatch = false;
    this.scoreboardKey = false;
    this.pad.clear();
    this.touch.releaseAll();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    const scale = this.radiansPerPixel * this.sensitivityScale;
    this.turn(-event.movementX * scale, -event.movementY * scale);
  };

  private readonly handleLockChange = (): void => {
    // Perdere il puntatore (Esc) è sempre una pausa, anche se si era partiti con il controller.
    if (!this.locked) {
      this.playing = false;
      this.releaseAll();
    }
    this.onActiveChange(this.active);
  };

  private readonly handleLockError = (): void => {
    this.onLockError();
  };
}

/** Schermo intero e orizzontale sui telefoni (dove il browser lo permette; altrimenti niente). */
function enterFullscreen(): void {
  const root = document.documentElement;
  // Il browser lo concede solo durante un gesto vero (un tocco): senza, non si chiede nemmeno.
  if (document.fullscreenElement || !root.requestFullscreen || navigator.userActivation?.isActive === false) return;
  root
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return orientation.lock?.('landscape');
    })
    .catch(() => {});
}
