import { describe, expect, it } from 'vitest';
import {
  BODY_CROUCHED,
  BODY_STANDING,
  BodyPose,
  Match,
  PART_ARM_LEFT,
  PART_ARM_RIGHT,
  PART_COUNT,
  PART_HEAD,
  PART_LEG_LEFT,
  PART_NAMES,
  PART_STRIDE,
  PART_TORSO,
  PLAYER,
  POSE_CENTER,
  TICK_RATE,
  buildGrips,
  createAnimState,
  createBodyHit,
  createPlayerState,
  poseBody,
  poseContains,
  raycastPose,
  resetAnimState,
  type AnimState,
  type BodyPart,
  type Combatant,
  type MapData,
} from '../src/index.ts';
import { gameContent, weaponIndex } from './content.ts';
import { FLOOR } from './helpers.ts';

const SECOND = TICK_RATE;
const grips = buildGrips(gameContent().weapons, gameContent().models);

function testMap(): MapData {
  return {
    version: 1,
    name: 'test',
    killY: -20,
    spawns: [{ pos: [0, 0, 0], yaw: 0 }],
    blocks: [FLOOR],
    waypoints: [],
    sky: { top: '#000000', horizon: '#000000', bottom: '#000000' },
    fog: { color: '#000000', near: 1, far: 2 },
    sun: { direction: [0, -1, 0], color: '#ffffff', intensity: 1 },
    ambient: { sky: '#ffffff', ground: '#ffffff', intensity: 1 },
  };
}

/** Box allineato agli assi che contiene una parte della posa. */
function boundsOf(pose: BodyPose, index: number): { min: number[]; max: number[] } {
  const p = pose.parts;
  const o = index * PART_STRIDE;
  const min: number[] = [];
  const max: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    let extent = 0;
    for (let k = 0; k < 3; k++) extent += Math.abs(p[o + 3 + k * 3 + axis]!) * p[o + 12 + k]!;
    min.push(p[o + axis]! - extent);
    max.push(p[o + axis]! + extent);
  }
  return { min, max };
}

function expectPartMatches(pose: BodyPose, reference: readonly BodyPart[], index: number): void {
  const part = reference.find((r) => r.name === PART_NAMES[index])!;
  const { min, max } = boundsOf(pose, index);
  for (let axis = 0; axis < 3; axis++) {
    expect(min[axis]).toBeCloseTo(part.min[axis]!, 6);
    expect(max[axis]).toBeCloseTo(part.max[axis]!, 6);
  }
}

function idle(crouched: boolean, weapon = -1): AnimState {
  const p = createPlayerState();
  p.crouched = crouched;
  const a = createAnimState();
  resetAnimState(a, p, weapon);
  return a;
}

function centerOf(pose: BodyPose, index: number): [number, number, number] {
  const o = index * PART_STRIDE + POSE_CENTER;
  return [pose.parts[o]!, pose.parts[o + 1]!, pose.parts[o + 2]!];
}

/** Combattente con l'arma indicata, fermo in (0, 0, 0), che guarda verso -z. */
function single(weaponId = 'assault_rifle'): { match: Match; c: Combatant } {
  const match = new Match(testMap(), gameContent(), { seed: 3 });
  match.botMode = 'idle';
  const c = match.addCombatant('Prova', { weapon: weaponIndex(weaponId) });
  c.protection = 0;
  return { match, c };
}

