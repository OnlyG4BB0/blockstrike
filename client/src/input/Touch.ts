/**
 * Comandi touch sullo schermo (telefoni e tablet). Metà sinistra: levetta che compare dove si
 * appoggia il pollice. Metà destra: si trascina per guardarsi intorno, anche partendo da un tasto
 * (fuoco, mirino, salto, giù, ricarica, granata, arma): il tasto agisce e il dito muove la visuale.
 * La visuale accelera con gli scatti veloci e resta precisa con i movimenti lenti.
 *
 * Posizione e dimensione dei tasti vengono dalle impostazioni e si cambiano con l'editor
 * (`edit`): si trascinano i tasti, si sceglie la dimensione, si ripristina la disposizione.
 * Si usano i Pointer Events: ogni dito ha il suo ruolo finché non si alza.
 */
import { TOUCH } from '../config.ts';
import { toDigital } from './devices.ts';
import { LOOK_BUTTONS, defaultTouchLayout, lookGain, type TouchButton, type TouchLayout } from './touchLayout.ts';

type Role = TouchButton | 'move' | 'look';

const LABELS: Record<TouchButton, { label: string; title: string }> = {
  fire: { label: '✹', title: 'Fuoco' },
  aim: { label: '◎', title: 'Mirino' },
  jump: { label: '⤒', title: 'Salta' },
  crouch: { label: '⤓', title: 'Giù' },
  reload: { label: '⟳', title: 'Ricarica' },
  grenade: { label: '●', title: 'Granata' },
  weapon: { label: '⇄', title: 'Arma (tieni premuto: quella di prima)' },
  score: { label: '☰', title: 'Punteggi' },
  pause: { label: '❚❚', title: 'Menu' },
  chat: { label: '💬', title: 'Chat' },
  respawn: { label: '↺', title: 'Ricomincia' },
};

interface Finger {
  role: Role;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  startTime: number;
  /** Il dito partito da un tasto si è spostato abbastanza: ora muove anche la visuale. */
  looking: boolean;
}

export class TouchControls {
  readonly root: HTMLElement;
  /** Moltiplicatore della velocità della visuale (impostazioni). */
  sensitivity = 1;
  /** Rallentamento dell'automira vicino a un nemico (1 = nessuno), deciso a ogni fotogramma. */
  friction = 1;

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

  /** Rotazione della visuale in radianti (sensibilità già applicata; lo zoom lo applica Input). */
  onLook: (dx: number, dy: number) => void = () => {};
  onPause: () => void = () => {};
  onChat: () => void = () => {};
  /** Usato il touch (per mostrare i suoi comandi). */
  onActivity: () => void = () => {};

  private readonly fingers = new Map<number, Finger>();
  private lastLook = -Infinity;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<TouchButton, HTMLElement>();
  private layout: TouchLayout = defaultTouchLayout();
  private online = false;

