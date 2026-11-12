import { describe, expect, it } from 'vitest';
import {
  MOVE,
  PLAYER,
  TICK_RATE,
  canFit,
  createPlayerState,
  horizontalSpeed,
  playerHeight,
  simulateTick,
} from '../src/index.ts';
import { FACE_NEG_X, FACE_POS_X, box, input, playerAt, ramp, run, settle, world } from './helpers.ts';

const R = PLAYER.radius;
const SECOND = TICK_RATE;

describe('gravità e salto', () => {
  it('cade e atterra sul pavimento', () => {
    const w = world();
    const p = settle(playerAt(0, 5, 0), w);
    expect(p.y).toBe(0);
    expect(p.grounded).toBe(true);
    expect(p.vy).toBe(0);
  });

  it('il salto arriva a circa 1,25 m', () => {
    const w = world();
    const p = settle(playerAt(0, 0, 0), w);
    simulateTick(p, input({ jump: true }), w);
    let maxY = p.y;
    for (let i = 0; i < SECOND; i++) {
      simulateTick(p, input(), w);
      maxY = Math.max(maxY, p.y);
    }
    const expected = (MOVE.jumpVelocity * MOVE.jumpVelocity) / (2 * MOVE.gravity);
    expect(maxY).toBeGreaterThan(expected - 0.15);
    expect(maxY).toBeLessThan(expected + 0.15);
    expect(p.grounded).toBe(true);
  });

  it('sbatte la testa sul soffitto senza attraversarlo', () => {
    const w = world(box([-3, 2.2, -3], [6, 0.5, 6]));
    const p = settle(playerAt(0, 0, 0), w);
    let maxHead = 0;
    simulateTick(p, input({ jump: true }), w);
    for (let i = 0; i < SECOND; i++) {
      simulateTick(p, input(), w);
      maxHead = Math.max(maxHead, p.y + playerHeight(p));
    }
    expect(maxHead).toBeLessThanOrEqual(2.2 + 1e-9);
  });
});

describe('corsa e muri', () => {
  it('raggiunge la velocità di corsa senza superarla', () => {
    const w = world();
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND * 2, input({ forward: 1 }));
    expect(horizontalSpeed(p)).toBeGreaterThan(MOVE.runSpeed - 0.05);
    expect(horizontalSpeed(p)).toBeLessThanOrEqual(MOVE.runSpeed + 1e-9);
  });

  it('si ferma sulla faccia di un muro', () => {
    const w = world(box([5, 0, -5], [1, 4, 10]));
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND * 3, input({ yaw: FACE_POS_X, forward: 1 }));
    expect(p.x).toBeCloseTo(5 - R, 9);
    expect(p.vx).toBe(0);
  });

  it('non attraversa un muro sottile neanche alla velocità massima', () => {
    const w = world(box([5, 0, -10], [0.05, 10, 20]));
    const p = playerAt(0, 2, 0);
    p.vx = MOVE.maxSpeed;
    run(p, w, SECOND, input({ yaw: FACE_POS_X }));
    expect(p.x).toBeLessThanOrEqual(5 - R + 1e-9);
  });

  it('scorre lungo un muro mantenendo la componente parallela', () => {
    const w = world(box([5, 0, -50], [1, 4, 100]));
    const p = settle(playerAt(4, 0, 0), w);
    // Guarda verso +x e -z insieme: il muro blocca solo la componente x.
    run(p, w, SECOND, input({ yaw: -Math.PI / 4, forward: 1 }));
    expect(p.x).toBeCloseTo(5 - R, 9);
    expect(p.z).toBeLessThan(-3);
  });

  it('non si incastra negli angoli e se ne allontana subito', () => {
    // Angolo formato da due muri: uno a x = 5, uno a z = -5.
    const w = world(box([5, 0, -20], [1, 4, 40]), box([-20, 0, -6], [40, 4, 1]));
    const p = settle(playerAt(0, 0, 0), w);
    run(p, w, SECOND * 2, input({ yaw: -Math.PI / 4, forward: 1 }));
    expect(p.x).toBeCloseTo(5 - R, 9);
    expect(p.z).toBeCloseTo(-5 + R, 9);
    run(p, w, 20, input({ yaw: -Math.PI / 4, forward: -1 }));
    expect(p.x).toBeLessThan(5 - R - 0.5);
    expect(p.z).toBeGreaterThan(-5 + R + 0.5);
  });

  it('esce da un blocco se ci nasce dentro', () => {
    const w = world(box([-1, 0, -1], [2, 1, 2]));
    const p = playerAt(0, 0.2, 0);
    simulateTick(p, input(), w);
    expect(canFit(w, p.x, p.y, p.z, playerHeight(p))).toBe(true);
  });
});

