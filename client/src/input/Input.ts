import { PLAYER, type PlayerInput } from '@blockstrike/shared';

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const JUMP = ['Space'];
const CROUCH = ['ShiftLeft', 'ShiftRight', 'KeyC'];
const RESPAWN = ['KeyK'];
const GAME_KEYS = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...JUMP, ...CROUCH, ...RESPAWN]);

const TWO_PI = Math.PI * 2;

/**
 * Tastiera e mouse. I tasti si leggono per posizione fisica (`code`), quindi WASD funziona
 * con qualsiasi layout. Il mouse ruota la visuale solo con il puntatore bloccato.
 */
export class Input {
  /** Rotazione orizzontale corrente (radianti). */
  yaw = 0;
  /** Rotazione verticale corrente (radianti). */
  pitch = 0;
  /** Radianti per pixel di movimento del mouse. */
  radiansPerPixel = 0.002;

  onLockChange: (locked: boolean) => void = () => {};
  onLockError: () => void = () => {};

  private readonly target: HTMLElement;
  private readonly pressed = new Set<string>();
  private jumpLatch = false;
  private respawnLatch = false;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('mousemove', this.handleMouseMove);
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

  /** Riempie i comandi per il prossimo tick di simulazione. */
  sample(out: PlayerInput): void {
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    out.forward = this.axis(FORWARD, BACK);
    out.right = this.axis(RIGHT, LEFT);
    // Un salto premuto e rilasciato tra due tick non va perso.
    out.jump = this.any(JUMP) || this.jumpLatch;
    out.crouch = this.any(CROUCH);
    this.jumpLatch = false;
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
    if (!this.locked || !GAME_KEYS.has(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    this.pressed.add(event.code);
    if (JUMP.includes(event.code)) this.jumpLatch = true;
    if (RESPAWN.includes(event.code)) this.respawnLatch = true;
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly releaseAll = (): void => {
    this.pressed.clear();
    this.jumpLatch = false;
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.yaw -= event.movementX * this.radiansPerPixel;
    this.pitch -= event.movementY * this.radiansPerPixel;
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
