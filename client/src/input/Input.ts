import { PLAYER, type PlayerInput } from '@blockstrike/shared';

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
  };
  return names[code] ?? code;
}

const SLOTS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

const TWO_PI = Math.PI * 2;

/**
 * Tastiera e mouse. I tasti si leggono per posizione fisica (`code`), quindi WASD funziona
 * con qualsiasi layout. Mouse e tasti agiscono solo con il puntatore bloccato.
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
  /** Tabellone dei punteggi visibile (Tab tenuto premuto). */
  scoreboard = false;

  onLockChange: (locked: boolean) => void = () => {};
  onLockError: () => void = () => {};

  private readonly target: HTMLElement;
  private readonly pressed = new Set<string>();
  private bindings: KeyBindings = defaultBindings();
  private gameKeys = new Set<string>();

  /** Tasti scelti nelle impostazioni (i numeri 1-9 restano per le armi). */
  setBindings(bindings: Readonly<KeyBindings>): void {
    const next = defaultBindings();
    for (const action of KEY_ACTIONS) if (bindings[action]?.length) next[action] = [...bindings[action]];
    this.bindings = next;
    this.gameKeys = new Set([...KEY_ACTIONS.flatMap((action) => next[action]), ...SLOTS]);
    this.pressed.clear();
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

  constructor(target: HTMLElement) {
    this.target = target;
    this.setBindings(this.bindings);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.releaseAll);
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

  /** Riempie i comandi per il prossimo tick di simulazione (tranne l'arma: vedi consumeWeaponRequest). */
  sample(out: PlayerInput): void {
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    out.forward = this.axis(this.bindings.forward, this.bindings.back);
    out.right = this.axis(this.bindings.right, this.bindings.left);
    // Una pressione breve avvenuta tra due tick non va persa.
    out.jump = this.any(this.bindings.jump) || this.jumpLatch;
    out.crouch = this.any(this.bindings.crouch);
    out.fire = this.fireHeld || this.fireLatch;
    out.ads = this.adsHeld;
    out.reload = this.any(this.bindings.reload) || this.reloadLatch;
    out.grenade = this.any(this.bindings.grenade) || this.grenadeLatch;
    this.jumpLatch = false;
    this.fireLatch = false;
    this.reloadLatch = false;
    this.grenadeLatch = false;
  }

  /**
   * Arma richiesta (1 = prima posizione) da tasti numerici, Q (arma precedente) o rotella;
   * 0 se nessuna richiesta.
   */
  consumeWeaponRequest(current: number, previous: number, count: number): number {
    let slot = 0;
    if (this.requestedSlot > 0) slot = this.requestedSlot;
    else if (this.lastWeaponLatch) slot = previous + 1;
    else if (this.wheel !== 0) slot = ((current + Math.sign(this.wheel) + count) % count) + 1;
    this.requestedSlot = 0;
    this.lastWeaponLatch = false;
    this.wheel = 0;
    return slot <= count ? slot : 0;
  }

  consumeRespawn(): boolean {
    const value = this.respawnLatch;
    this.respawnLatch = false;
    return value;
  }

  private axis(positive: readonly string[], negative: readonly string[]): number {
    return (this.any(positive) ? 1 : 0) - (this.any(negative) ? 1 : 0);
  }

  private any(codes: readonly string[]): boolean {
    for (const code of codes) if (this.pressed.has(code)) return true;
    return false;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.typing || !this.locked || !this.gameKeys.has(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    this.pressed.add(event.code);
    const b = this.bindings;
    if (b.jump.includes(event.code)) this.jumpLatch = true;
    if (b.reload.includes(event.code)) this.reloadLatch = true;
    if (b.grenade.includes(event.code)) this.grenadeLatch = true;
    if (b.respawn.includes(event.code)) this.respawnLatch = true;
    if (b.lastWeapon.includes(event.code)) this.lastWeaponLatch = true;
    if (b.scoreboard.includes(event.code)) this.scoreboard = true;
    const slot = SLOTS.indexOf(event.code);
    if (slot >= 0) this.requestedSlot = slot + 1;
  };

  /** Mentre si scrive in chat i tasti non muovono il giocatore. */
  get typing(): boolean {
    return this.typingFlag;
  }

  set typing(value: boolean) {
    this.typingFlag = value;
    if (value) this.pressed.clear();
  }

  private typingFlag = false;

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
    if (this.bindings.scoreboard.includes(event.code)) this.scoreboard = false;
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
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
    this.scoreboard = false;
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    const scale = this.radiansPerPixel * this.sensitivityScale;
    this.yaw -= event.movementX * scale;
    this.pitch -= event.movementY * scale;
    this.pitch = Math.max(-PLAYER.pitchLimit, Math.min(PLAYER.pitchLimit, this.pitch));
    // Mantiene lo yaw tra -π e π: niente valori che crescono all'infinito.
    this.yaw -= TWO_PI * Math.floor((this.yaw + Math.PI) / TWO_PI);
  };

  private readonly handleLockChange = (): void => {
    if (!this.locked) this.releaseAll();
    this.onLockChange(this.locked);
  };

  private readonly handleLockError = (): void => {
    this.onLockError();
  };
}