describe('gradini e rampe', () => {
  it('sale automaticamente un gradino basso', () => {
    const w = world(box([3, 0, -5], [30, 0.5, 10]));
    const p = settle(playerAt(0, 0, 0), w);
    let stepped = 0;
    for (let i = 0; i < SECOND; i++) {
      simulateTick(p, input({ yaw: FACE_POS_X, forward: 1 }), w);
      stepped += p.stepDelta;
    }
    expect(p.y).toBe(0.5);
    expect(stepped).toBeCloseTo(0.5, 9);
  });

  it('un gradino alto blocca', () => {
    const w = world(box([3, 0, -5], [3, 0.8, 10]));
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND, input({ yaw: FACE_POS_X, forward: 1 }));
    expect(p.y).toBe(0);
    expect(p.x).toBeCloseTo(3 - R, 9);
  });

  it('sale e scende da una rampa restando a terra', () => {
    // Rampa da x = 2 (quota 0) a x = 12 (quota 4), poi piattaforma a quota 4.
    const w = world(ramp([2, 0, -5], [10, 4, 10], '+x'), box([12, 0, -5], [10, 4, 10]));
    const p = settle(playerAt(0, 0, 0), w);
    let alwaysGrounded = true;
    for (let i = 0; i < SECOND * 3; i++) {
      simulateTick(p, input({ yaw: FACE_POS_X, forward: 1 }), w);
      alwaysGrounded &&= p.grounded;
    }
    expect(alwaysGrounded).toBe(true);
    expect(p.y).toBe(4);
    for (let i = 0; i < SECOND * 3; i++) {
      simulateTick(p, input({ yaw: FACE_NEG_X, forward: 1 }), w);
      alwaysGrounded &&= p.grounded;
    }
    expect(alwaysGrounded).toBe(true);
    expect(p.y).toBe(0);
  });

  it('il retro alto di una rampa è un muro', () => {
    // Rampa che sale verso +x: arrivando da +x si trova la parete verticale alta 3 m.
    const w = world(ramp([2, 0, -5], [6, 3, 10], '+x'));
    const p = run(settle(playerAt(12, 0, 0), w), w, SECOND * 2, input({ yaw: FACE_NEG_X, forward: 1 }));
    expect(p.x).toBeCloseTo(8 + R, 9);
    expect(p.y).toBe(0);
  });

  it('la cima di una rampa nel vuoto lancia verso l\'alto', () => {
    // Rampa che sale da quota 0 a 2,5 in 8 m; oltre la cima c'è il vuoto.
    const w = world(ramp([2, 0, -5], [8, 2.5, 10], '+x'));
    const p = settle(playerAt(-4, 0, 0), w);
    let launchVy = 0;
    let maxY = 0;
    for (let i = 0; i < SECOND * 3; i++) {
      const wasGrounded = p.grounded;
      simulateTick(p, input({ yaw: FACE_POS_X, forward: 1 }), w);
      if (wasGrounded && !p.grounded && launchVy === 0) launchVy = p.vy;
      maxY = Math.max(maxY, p.y);
    }
    // Alla velocità di corsa la rampa restituisce velocità × pendenza.
    expect(launchVy).toBeCloseTo(MOVE.runSpeed * (2.5 / 8), 1);
    const extraHeight = (launchVy * launchVy) / (2 * MOVE.gravity);
    expect(maxY).toBeGreaterThan(2.5 + extraHeight * 0.8);
  });
});

describe('accovacciarsi', () => {
  it('non ci si rialza sotto un soffitto basso, ci si rialza appena fuori', () => {
    const w = world(box([-5, 1.4, -5], [10, 0.6, 10]));
    const p = playerAt(0, 0, 0);
    run(p, w, 30, input({ crouch: true }));
    expect(p.crouched).toBe(true);
    run(p, w, 30, input());
    expect(p.crouched).toBe(true);
    run(p, w, SECOND * 3, input({ yaw: FACE_POS_X, forward: 1 }));
    expect(p.x).toBeGreaterThan(5 + R);
    expect(p.crouched).toBe(false);
  });

  it('raccogliere le gambe in aria fa salire su un blocco più alto del salto', () => {
    const tryClimb = (tuck: boolean): number => {
      const w = world(box([2, 0, -5], [40, 1.6, 10]));
      const p = settle(playerAt(-6, 0, 0), w);
      const go = input({ yaw: FACE_POS_X, forward: 1 });
      while (p.x < -1) simulateTick(p, go, w);
      simulateTick(p, input({ yaw: FACE_POS_X, forward: 1, jump: true }), w);
      run(p, w, SECOND * 2, input({ yaw: FACE_POS_X, forward: 1, crouch: tuck }));
      return p.y;
    };
    expect(tryClimb(false)).toBe(0);
    expect(tryClimb(true)).toBe(1.6);
  });
});

