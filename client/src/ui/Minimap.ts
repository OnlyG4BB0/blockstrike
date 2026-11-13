/**
 * Minimappa (facoltativa): la mappa vista dall'alto con il nord in alto, centrata sul giocatore.
 * I blocchi sono disegnati una volta in un'immagine (più chiari i più alti); sopra, a ogni
 * aggiornamento, il giocatore, i compagni, i nemici che hanno sparato da poco e le bandiere.
 */
import type { MapData } from '@blockstrike/shared';
import { MINIMAP } from '../config.ts';

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
}

/** Pixel per metro dell'immagine della mappa. */
const BASE_SCALE = 4;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly minX: number;
  private readonly minZ: number;
  private timer = 0;

  constructor(canvas: HTMLCanvasElement, map: MapData) {
    this.canvas = canvas;
    canvas.width = MINIMAP.size;
    canvas.height = MINIMAP.size;
    this.context = canvas.getContext('2d')!;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let maxY = 1;
    for (const b of map.blocks) {
      minX = Math.min(minX, b.pos[0]);
      minZ = Math.min(minZ, b.pos[2]);
      maxX = Math.max(maxX, b.pos[0] + b.size[0]);
      maxZ = Math.max(maxZ, b.pos[2] + b.size[2]);
      maxY = Math.max(maxY, b.pos[1] + b.size[1]);
    }
    this.minX = minX;
    this.minZ = minZ;
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil((maxX - minX) * BASE_SCALE);
    this.base.height = Math.ceil((maxZ - minZ) * BASE_SCALE);
    const g = this.base.getContext('2d')!;
    // Dal più basso al più alto: i blocchi alti coprono quelli bassi.
    const blocks = [...map.blocks].sort((a, b) => a.pos[1] + a.size[1] - (b.pos[1] + b.size[1]));
    for (const b of blocks) {
      const top = b.pos[1] + b.size[1];
      const light = Math.max(0, Math.min(1, top / maxY));
      g.fillStyle = b.color;
      g.globalAlpha = 1;
      g.fillRect((b.pos[0] - minX) * BASE_SCALE, (b.pos[2] - minZ) * BASE_SCALE, b.size[0] * BASE_SCALE, b.size[2] * BASE_SCALE);
      g.fillStyle = light > 0.5 ? '#ffffff' : '#000000';
      g.globalAlpha = Math.abs(light - 0.5) * 0.6;
      g.fillRect((b.pos[0] - minX) * BASE_SCALE, (b.pos[2] - minZ) * BASE_SCALE, b.size[0] * BASE_SCALE, b.size[2] * BASE_SCALE);
    }
    g.globalAlpha = 1;
  }

  set visible(value: boolean) {
    this.canvas.hidden = !value;
  }

  /** Ridisegna (al massimo MINIMAP.rate volte al secondo). */
  render(dt: number, x: number, z: number, yaw: number, dots: readonly MinimapDot[]): void {
    if (this.canvas.hidden) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / MINIMAP.rate;
    const g = this.context;
    const size = MINIMAP.size;
    const scale = size / (MINIMAP.range * 2);
    g.save();
    g.clearRect(0, 0, size, size);
    g.fillStyle = 'rgba(12, 16, 24, 0.75)';
    g.fillRect(0, 0, size, size);
    // Mappa: centrata sul giocatore.
    g.globalAlpha = 0.85;
    g.drawImage(
      this.base,
      size / 2 - (x - this.minX) * scale,
      size / 2 - (z - this.minZ) * scale,
      (this.base.width / BASE_SCALE) * scale,
      (this.base.height / BASE_SCALE) * scale,
    );
    g.globalAlpha = 1;
    for (const dot of dots) {
      const px = size / 2 + (dot.x - x) * scale;
      const py = size / 2 + (dot.z - z) * scale;
      if (px < 0 || py < 0 || px > size || py > size) continue;
      g.fillStyle = dot.color;
      g.fillRect(px - 3, py - 3, 6, 6);
    }
    // Il giocatore: un triangolo che punta dove guarda.
    g.translate(size / 2, size / 2);
    g.rotate(-yaw);
    g.fillStyle = '#ffe14d';
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    g.strokeRect(0.5, 0.5, size - 1, size - 1);
  }
}