describe('posa del corpo', () => {
  it('da fermi coincide con le hitbox di riferimento, in piedi e accovacciati', () => {
    const pose = new BodyPose();
    poseBody(pose, idle(false), []);
    for (let i = 0; i < PART_COUNT; i++) expectPartMatches(pose, BODY_STANDING, i);
    poseBody(pose, idle(true), []);
    for (let i = 0; i < PART_COUNT; i++) expectPartMatches(pose, BODY_CROUCHED, i);
  });

  it('la testa contiene sempre il punto da cui si guarda, a qualunque inclinazione e in ogni posa', () => {
    const pose = new BodyPose();
    const a = idle(false, weaponIndex('assault_rifle'));
    const limit = (PLAYER.pitchLimit * 180) / Math.PI;
    for (const crouch of [0, 1]) {
      for (const slide of [0, 1]) {
        for (const run of [0, 1]) {
          for (let degrees = -limit; degrees <= limit; degrees += limit / 8) {
            a.crouch = slide ? 1 : crouch;
            a.slide = slide;
            a.run = run;
            a.phase = 1.3;
            a.flinch = 1;
            a.pitch = (degrees * Math.PI) / 180;
            poseBody(pose, a, grips);
            const eye = a.crouch ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
            expect(poseContains(pose, PART_HEAD, 0, eye, 0)).toBe(true);
          }
        }
      }
    }
  });

  it('le braccia seguono la mira in alto e in basso', () => {
    const pose = new BodyPose();
    const a = idle(false, weaponIndex('assault_rifle'));
    a.pitch = (60 * Math.PI) / 180;
    poseBody(pose, a, grips);
    const up = centerOf(pose, PART_ARM_LEFT);
    a.pitch = (-60 * Math.PI) / 180;
    poseBody(pose, a, grips);
    const down = centerOf(pose, PART_ARM_LEFT);
    expect(up[1] - down[1]).toBeGreaterThan(0.2);
    // Un raggio orizzontale all'altezza del braccio alzato lo colpisce solo quando è alzato.
    const hit = createBodyHit();
    a.pitch = (60 * Math.PI) / 180;
    poseBody(pose, a, grips);
    expect(raycastPose(pose, -5, up[1], up[2], 1, 0, 0, 100, hit).part).toBe(PART_ARM_LEFT);
    a.pitch = (-60 * Math.PI) / 180;
    poseBody(pose, a, grips);
    expect(raycastPose(pose, -5, up[1], up[2], 1, 0, 0, 100, hit).part).not.toBe(PART_ARM_LEFT);
  });

  it('in corsa le gambe si alternano', () => {
    const pose = new BodyPose();
    const a = idle(false, weaponIndex('assault_rifle'));
    a.run = 1;
    a.phase = Math.PI / 2;
    poseBody(pose, a, grips);
    const forward = centerOf(pose, PART_LEG_LEFT);
    a.phase = (3 * Math.PI) / 2;
    poseBody(pose, a, grips);
    const back = centerOf(pose, PART_LEG_LEFT);
    // Il corpo guarda verso -z: la gamba sinistra va avanti (z minore) e poi indietro.
    expect(forward[2]).toBeLessThan(-0.15);
    expect(back[2]).toBeGreaterThan(0.15);
    // Un raggio verso il piede in avanti colpisce la gamba solo in quella fase del passo.
    const hit = createBodyHit();
    a.phase = Math.PI / 2;
    poseBody(pose, a, grips);
    expect(raycastPose(pose, forward[0], forward[1], -5, 0, 0, 1, 100, hit).region).toBe('leg');
    a.phase = (3 * Math.PI) / 2;
    poseBody(pose, a, grips);
    const again = raycastPose(pose, forward[0], forward[1], -5, 0, 0, 1, 100, hit);
    expect(again.hit && again.part === PART_LEG_LEFT && again.t < 5 + forward[2] + 0.2).toBe(false);
  });

  it('le braccia che reggono l\'arma davanti al petto non fanno da scudo', () => {
    const pose = new BodyPose();
    const a = idle(false, weaponIndex('assault_rifle'));
    poseBody(pose, a, grips);
    const hit = createBodyHit();
    // Dal davanti (il corpo guarda verso -z), all'altezza delle mani.
    const hand = centerOf(pose, PART_ARM_LEFT);
    raycastPose(pose, hand[0], hand[1], -5, 0, 0, 1, 100, hit);
    expect(hit.part).toBe(PART_TORSO);
    // Il primo punto toccato è il braccio, davanti al busto.
    expect(-5 + hit.t).toBeLessThan(-0.14 - 0.01);
  });

  it('stessi input, stessa posa (deterministica)', () => {
    const run = (): Float64Array[] => {
      const { match, c } = single('smg');
      const poses: Float64Array[] = [];
      for (let i = 0; i < SECOND * 3; i++) {
        c.input.forward = i < SECOND * 2 ? 1 : 0;
        c.input.right = i % 40 < 20 ? 1 : -1;
        c.input.jump = i % 50 === 0;
        c.input.crouch = i > SECOND * 1.5 && i < SECOND * 2.2;
        c.input.fire = i % 30 < 5;
        c.input.pitch = Math.sin(i / 20) * 0.6;
        c.input.yaw = i / 100;
        match.tick();
        poses.push(c.pose.parts.slice());
      }
      return poses;
    };
    expect(run()).toEqual(run());
  });
});

describe('hitbox animate nella partita', () => {
  it('in scivolata la testa si abbassa: un colpo all\'altezza della testa in piedi non è alla testa', () => {
    const { match, c } = single('smg');
    c.input.forward = 1;
    for (let i = 0; i < SECOND; i++) match.tick();
    c.input.crouch = true;
    let sliding = false;
    for (let i = 0; i < 20 && !sliding; i++) {
      match.tick();
      sliding = c.player.sliding;
    }
    expect(sliding).toBe(true);
    for (let i = 0; i < 6; i++) match.tick();
    const p = c.player;
    const hit = createBodyHit();
    // Raggio orizzontale da destra a sinistra all'altezza della testa di chi sta in piedi.
    const standingHead = p.y + 1.63;
    const r1 = raycastPose(c.pose, p.x + 5, standingHead, p.z, -1, 0, 0, 100, hit);
    expect(r1.hit && r1.region === 'head').toBe(false);
    // Alla testa nella posa attuale, invece, sì.
    const head = centerOf(c.pose, PART_HEAD);
    expect(head[1] - p.y).toBeLessThan(1.2);
    expect(raycastPose(c.pose, head[0] + 5, head[1], head[2], -1, 0, 0, 100, hit).region).toBe('head');
  });

  it('un colpo segue la posa: mirare dove era il busto prima di accovacciarsi non colpisce il busto', () => {
    const { match, c } = single('assault_rifle');
    match.tick();
    const before = centerOf(c.pose, PART_TORSO);
    c.input.crouch = true;
    for (let i = 0; i < SECOND / 2; i++) match.tick();
    const hit = createBodyHit();
    const r = raycastPose(c.pose, before[0], before[1] + 0.2, 5, 0, 0, -1, 100, hit);
    expect(r.hit && r.region === 'torso').toBe(false);
    const after = centerOf(c.pose, PART_TORSO);
    expect(raycastPose(c.pose, after[0], after[1], 5, 0, 0, -1, 100, hit).region).toBe('torso');
    expect(c.pose.parts[PART_ARM_RIGHT * PART_STRIDE + 1]).toBeLessThan(before[1] + 0.3);
  });
});
