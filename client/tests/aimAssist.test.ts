import { describe, expect, it } from 'vitest';
import { angleDelta, angularDistance, friction, lookAt, pull } from '../src/game/aimAssist.ts';

describe('automira', () => {
  it('la differenza di angolo passa dalla parte più corta', () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
    expect(angleDelta(0.1, 0.3)).toBeCloseTo(0.2);
  });

  it('la direzione verso un punto usa la stessa convenzione dei comandi (yaw 0 verso -z)', () => {
    const look = lookAt(0, 1.6, 0, 0, 1.6, -10, { yaw: 1, pitch: 1 });
    expect(look.yaw).toBeCloseTo(0);
    expect(look.pitch).toBeCloseTo(0);
    lookAt(0, 1.6, 0, -10, 1.6, 0, look);
    expect(look.yaw).toBeCloseTo(Math.PI / 2);
    lookAt(0, 1.6, 0, 0, 11.6, -10, look);
    expect(look.pitch).toBeCloseTo(Math.PI / 4);
  });

  it('attira verso il bersaglio senza superarlo e senza andare più veloce del limite', () => {
    const target = { yaw: 0.1, pitch: 0 };
    const step = pull(0, 0, target, 7, 1.6, 1 / 60, { yaw: 0, pitch: 0 });
    expect(step.yaw).toBeGreaterThan(0);
    expect(step.yaw).toBeLessThan(0.1);
    expect(Math.hypot(step.yaw, step.pitch)).toBeLessThanOrEqual(1.6 / 60 + 1e-9);
    // In un secondo (60 fotogrammi) il mirino arriva quasi sul bersaglio.
    let yaw = 0;
    for (let i = 0; i < 60; i++) yaw += pull(yaw, 0, target, 7, 1.6, 1 / 60, step).yaw;
    expect(yaw).toBeCloseTo(0.1, 3);
    expect(angularDistance(yaw, 0, target)).toBeLessThan(0.001);
  });

  it('il rallentamento c\'è solo dentro il cono, più forte al centro', () => {
    expect(friction(0.2, 0.14, 0.5)).toBe(1);
    expect(friction(0, 0.14, 0.5)).toBeCloseTo(0.5);
    expect(friction(0.07, 0.14, 0.5)).toBeCloseTo(0.75);
    expect(friction(0, 0.14, 0)).toBe(1);
  });
});