  // Editor della disposizione.
  private editing = false;
  private editor: HTMLElement | null = null;
  private selected: TouchButton | null = null;
  private onEditDone: (layout: TouchLayout) => void = () => {};

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
    for (const [role, info] of Object.entries(LABELS) as [TouchButton, { label: string; title: string }][]) {
      const button = document.createElement('div');
      button.className = `tbtn tbtn-${role}`;
      button.dataset.role = role;
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', info.title);
      button.textContent = info.label;
      root.append(button);
      this.buttons.set(role, button);
    }
    parent.append(root);
    this.root = root;
    root.addEventListener('pointerdown', this.handleDown);
    root.addEventListener('pointermove', this.handleMove);
    root.addEventListener('pointerup', this.handleUp);
    root.addEventListener('pointercancel', this.handleUp);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.applyLayout();
  }

  /** Disposizione e trasparenza dei tasti (dalle impostazioni). */
  setLayout(layout: TouchLayout, opacity: number): void {
    this.layout = layout;
    this.root.style.setProperty('--touch-opacity', String(opacity));
    this.applyLayout();
  }

  /** Mostra o nasconde i comandi; online c'è la chat, in allenamento il tasto per ricominciare. */
  setVisible(visible: boolean, online: boolean): void {
    this.online = online;
    if (this.editing) return;
    this.root.hidden = !visible;
    this.buttons.get('chat')!.hidden = !online;
    this.buttons.get('respawn')!.hidden = online;
    if (!visible) this.releaseAll();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Un dito sta muovendo la visuale proprio ora (per l'automira). */
  get looking(): boolean {
    return performance.now() - this.lastLook < TOUCH.lookingWindowMs;
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

  // -------------------------------------------------------------------------------------------
  // Editor della disposizione
  // -------------------------------------------------------------------------------------------

  /** Apre l'editor: si trascinano i tasti; «Fatto» restituisce la nuova disposizione. */
  edit(onDone: (layout: TouchLayout) => void): void {
    this.releaseAll();
    this.editing = true;
    this.onEditDone = onDone;
    this.root.hidden = false;
    this.root.classList.add('editing');
    for (const button of this.buttons.values()) button.hidden = false;
    this.buttons.get(this.online ? 'respawn' : 'chat')!.hidden = true;
    const editor = document.createElement('div');
    editor.className = 'touch-editor';
    editor.innerHTML = `
      <p>Trascina i tasti dove ti comodano. Tocca un tasto per cambiarne la dimensione.</p>
      <label><span id="touch-size-label">Dimensione</span>
        <input id="touch-size" type="range" min="${TOUCH.buttonMin}" max="${TOUCH.buttonMax}" step="2" disabled /></label>
      <div class="touch-editor-buttons">
        <button type="button" data-act="reset">Ripristina</button>
        <button type="button" data-act="done" class="primary">Fatto</button>
      </div>`;
    editor.addEventListener('pointerdown', (e) => e.stopPropagation());
    const size = editor.querySelector<HTMLInputElement>('#touch-size')!;
    size.addEventListener('input', () => {
      if (!this.selected) return;
      this.layout[this.selected].size = Number(size.value);
      this.applyLayout();
    });
    editor.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
      this.layout = defaultTouchLayout();
      this.select(this.selected);
      this.applyLayout();
    });
    editor.querySelector('[data-act="done"]')!.addEventListener('click', () => this.finishEditing());
    this.root.append(editor);
    this.editor = editor;
    this.select(null);
  }

  get isEditing(): boolean {
    return this.editing;
  }

  private finishEditing(): void {
    this.editing = false;
    this.editor?.remove();
    this.editor = null;
    this.root.classList.remove('editing');
    for (const button of this.buttons.values()) button.classList.remove('selected');
    this.root.hidden = true;
    this.onEditDone(this.layout);
  }

  private select(button: TouchButton | null): void {
    this.selected = button;
    for (const [role, element] of this.buttons) element.classList.toggle('selected', role === button);
    const size = this.editor?.querySelector<HTMLInputElement>('#touch-size');
    const label = this.editor?.querySelector('#touch-size-label');
    if (!size || !label) return;
    size.disabled = button === null;
    if (button) {
      size.value = String(this.layout[button].size);
      label.textContent = `Dimensione: ${LABELS[button].title.split(' (')[0]}`;
    } else {
      label.textContent = 'Dimensione (tocca un tasto)';
    }
  }

  private applyLayout(): void {
    for (const [role, element] of this.buttons) {
      const place = this.layout[role];
      element.style.left = `calc(${(place.x * 100).toFixed(2)}% - ${place.size / 2}px)`;
      element.style.top = `calc(${(place.y * 100).toFixed(2)}% - ${place.size / 2}px)`;
      element.style.width = `${place.size}px`;
      element.style.height = `${place.size}px`;
      element.style.fontSize = `${Math.round(place.size * 0.36)}px`;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Dita
  // -------------------------------------------------------------------------------------------

  private roleAt(event: PointerEvent): Role {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.tbtn');
    if (button?.dataset.role) return button.dataset.role as TouchButton;
    return event.clientX < window.innerWidth * TOUCH.moveZone ? 'move' : 'look';
  }

  private readonly handleDown = (event: PointerEvent): void => {
    event.preventDefault();
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
      lastTime: event.timeStamp,
      startTime: performance.now(),
      looking: role === 'look',
    });
    if (this.editing) {
      if (role !== 'move' && role !== 'look') this.select(role);
      return;
    }
    this.onActivity();
    if (role !== 'move' && role !== 'look') this.buttons.get(role)?.classList.add('down');
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
    if (this.editing) {
      if (finger.role !== 'move' && finger.role !== 'look') {
        const place = this.layout[finger.role];
        place.x = Math.min(1, Math.max(0, event.clientX / window.innerWidth));
        place.y = Math.min(1, Math.max(0, event.clientY / window.innerHeight));
        this.applyLayout();
      }
      return;
    }
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
    } else {
      if (!finger.looking && LOOK_BUTTONS.has(finger.role as TouchButton)) {
        finger.looking = Math.hypot(event.clientX - finger.startX, event.clientY - finger.startY) >= TOUCH.lookFromButton;
      }
      if (finger.looking) {
        const dx = event.clientX - finger.lastX;
        const dy = event.clientY - finger.lastY;
        const speed = Math.hypot(dx, dy) / Math.max(1, event.timeStamp - finger.lastTime);
        const scale = TOUCH.lookRadiansPerPixel * this.sensitivity * lookGain(speed) * this.friction;
        this.onLook(dx * scale, dy * scale);
        this.lastLook = event.timeStamp;
      }
    }
    finger.lastX = event.clientX;
    finger.lastY = event.clientY;
    finger.lastTime = event.timeStamp;
  };

  private readonly handleUp = (event: PointerEvent): void => {
    const finger = this.fingers.get(event.pointerId);
    if (!finger) return;
    this.fingers.delete(event.pointerId);
    if (this.editing) return;
    if (finger.role !== 'move' && finger.role !== 'look') this.buttons.get(finger.role)?.classList.remove('down');
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
        // Trascinato per guardare: niente cambio d'arma.
        if (finger.looking) break;
        if ((performance.now() - finger.startTime) / 1000 >= TOUCH.longPress) this.lastWeaponLatch = true;
        else this.nextWeaponLatch = true;
        break;
      // Pausa e chat al rilascio: per il browser il rilascio di un tocco è un gesto dell'utente (serve
      // ad aprire la tastiera del telefono), la pressione no.
      case 'pause':
        if (event.type === 'pointerup') {
          this.swallowNextClick();
          this.onPause();
        }
        break;
      case 'chat':
        if (event.type === 'pointerup') this.onChat();
        break;
      default:
        break;
    }
  };

  /** Il tocco sulla pausa genera poi un clic: il menu appena aperto non deve riceverlo. */
  private swallowNextClick(): void {
    const until = performance.now() + TOUCH.clickGuardMs;
    const guard = (event: MouseEvent) => {
      window.removeEventListener('click', guard, true);
      if (performance.now() <= until) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('click', guard, true);
    window.setTimeout(() => window.removeEventListener('click', guard, true), TOUCH.clickGuardMs);
  }
}
