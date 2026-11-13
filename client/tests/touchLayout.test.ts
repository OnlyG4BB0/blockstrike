import { describe, expect, it } from 'vitest';
import { TOUCH } from '../src/config.ts';
import { DEFAULT_TOUCH_LAYOUT, TOUCH_BUTTONS, lookGain, touchLayoutFrom } from '../src/input/touchLayout.ts';

describe('disposizione dei tasti touch', () => {
  it('senza niente di salvato vale quella predefinita, con ogni tasto dentro lo schermo', () => {
    const layout = touchLayoutFrom(undefined);
    expect(layout).toEqual(DEFAULT_TOUCH_LAYOUT);
    for (const button of TOUCH_BUTTONS) {
      const p = layout[button];
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.size).toBeGreaterThanOrEqual(TOUCH.buttonMin);
    }
  });

  it('tiene quello che è valido e corregge o scarta il resto', () => {
    const layout = touchLayoutFrom({
      fire: { x: 0.5, y: 0.5, size: 120 },
      jump: { x: 2, y: -1, size: 999 },
      aim: { x: 'a', y: 0.2, size: 60 },
      sconosciuto: { x: 0.1, y: 0.1, size: 50 },
    });
    expect(layout.fire).toEqual({ x: 0.5, y: 0.5, size: 120 });
    expect(layout.jump).toEqual({ x: 1, y: 0, size: TOUCH.buttonMax });
    expect(layout.aim).toEqual(DEFAULT_TOUCH_LAYOUT.aim);
    expect(Object.keys(layout)).toHaveLength(TOUCH_BUTTONS.length);
  });

  it('la visuale resta precisa con il dito lento e accelera con gli scatti, fino a un massimo', () => {
    expect(lookGain(0.1)).toBe(1);
    expect(lookGain(TOUCH.lookAccelStart)).toBe(1);
    expect(lookGain(1.5)).toBeGreaterThan(1.5);
    expect(lookGain(50)).toBeCloseTo(1 + TOUCH.lookAccelMax);
    expect(lookGain(Number.NaN)).toBe(1);
  });
});
