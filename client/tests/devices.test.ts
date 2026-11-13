import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  lookRate,
  navDirection,
  nearestInDirection,
  padActivity,
  padLabel,
  padStyleOf,
  toDigital,
} from '../src/input/devices.ts';
import { defaultBindings } from '../src/input/Input.ts';
import { promptHtml, promptLabels, weaponSlotLabels } from '../src/ui/prompts.ts';

const button = (pressed: boolean, value = pressed ? 1 : 0) => ({ pressed, value });

describe('controller', () => {
  it('riconosce il modello dal nome che dà il browser', () => {
    expect(padStyleOf('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padStyleOf('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padStyleOf('DualSense Wireless Controller')).toBe('playstation');
    expect(padStyleOf('Pro Controller (Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(padStyleOf('USB Gamepad (Vendor: 0079 Product: 0006)')).toBe('generic');
  });

  it('mostra i tasti come sono stampati sul controller', () => {
    expect(padLabel('a', 'xbox')).toBe('A');
    expect(padLabel('a', 'playstation')).toBe('✕');
    expect(padLabel('rt', 'playstation')).toBe('R2');
    // Nintendo: il tasto in basso si chiama B.
    expect(padLabel('a', 'nintendo')).toBe('B');
    expect(padLabel('start', 'xbox')).toBe('Menu');
  });

  it('la zona morta ferma il rumore della levetta e riscala il resto', () => {
    const out = { x: 0, y: 0 };
    expect(applyDeadzone(0.1, -0.1, 0.18, out)).toEqual({ x: 0, y: 0 });
    applyDeadzone(1, 0, 0.18, out);
    expect(out.x).toBeCloseTo(1);
    applyDeadzone(0.59, 0, 0.18, out);
    expect(out.x).toBeCloseTo(0.5, 2);
    applyDeadzone(Number.NaN, 0, 0.18, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('la levetta del movimento diventa una delle 8 direzioni (il server vuole -1, 0, 1)', () => {
    expect(toDigital(0.9, 0.35)).toBe(1);
    expect(toDigital(-0.4, 0.35)).toBe(-1);
    expect(toDigital(0.2, 0.35)).toBe(0);
    // In diagonale piena entrambi gli assi superano la soglia.
    const out = applyDeadzone(Math.SQRT1_2, Math.SQRT1_2, 0.18, { x: 0, y: 0 });
    expect([toDigital(out.x, 0.35), toDigital(out.y, 0.35)]).toEqual([1, 1]);
  });

  it('la curva della visuale è fine vicino al centro e piena in fondo', () => {
    expect(lookRate(1, 1.8)).toBeCloseTo(1);
    expect(lookRate(-1, 1.8)).toBeCloseTo(-1);
    expect(Math.abs(lookRate(0.3, 1.8))).toBeLessThan(0.3);
  });

  it('il controller conta come usato solo con un tasto o una levetta spinta davvero', () => {
    const idle = { buttons: [button(false), button(false)], axes: [0.08, -0.1, 0, 0] };
    expect(padActivity(idle, 0.55)).toBe(false);
    expect(padActivity({ ...idle, buttons: [button(true), button(false)] }, 0.55)).toBe(true);
    expect(padActivity({ ...idle, axes: [0.9, 0, 0, 0] }, 0.55)).toBe(true);
  });
});

describe('navigazione del menu con il controller', () => {
  it('direzione dalla croce o dalla levetta', () => {
    expect(navDirection(0, 0, 0.5)).toBeNull();
    expect(navDirection(0.9, 0.2, 0.5)).toBe('right');
    expect(navDirection(0.1, -0.8, 0.5)).toBe('up');
  });

  it('sceglie l\'elemento più vicino nella direzione, preferendo quelli allineati', () => {
    const from = { x: 0, y: 0, w: 100, h: 40 };
    const candidates = [
      { x: 0, y: 60, w: 100, h: 40 }, // sotto
      { x: 300, y: 70, w: 100, h: 40 }, // sotto ma molto di lato
      { x: 150, y: 0, w: 100, h: 40 }, // a destra
    ];
    expect(nearestInDirection(from, candidates, 'down')).toBe(0);
    expect(nearestInDirection(from, candidates, 'right')).toBe(2);
    expect(nearestInDirection(from, candidates, 'up')).toBe(-1);
  });
});

describe('tasti mostrati', () => {
  const keys = defaultBindings();

  it('cambiano con il dispositivo', () => {
    expect(promptLabels('jump', { device: 'keyboard', style: 'generic', keys })).toEqual(['Spazio']);
    expect(promptLabels('jump', { device: 'gamepad', style: 'xbox', keys })).toEqual(['A']);
    expect(promptLabels('jump', { device: 'gamepad', style: 'playstation', keys })).toEqual(['✕']);
    expect(promptLabels('jump', { device: 'touch', style: 'generic', keys })).toEqual(['Salta']);
  });

  it('sulla tastiera seguono i tasti scelti nelle impostazioni', () => {
    const custom = { ...keys, jump: ['KeyF'], scoreboard: ['KeyP'] };
    expect(promptLabels('jump', { device: 'keyboard', style: 'generic', keys: custom })).toEqual(['F']);
    expect(promptLabels('scoreboard', { device: 'keyboard', style: 'generic', keys: custom })).toEqual(['P']);
  });

  it('i tasti delle armi: numeri, croce del controller, niente sul touch', () => {
    expect(weaponSlotLabels(3, { device: 'keyboard', style: 'generic', keys })).toEqual(['1', '2', '3']);
    expect(weaponSlotLabels(3, { device: 'gamepad', style: 'xbox', keys })).toEqual(['←', '↑', '→']);
    expect(weaponSlotLabels(3, { device: 'touch', style: 'generic', keys })).toEqual(['', '', '']);
  });

  it('in HTML i tasti hanno la classe del dispositivo e il testo è protetto', () => {
    expect(promptHtml('jump', { device: 'gamepad', style: 'xbox', keys })).toContain('class="prompt pad xb-a"');
    expect(promptHtml('jump', { device: 'keyboard', style: 'generic', keys: { ...keys, jump: ['<b>'] } })).not.toContain('<b>');
  });
});