describe('velocità: bunny hop, strafe e scivolata', () => {
  it('saltare appena si tocca terra conserva la velocità', () => {
    const w = world();
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND, input({ forward: 1 }));
    // In aria senza tasti di direzione: nessuna accelerazione, nessun attrito.
    run(p, w, SECOND * 3, input({ jump: true }));
    expect(horizontalSpeed(p)).toBeCloseTo(MOVE.runSpeed, 1);
  });

  it('tenendo avanti e salto da fermi si arriva alla velocità di corsa, non oltre', () => {
    const w = world();
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND * 3, input({ forward: 1, jump: true }));
    expect(horizontalSpeed(p)).toBeGreaterThan(MOVE.runSpeed - 0.5);
    expect(horizontalSpeed(p)).toBeLessThan(MOVE.runSpeed + 0.5);
  });

  it('lo strafe in aria supera nettamente la velocità di corsa', () => {
    const w = world();
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND, input({ forward: 1 }));
    for (let i = 0; i < SECOND * 4; i++) {
      // Strafe a destra con la visuale girata in modo che la spinta sia perpendicolare al moto.
      const speed = horizontalSpeed(p);
      const ux = p.vz / speed;
      const uz = -p.vx / speed;
      simulateTick(p, input({ yaw: Math.atan2(-uz, ux), right: 1, jump: true }), w);
    }
    expect(horizontalSpeed(p)).toBeGreaterThan(MOVE.runSpeed * 1.5);
  });

  it('la scivolata dà una spinta e poi si esaurisce', () => {
    const w = world();
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND, input({ forward: 1 }));
    simulateTick(p, input({ forward: 1, crouch: true }), w);
    expect(p.sliding).toBe(true);
    expect(horizontalSpeed(p)).toBeGreaterThan(MOVE.runSpeed + MOVE.slideBoost - 0.3);
    run(p, w, SECOND * 2, input({ forward: 1, crouch: true }));
    expect(p.sliding).toBe(false);
    expect(horizontalSpeed(p)).toBeLessThanOrEqual(MOVE.crouchSpeed + 1e-6);
  });

  it('la scivolata in discesa accelera', () => {
    // Rampa lunga che scende verso +x (sale verso -x).
    const w = world(ramp([0, 0, -10], [40, 20, 20], '-x'));
    const p = settle(playerAt(2, 20, 0), w);
    run(p, w, 30, input({ yaw: FACE_POS_X, forward: 1 }));
    simulateTick(p, input({ yaw: FACE_POS_X, forward: 1, crouch: true }), w);
    expect(p.sliding).toBe(true);
    const startSpeed = horizontalSpeed(p);
    run(p, w, SECOND, input({ yaw: FACE_POS_X, forward: 1, crouch: true }));
    expect(p.sliding).toBe(true);
    expect(horizontalSpeed(p)).toBeGreaterThan(startSpeed + 3);
  });

  it('atterrare accovacciati in velocità fa scivolare', () => {
    const w = world();
    const p = run(settle(playerAt(0, 0, 0), w), w, SECOND, input({ forward: 1 }));
    simulateTick(p, input({ forward: 1, jump: true }), w);
    let slid = false;
    for (let i = 0; i < SECOND; i++) {
      simulateTick(p, input({ forward: 1, crouch: true }), w);
      slid ||= p.slideStarted;
    }
    expect(slid).toBe(true);
  });
});

describe('determinismo', () => {
  it('stessi input, stesso identico risultato', () => {
    const w = world(
      box([4, 0, -3], [2, 0.5, 6]),
      box([-8, 0, 2], [3, 1.6, 3]),
      ramp([-2, 0, -12], [6, 3, 8], '-z'),
      box([10, 0, -20], [0.2, 4, 40]),
    );
    const simulate = () => {
      const p = createPlayerState();
      p.y = 3;
      let seed = 12345;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      let yaw = 0;
      for (let i = 0; i < SECOND * 20; i++) {
        yaw += (random() - 0.5) * 0.3;
        simulateTick(
          p,
          input({
            yaw,
            pitch: 0,
            forward: random() < 0.8 ? 1 : 0,
            right: random() < 0.2 ? -1 : random() < 0.4 ? 1 : 0,
            jump: random() < 0.3,
            crouch: random() < 0.15,
          }),
          w,
        );
      }
      return p;
    };
    const a = simulate();
    const b = simulate();
    expect(a).toEqual(b);
  });
});
