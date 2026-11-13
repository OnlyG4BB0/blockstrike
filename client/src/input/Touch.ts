/**
 * Comandi touch sullo schermo (telefoni e tablet). Metà sinistra: levetta che compare dove si
 * appoggia il pollice. Metà destra: si trascina per guardarsi intorno. Tasti: fuoco (si può
 * trascinare anche lui per mirare mentre si spara), mirino, salto, giù, ricarica, granata, arma
 * (tenuto premuto: quella di prima), punteggi, pausa, chat (online) e ricomincia (allenamento).
 * Si usano i Pointer Events: ogni dito ha il suo ruolo finché non si alza.
 */
import { TOUCH } from '../config.ts';
import { toDigital } from './devices.ts';

type Role =
  | 'move'
  | 'look'
  | 'fire'
  | 'aim'
  | 'jump'
  | 'crouch'
  | 'reload'
  | 'grenade'
  | 'weapon'
  | 'score'
  | 'pause'
  | 'chat'
  | 'respawn';

const BUTTONS: readonly { role: Role; label: string; title: string }[] = [
  { role: 'fire', label: '✹', title: 'Fuoco' },
  { role: 'aim', label: '◎', title: 'Mirino' },
  { role: 'jump', label: '⤒', title: 'Salta' },
  { role: 'crouch', label: '⤓', title: 'Giù' },
  { role: 'reload', label: '⟳', title: 'Ricarica' },
  { role: 'grenade', label: '●', title: 'Granata' },
  { role: 'weapon', label: '⇄', title: 'Arma (tieni premuto: quella di prima)' },
  { role: 'score', label: '☰', title: 'Punteggi' },
  { role: 'pause', label: '❚❚', title: 'Menu' },
  { role: 'chat', label: '💬', title: 'Chat' },
  { role: 'respawn', label: '↺', title: 'Ricomincia' },
];

interface Finger {
  role: Role;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
}

export class TouchControls {
  readonly root: HTMLElement;
  /** Moltiplicatore della velocità della visuale (impostazioni). */
  sensitivity = 1;

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

  /** Trascinamento per guardarsi intorno, in radianti (a sensibilità e zoom già applicati da Input). */
  onLook: (dx: number, dy: number) => void = () => {};
  onPause: () => void = () => {};
  onChat: () => void = () => {};
  /** Usato il touch (per mostrare i suoi comandi). */
  onActivity: () => void = () => {};

  private readonly fingers = new Map<number, Finger>();
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<Role, HTMLElement>();

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.id = 'touch';
    root.hidden = true;
    root.innerHTML = '<div class="touch-zone touch-move"></div><div class="touch-zone touch-look"></div>';
    this.stick = document.createElement('div');
    this.stick.className = 'touch-stick';
    this.stick.hidden = true;
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.stick.append(this.knob);
    root.append(this.stick);
    for (const b of BUTTONS) {
      const button = document.createElement('div');
      button.className = `tbtn tbtn-${b.role}`;
      button.dataset.role = b.role;
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', b.title);
      button.textContent = b.label;
      root.append(button);
      this.buttons.set(b.role, button);
    }
    parent.append(root);
    this.root = root;
    root.addEventListener('pointerdown', this.handleDown);
    root.addEventListener('pointermove', this.handleMove);
    root.addEventListener('pointerup', this.handleUp);
    root.addEventListener('pointercancel', this.handleUp);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Mostra o nasconde i comandi; online c'è la chat, in allenamento il tasto per ricominciare. */
  setVisible(visible: boolean, online: boolean): void {
    this.root.hidden = !visible;
    this.buttons.get('chat')!.hidden = !online;
    this.buttons.get('respawn')!.hidden = online;
    if (!visible) this.releaseAll();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  releaseAll(): void {
    this.fingers.clear();
    this.forward = 0;
    this.right = 0;
    this.fire = false;
    this.ads = false;
    this.crouch = false;
    this.jumpHeld = false;
    this.scoreboard = false;
    this.stick.hidden = true;
    for (const button of this.buttons.values()) button.classList.remove('down', 'on');
  }

  private roleAt(event: PointerEvent): Role {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.tbtn');
    if (button?.dataset.role) return button.dataset.role as Role;
    return event.clientX < window.innerWidth * 0.45 ? 'move' : 'look';
  }

  private readonly handleDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.onActivity();
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // Puntatori sintetici (prove) non si possono catturare: si va avanti lo stesso.
    }
    const role = this.roleAt(event);
    this.fingers.set(event.pointerId, {
      role,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startTime: performance.now(),
    });
    this.buttons.get(role)?.classList.add('down');
    switch (role) {
      case 'move':
        this.stick.hidden = false;
        this.stick.style.left = `${event.clientX}px`;
        this.stick.style.top = `${event.clientY}px`;
        this.knob.style.transform = 'translate(-50%, -50%)';
        break;
      case 'fire':
        this.fire = true;
        break;
      case 'aim':
        this.ads = !this.ads;
        this.buttons.get('aim')!.classList.toggle('on', this.ads);
        break;
      case 'jump':
        this.jumpHeld = true;
        this.jumpLatch = true;
        break;
      case 'crouch':
        this.crouch = !this.crouch;
        this.buttons.get('crouch')!.classList.toggle('on', this.crouch);
        break;
      case 'reload':
        this.reloadLatch = true;
        break;
      case 'grenade':
        this.grenadeLatch = true;
        break;
      case 'score':
        this.scoreboard = true;
        break;
      case 'pause':
        this.onPause();
        break;
      case 'chat':
        this.onChat();
        break;
      case 'respawn':
        this.respawnLatch = true;
        break;
      default:
        break;
    }
  };

  private readonly handleMove = (event: PointerEvent): void => {
    const finger = this.fingers.get(event.pointerId);
    if (!finger) return;
    event.preventDefault();
    if (finger.role === 'move') {
      const r = TOUCH.joystickRadius;
      let dx = event.clientX - finger.startX;
      let dy = event.clientY - finger.startY;
      const length = Math.hypot(dx, dy);
      if (length > r) {
        dx = (dx / length) * r;
        dy = (dy / length) * r;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.right = toDigital(dx / r, TOUCH.moveThreshold);
      this.forward = toDigital(-dy / r, TOUCH.moveThreshold);
    } else if (finger.role === 'look' || finger.role === 'fire') {
      const scale = TOUCH.lookRadiansPerPixel * this.sensitivity;
      this.onLook((event.clientX - finger.lastX) * scale, (event.clientY - finger.lastY) * scale);
    }
    finger.lastX = event.clientX;
    finger.lastY = event.clientY;
  };

  private readonly handleUp = (event: PointerEvent): void => {
    const finger = this.fingers.get(event.pointerId);
    if (!finger) return;
    this.fingers.delete(event.pointerId);
    this.buttons.get(finger.role)?.classList.remove('down');
    switch (finger.role) {
      case 'move':
        this.forward = 0;
        this.right = 0;
        this.stick.hidden = true;
        break;
      case 'fire':
        this.fire = false;
        break;
      case 'jump':
        this.jumpHeld = false;
        break;
      case 'score':
        this.scoreboard = false;
        break;
      case 'weapon':
        if ((performance.now() - finger.startTime) / 1000 >= TOUCH.longPress) this.lastWeaponLatch = true;
        else this.nextWeaponLatch = true;
        break;
      default:
        break;
    }
  };
}
