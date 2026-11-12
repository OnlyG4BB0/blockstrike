import { MOVE, playerEyeHeight, type PlayerState } from '@blockstrike/shared';
import { VIEW } from '../config.ts';

/**
 * Effetti solo visivi della telecamera: ammorbidisce gli spostamenti istantanei della
 * simulazione (gradini, accovacciarsi), aggiunge il sobbalzo all'atterraggio, una leggera
 * inclinazione laterale e l'allargamento del campo visivo in velocità.
 */
export class CameraRig {
  /** Altezza degli occhi mostrata, insegue quella della simulazione. */
  private eyeHeight = 0;
  /** Scarto verticale che compensa i salti istantanei di quota e torna a zero. */
  private stepOffset = 0;
  private bounce = 0;
  private bounceVelocity = 0;
  private shake = 0;
  roll = 0;
  fovBoost = 0;
  /** Scossa della visuale (esplosioni, colpi subiti), in radianti. */
  shakePitch = 0;
  shakeYaw = 0;

  reset(state: Readonly<PlayerState>): void {
    this.eyeHeight = playerEyeHeight(state);
    this.stepOffset = 0;
    this.bounce = 0;
    this.bounceVelocity = 0;
    this.roll = 0;
    this.fovBoost = 0;
  }

  /** La simulazione ha spostato i piedi di colpo (gradino, gambe raccolte): la visuale non deve scattare. */
  onStep(delta: number): void {
    this.stepOffset -= delta;
  }

  /** Scossa da 0 a 1 (si somma a quelle in corso). */
  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  onLand(impactSpeed: number): void {
    if (impactSpeed <= VIEW.landingMinSpeed) return;
    const kick = Math.min((impactSpeed - VIEW.landingMinSpeed) * VIEW.landingKick, VIEW.landingMaxKick);
    this.bounceVelocity -= kick;
  }

  update(dt: number, state: Readonly<PlayerState>, dynamicFov: boolean): void {
    const step = Math.min(dt, 0.05);

    // Altezza degli occhi e scarto dei gradini usano la stessa costante: quando le gambe si
    // raccolgono in aria i due effetti si annullano e la visuale resta ferma.
    const follow = 1 - Math.exp(-VIEW.eyeSmoothing * step);
    this.eyeHeight += (playerEyeHeight(state) - this.eyeHeight) * follow;
    this.stepOffset -= this.stepOffset * follow;

    this.bounceVelocity += (-VIEW.springStiffness * this.bounce - VIEW.springDamping * this.bounceVelocity) * step;
    this.bounce += this.bounceVelocity * step;

    const lateral = state.vx * Math.cos(state.yaw) - state.vz * Math.sin(state.yaw);
    let targetRoll = -lateral * VIEW.strafeRollPerSpeed;
    targetRoll = Math.max(-VIEW.maxStrafeRoll, Math.min(VIEW.maxStrafeRoll, targetRoll));
    if (state.sliding) targetRoll += VIEW.slideRoll;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-VIEW.rollSmoothing * step));

    const speed = Math.hypot(state.vx, state.vz);
    const excess = Math.max(0, Math.min(1, (speed - MOVE.runSpeed) / VIEW.fovBoostSpeedRange));
    const targetBoost = dynamicFov ? excess * VIEW.fovBoostMax : 0;
    this.fovBoost += (targetBoost - this.fovBoost) * (1 - Math.exp(-VIEW.fovSmoothing * step));

    this.shake *= Math.exp(-VIEW.shakeDecay * step);
    this.shakePitch = (Math.random() - 0.5) * this.shake * VIEW.shakeAmount;
    this.shakeYaw = (Math.random() - 0.5) * this.shake * VIEW.shakeAmount;
  }

  /** Altezza della telecamera sopra i piedi. */
  get eyeOffset(): number {
    return this.eyeHeight + this.stepOffset + this.bounce;
  }
}
