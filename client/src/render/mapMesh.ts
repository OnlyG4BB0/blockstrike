import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial, type Texture } from 'three';
import type { MapBlock, MapData } from '@blockstrike/shared';
import { RENDER } from '../config.ts';

type V3 = readonly [number, number, number];
type UV = readonly [number, number];

/** Accumula triangoli con normali piatte, colori per vertice e coordinate texture. */
class GeometryBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];

  /**
   * Aggiunge un poligono convesso piano (3 o 4 vertici). Se l'ordine dei vertici non è
   * antiorario visto dalla parte della normale, lo inverte: la faccia resta visibile da fuori.
   * Le UV sono in metri e vengono scalate qui.
   */
  polygon(vertices: readonly V3[], uvs: readonly UV[], normal: V3, color: Color): void {
    const [a, b, c] = vertices as [V3, V3, V3];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const facing = (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2];
    const order = vertices.map((_, i) => i);
    if (facing < 0) order.reverse();
    const scale = 1 / RENDER.textureTileSize;
    for (let i = 1; i < order.length - 1; i++) {
      for (const index of [order[0]!, order[i]!, order[i + 1]!]) {
        const vertex = vertices[index]!;
        const uv = uvs[index]!;
        this.positions.push(vertex[0], vertex[1], vertex[2]);
        this.normals.push(normal[0], normal[1], normal[2]);
        this.colors.push(color.r, color.g, color.b);
        this.uvs.push(uv[0] * scale, uv[1] * scale);
      }
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

function addBox(builder: GeometryBuilder, block: MapBlock, color: Color): void {
  const [x0, y0, z0] = block.pos;
  const [w, h, d] = block.size;
  const x1 = x0 + w;
  const y1 = y0 + h;
  const z1 = z0 + d;
  // Le UV partono dall'angolo del blocco: il bordo della texture segue gli spigoli dei blocchi.
  builder.polygon([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[0, 0], [0, h], [d, h], [d, 0]], [1, 0, 0], color);
  builder.polygon([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [[0, 0], [0, h], [d, h], [d, 0]], [-1, 0, 0], color);
  builder.polygon([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [[0, 0], [w, 0], [w, d], [0, d]], [0, 1, 0], color);
  builder.polygon([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[0, 0], [w, 0], [w, d], [0, d]], [0, -1, 0], color);
  builder.polygon([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[0, 0], [w, 0], [w, h], [0, h]], [0, 0, 1], color);
  builder.polygon([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[0, 0], [w, 0], [w, h], [0, h]], [0, 0, -1], color);
}

function addRamp(builder: GeometryBuilder, block: MapBlock, color: Color): void {
  const [x0, y0, z0] = block.pos;
  const [sx, sy, sz] = block.size;
  const dir = block.dir ?? '+x';
  const alongX = dir === '+x' || dir === '-x';
  const rising = dir === '+x' || dir === '+z';
  const length = alongX ? sx : sz;
  const width = alongX ? sz : sx;
  const y1 = y0 + sy;

  // Coordinate locali: a = lungo la salita (0 in basso, length in cima), w = di traverso.
  const point = (a: number, y: number, w: number): V3 => {
    const along = rising ? a : length - a;
    return alongX ? [x0 + along, y, z0 + w] : [x0 + w, y, z0 + along];
  };
  const direction = (na: number, ny: number, nw: number): V3 => {
    const along = rising ? na : -na;
    const n: V3 = alongX ? [along, ny, nw] : [nw, ny, along];
    const len = Math.hypot(n[0], n[1], n[2]);
    return [n[0] / len, n[1] / len, n[2] / len];
  };
  const slopeLength = Math.hypot(length, sy);

  builder.polygon(
    [point(0, y0, 0), point(length, y0, 0), point(length, y0, width), point(0, y0, width)],
    [[0, 0], [length, 0], [length, width], [0, width]],
    direction(0, -1, 0),
    color,
  );
  builder.polygon(
    [point(0, y0, 0), point(length, y1, 0), point(length, y1, width), point(0, y0, width)],
    [[0, 0], [slopeLength, 0], [slopeLength, width], [0, width]],
    direction(-sy, length, 0),
    color,
  );
  builder.polygon(
    [point(length, y0, 0), point(length, y1, 0), point(length, y1, width), point(length, y0, width)],
    [[0, 0], [0, sy], [width, sy], [width, 0]],
    direction(1, 0, 0),
    color,
  );
  builder.polygon(
    [point(0, y0, 0), point(length, y0, 0), point(length, y1, 0)],
    [[0, 0], [length, 0], [length, sy]],
    direction(0, 0, -1),
    color,
  );
  builder.polygon(
    [point(0, y0, width), point(length, y0, width), point(length, y1, width)],
    [[0, 0], [length, 0], [length, sy]],
    direction(0, 0, 1),
    color,
  );
}

/** Geometria di un solo blocco (l'editor ne disegna uno per mesh, per poterli scegliere). */
export function createBlockGeometry(block: MapBlock): BufferGeometry {
  const builder = new GeometryBuilder();
  const color = new Color(block.color);
  if (block.type === 'ramp') addRamp(builder, block, color);
  else addBox(builder, block, color);
  return builder.build();
}

/**
 * Fonde tutti i blocchi statici della mappa in un'unica mesh: una sola chiamata di disegno (più
 * una per l'ombra), qualunque sia il numero di blocchi.
 */
export function createMapMesh(map: MapData, texture: Texture): Mesh {
  const builder = new GeometryBuilder();
  const color = new Color();
  for (const block of map.blocks) {
    color.set(block.color);
    if (block.type === 'ramp') addRamp(builder, block, color);
    else addBox(builder, block, color);
  }
  const material = new MeshLambertMaterial({ vertexColors: true, map: texture });
  const mesh = new Mesh(builder.build(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
