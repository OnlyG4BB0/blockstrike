import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Vector3 } from 'three';

const CORNERS: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

/** Facce del cubo: indici degli angoli in senso antiorario visti da fuori, e normale. */
const FACES: readonly { corners: readonly [number, number, number, number]; normal: readonly [number, number, number] }[] = [
  { corners: [1, 2, 6, 5], normal: [1, 0, 0] },
  { corners: [4, 7, 3, 0], normal: [-1, 0, 0] },
  { corners: [3, 7, 6, 2], normal: [0, 1, 0] },
  { corners: [0, 1, 5, 4], normal: [0, -1, 0] },
  { corners: [4, 5, 6, 7], normal: [0, 0, 1] },
  { corners: [0, 3, 2, 1], normal: [0, 0, -1] },
];

/**
 * Costruisce un modello fatto di box colorati in un'unica geometria (una sola chiamata di disegno).
 * Le facce rivolte verso il basso sono leggermente più scure, per dare volume anche senza luci forti.
 */
export class BoxModelBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly matrix = new Matrix4();
  private readonly rotation = new Matrix4();
  private readonly vertex = new Vector3();
  private readonly normal = new Vector3();
  private readonly color = new Color();

  /**
   * Box centrato in (x, y, z) con dimensioni (w, h, d), ruotato (radianti, ordine XYZ) attorno al centro.
   */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, rx = 0, ry = 0, rz = 0): this {
    this.rotation.makeRotationFromEuler(new Euler(rx, ry, rz));
    this.matrix.copy(this.rotation).setPosition(x, y, z);
    this.color.set(color);
    for (const face of FACES) {
      const base = this.positions.length / 3;
      this.normal.set(face.normal[0], face.normal[1], face.normal[2]).transformDirection(this.rotation);
      const shade = this.normal.y < -0.5 ? 0.7 : 1;
      for (const corner of face.corners) {
        const c = CORNERS[corner]!;
        this.vertex.set((c[0] * w) / 2, (c[1] * h) / 2, (c[2] * d) / 2).applyMatrix4(this.matrix);
        this.positions.push(this.vertex.x, this.vertex.y, this.vertex.z);
        this.normals.push(this.normal.x, this.normal.y, this.normal.z);
        this.colors.push(this.color.r * shade, this.color.g * shade, this.color.b * shade);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** Box di sezione quadrata `thickness` che va dal punto A al punto B (per braccia e simili). */
  between(ax: number, ay: number, az: number, bx: number, by: number, bz: number, thickness: number, color: string): this {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz) || 1e-6;
    // Ruota l'asse -z del box sulla direzione A→B (ordine di rotazione XYZ).
    const ry = Math.asin(Math.max(-1, Math.min(1, -dx / length)));
    const rx = Math.atan2(dy, -dz);
    return this.box((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, thickness, thickness, length, color, rx, ry, 0);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
