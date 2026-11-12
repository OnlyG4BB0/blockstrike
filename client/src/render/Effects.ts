import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { createRayHit, raycastWorld, type CollisionWorld, type MapData, type Projectile } from '@blockstrike/shared';
import { EFFECTS } from '../config.ts';
import type { ModelLibrary } from './weaponModels.ts';

interface Tracer {
  active: boolean;
  sx: number;
  sy: number;
  sz: number;
  dx: number;
  dy: number;
  dz: number;
  length: number;
  travelled: number;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  sizeEnd: number;
  gravity: number;
  drag: number;
  floor: number;
  color: Color;
}

interface Casing {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  spin: number;
  life: number;
  floor: number;
}

interface Fireball {
  mesh: Mesh;
  material: MeshBasicMaterial;
  life: number;
  radius: number;
}

export interface BurstOptions {
  count: number;
  color: Color;
  /** Velocità massima (m/s). */
  speed: number;
  life: number;
  size: number;
  sizeEnd?: number;
  gravity?: number;
  drag?: number;
  /** Direzione preferita (normale della superficie); i pezzi partono a ventaglio attorno. */
  nx?: number;
  ny?: number;
  nz?: number;
  /** Quanto la direzione preferita conta rispetto al caso (0-1). */
  bias?: number;
}

/** Texture del foro di proiettile: centro scuro, bordo sfumato. */
function createHoleTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Il browser non supporta il canvas 2D.');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(10,10,10,1)');
  gradient.addColorStop(0.32, 'rgba(18,18,18,0.95)');
  gradient.addColorStop(0.5, 'rgba(40,36,32,0.55)');
  gradient.addColorStop(1, 'rgba(40,36,32,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  return texture;
}

const Z_AXIS = new Vector3(0, 0, 1);

/**
 * Effetti visivi del combattimento. Tutto è a pool di dimensione fissa e disegnato con mesh
 * instanziate: poche chiamate di disegno e nessuna allocazione mentre si gioca.
 */
export class Effects {
  private readonly scene: Scene;
  private readonly world: CollisionWorld;
  private readonly blockColors: Color[];

  private readonly tracers: Tracer[] = [];
  private readonly tracerMesh: InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly particleMesh: InstancedMesh;
  private readonly casings: Casing[] = [];
  private readonly casingMesh: InstancedMesh;
  private readonly decalMesh: InstancedMesh;
  private decalCursor = 0;
  private decalCount = 0;
  private readonly fireballs: Fireball[] = [];
  private readonly worldFlashes: { mesh: Mesh; life: number }[] = [];
  private readonly muzzleLight = new PointLight('#ffcf80', 0, 8, 2);
  private readonly blastLight = new PointLight('#ff9a3c', 0, 18, 2);
  private muzzleLightLife = 0;
  private blastLightLife = 0;
  private readonly projectileMeshes = new Map<number, Mesh>();
  private readonly library: ModelLibrary;
  private readonly projectileMaterial = new MeshLambertMaterial({ vertexColors: true });

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly roll = new Quaternion();
  private readonly scale = new Vector3();
  private readonly direction = new Vector3();
  private readonly color = new Color();
  private readonly rayHit = createRayHit();

  constructor(scene: Scene, world: CollisionWorld, map: MapData, library: ModelLibrary) {
    this.scene = scene;
    this.world = world;
    this.library = library;
    this.blockColors = map.blocks.map((block) => new Color(block.color));

    this.tracerMesh = new InstancedMesh(
      new BoxGeometry(0.025, 0.025, 1),
      new MeshBasicMaterial({ color: '#ffe7a3', transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
      EFFECTS.maxTracers,
    );
    this.particleMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), EFFECTS.maxParticles);
    this.casingMesh = new InstancedMesh(
      new BoxGeometry(0.014, 0.014, 0.04),
      new MeshLambertMaterial({ color: '#d4a64a' }),
      EFFECTS.maxCasings,
    );
    this.decalMesh = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: createHoleTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
      EFFECTS.maxDecals,
    );
    for (const mesh of [this.tracerMesh, this.particleMesh, this.casingMesh, this.decalMesh]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
    }
    // Colori per istanza delle particelle.
    this.particleMesh.setColorAt(0, new Color(1, 1, 1));

    for (let i = 0; i < EFFECTS.maxTracers; i++) {
      this.tracers.push({ active: false, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, length: 0, travelled: 0 });
    }
    for (let i = 0; i < EFFECTS.maxParticles; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0.1,
        sizeEnd: 0,
        gravity: 0,
        drag: 0,
        floor: -Infinity,
        color: new Color(),
      });
    }
    for (let i = 0; i < EFFECTS.maxCasings; i++) {
      this.casings.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: 0, life: 0, floor: 0 });
    }

    // Palla di fuoco a facce piatte, fusione normale: resta arancione anche su sfondi chiari.
    const fireballGeometry = new IcosahedronGeometry(1, 1);
    for (let i = 0; i < EFFECTS.maxFireballs; i++) {
      const material = new MeshBasicMaterial({
        color: '#ffb347',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new Mesh(fireballGeometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.fireballs.push({ mesh, material, life: 0, radius: 1 });
    }

    // Fiammate delle armi degli altri: piani incrociati.
    const flashMaterial = new MeshBasicMaterial({
      color: '#ffd27a',
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const flashGeometry = new PlaneGeometry(0.3, 0.3);
    for (let i = 0; i < 12; i++) {
      const mesh = new Mesh(flashGeometry, flashMaterial);
      const cross = new Mesh(flashGeometry, flashMaterial);
      cross.rotation.y = Math.PI / 2;
      const cross2 = new Mesh(flashGeometry, flashMaterial);
      cross2.rotation.x = Math.PI / 2;
      mesh.add(cross, cross2);
      mesh.visible = false;
      scene.add(mesh);
      this.worldFlashes.push({ mesh, life: 0 });
    }

    // Luci sempre presenti (spente quando non servono): aggiungerle durante il gioco
    // obbligherebbe a ricompilare i materiali.
    scene.add(this.muzzleLight, this.blastLight);
  }

  // -------------------------------------------------------------------------------------------
  // Creazione degli effetti
  // -------------------------------------------------------------------------------------------

  tracer(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): void {
    const dx = ex - sx;
    const dy = ey - sy;
    const dz = ez - sz;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1) return;
    const t = this.tracers.find((item) => !item.active);
    if (!t) return;
    t.active = true;
    t.sx = sx;
    t.sy = sy;
    t.sz = sz;
    t.dx = dx / length;
    t.dy = dy / length;
    t.dz = dz / length;
    t.length = length;
    t.travelled = 0;
  }

  /** Segno sul muro (foro di proiettile o bruciatura). */
  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number): void {
    this.position.set(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004);
    this.direction.set(nx, ny, nz);
    this.quaternion.setFromUnitVectors(Z_AXIS, this.direction);
    // Rotazione casuale attorno alla normale: i fori non sembrano tutti uguali.
    this.quaternion.multiply(this.roll.setFromAxisAngle(Z_AXIS, Math.random() * Math.PI * 2));
    const s = size * (0.85 + Math.random() * 0.3);
    this.scale.set(s, s, s);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.decalMesh.setMatrixAt(this.decalCursor, this.matrix);
    this.decalCursor = (this.decalCursor + 1) % EFFECTS.maxDecals;
    this.decalCount = Math.min(EFFECTS.maxDecals, this.decalCount + 1);
    this.decalMesh.count = this.decalCount;
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  burst(x: number, y: number, z: number, options: BurstOptions): void {
    // Un solo raggio verso il basso per tutta l'esplosione di particelle: dove si appoggiano.
    raycastWorld(this.world, x, y + 0.05, z, 0, -1, 0, 30, this.rayHit);
    const floor = this.rayHit.hit ? this.rayHit.y : -Infinity;
    const bias = options.bias ?? 0;
    let spawned = 0;
    for (const p of this.particles) {
      if (spawned >= options.count) break;
      if (p.active) continue;
      spawned++;
      // Direzione: a caso nella sfera, spinta verso la normale.
      let rx = Math.random() * 2 - 1;
      let ry = Math.random() * 2 - 1;
      let rz = Math.random() * 2 - 1;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx = rx / rl + (options.nx ?? 0) * bias * 2;
      ry = ry / rl + (options.ny ?? 0) * bias * 2;
      rz = rz / rl + (options.nz ?? 0) * bias * 2;
      const length = Math.hypot(rx, ry, rz) || 1;
      const speed = options.speed * (0.35 + Math.random() * 0.65);
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = (rx / length) * speed;
      p.vy = (ry / length) * speed;
      p.vz = (rz / length) * speed;
      p.maxLife = options.life * (0.6 + Math.random() * 0.4);
      p.life = p.maxLife;
      p.size = options.size * (0.7 + Math.random() * 0.6);
      p.sizeEnd = options.sizeEnd ?? 0;
      p.gravity = options.gravity ?? 9;
      p.drag = options.drag ?? 1;
      p.floor = floor;
      const shade = 0.8 + Math.random() * 0.35;
      p.color.copy(options.color).multiplyScalar(shade);
    }
  }

  /** Polvere e schegge dove un colpo tocca un blocco, del colore del blocco. */
  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, solid: number): void {
    this.decal(x, y, z, nx, ny, nz, EFFECTS.bulletHoleSize);
    const base = this.blockColors[solid] ?? this.color.set('#999999');
    this.burst(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, {
      count: 7,
      color: base,
      speed: 4,
      life: 0.5,
      size: 0.06,
      gravity: 12,
      nx,
      ny,
      nz,
      bias: 0.6,
    });
    this.burst(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, {
      count: 2,
      color: this.color.set('#fff2b0'),
      speed: 7,
      life: 0.12,
      size: 0.03,
      gravity: 0,
      nx,
      ny,
      nz,
      bias: 0.5,
    });
  }

  /** Colpo su un corpo: per ora solo uno sbuffo rosso (lo splatter arriva nella Fase 5). */
  bodyHit(x: number, y: number, z: number, damage: number): void {
    this.burst(x, y, z, {
      count: Math.min(10, 3 + Math.round(damage / 12)),
      color: this.color.set('#b3121b'),
      speed: 3.5,
      life: 0.45,
      size: 0.07,
      gravity: 14,
    });
  }

  casing(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const c = this.casings.find((item) => !item.active) ?? this.casings[0]!;
    raycastWorld(this.world, x, y, z, 0, -1, 0, 30, this.rayHit);
    c.active = true;
    c.x = x;
    c.y = y;
    c.z = z;
    c.vx = vx;
    c.vy = vy;
    c.vz = vz;
    c.rx = Math.random() * Math.PI;
    c.ry = Math.random() * Math.PI;
    c.spin = 12 + Math.random() * 10;
    c.life = EFFECTS.casingLife;
    c.floor = this.rayHit.hit ? this.rayHit.y + 0.007 : -Infinity;
  }

  /** Fiammata nel mondo (armi degli altri). */
  worldFlash(x: number, y: number, z: number): void {
    const flash = this.worldFlashes.find((item) => item.life <= 0) ?? this.worldFlashes[0]!;
    flash.life = 0.05;
    flash.mesh.position.set(x, y, z);
    flash.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    flash.mesh.scale.setScalar(0.7 + Math.random() * 0.5);
    flash.mesh.visible = true;
  }

  /** Luce della fiammata della propria arma. */
  muzzleLightAt(x: number, y: number, z: number): void {
    this.muzzleLight.position.set(x, y, z);
    this.muzzleLightLife = EFFECTS.muzzleLightTime;
  }

  explosion(x: number, y: number, z: number, radius: number): void {
    const fireball = this.fireballs.find((item) => item.life <= 0) ?? this.fireballs[0]!;
    fireball.life = EFFECTS.fireballTime;
    fireball.radius = radius;
    fireball.mesh.position.set(x, y, z);
    fireball.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    fireball.mesh.visible = true;

    this.blastLight.position.set(x, y + 0.5, z);
    this.blastLightLife = EFFECTS.blastLightTime;

    this.burst(x, y, z, { count: 26, color: this.color.set('#ffb03a'), speed: 13, life: 0.8, size: 0.16, gravity: 16, drag: 1.2 });
    this.burst(x, y, z, { count: 10, color: this.color.set('#fff0a0'), speed: 18, life: 0.35, size: 0.08, gravity: 6 });
    this.burst(x, y + 0.3, z, {
      count: 16,
      color: this.color.set('#4a4744'),
      speed: 3,
      life: 1.8,
      size: 0.35,
      sizeEnd: 0.9,
      gravity: -2.5,
      drag: 1.8,
    });

    // Bruciatura sulla superficie più vicina sotto l'esplosione.
    raycastWorld(this.world, x, y + 0.1, z, 0, -1, 0, 1.5, this.rayHit);
    if (this.rayHit.hit) {
      this.decal(this.rayHit.x, this.rayHit.y, this.rayHit.z, this.rayHit.nx, this.rayHit.ny, this.rayHit.nz, EFFECTS.scorchSize);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Aggiornamento a ogni fotogramma
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.updateTracers(dt);
    this.updateParticles(dt);
    this.updateCasings(dt);

    for (const fireball of this.fireballs) {
      if (fireball.life <= 0) continue;
      fireball.life -= dt;
      const t = 1 - Math.max(0, fireball.life) / EFFECTS.fireballTime;
      fireball.mesh.scale.setScalar(fireball.radius * (0.15 + 0.45 * Math.sqrt(t)));
      fireball.material.opacity = (1 - t * t) * 0.9;
      fireball.material.color.setRGB(1, 0.8 - t * 0.55, 0.3 - t * 0.25);
      if (fireball.life <= 0) fireball.mesh.visible = false;
    }
    for (const flash of this.worldFlashes) {
      if (flash.life <= 0) continue;
      flash.life -= dt;
      if (flash.life <= 0) flash.mesh.visible = false;
    }
    this.muzzleLightLife -= dt;
    this.muzzleLight.intensity = this.muzzleLightLife > 0 ? EFFECTS.muzzleLightIntensity : 0;
    this.blastLightLife -= dt;
    this.blastLight.intensity =
      this.blastLightLife > 0 ? EFFECTS.blastLightIntensity * (this.blastLightLife / EFFECTS.blastLightTime) : 0;
  }

  private updateTracers(dt: number): void {
    let count = 0;
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.travelled += EFFECTS.tracerSpeed * dt;
      const head = Math.min(t.travelled, t.length);
      const tail = Math.max(0, t.travelled - EFFECTS.tracerLength);
      if (tail >= t.length) {
        t.active = false;
        continue;
      }
      const mid = (head + tail) / 2;
      this.position.set(t.sx + t.dx * mid, t.sy + t.dy * mid, t.sz + t.dz * mid);
      this.direction.set(t.dx, t.dy, t.dz);
      this.quaternion.setFromUnitVectors(Z_AXIS, this.direction);
      this.scale.set(1, 1, Math.max(0.01, head - tail));
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.tracerMesh.setMatrixAt(count++, this.matrix);
    }
    this.tracerMesh.count = count;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    let count = 0;
    this.quaternion.identity();
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const t = 1 - p.life / p.maxLife;
      const size = p.sizeEnd > 0 ? p.size + (p.sizeEnd - p.size) * t : p.size * (1 - t * t);
      this.position.set(p.x, p.y, p.z);
      this.scale.set(size, size, size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.particleMesh.setMatrixAt(count, this.matrix);
      this.particleMesh.setColorAt(count, p.color);
      count++;
    }
    this.particleMesh.count = count;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  private updateCasings(dt: number): void {
    let count = 0;
    for (const c of this.casings) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        continue;
      }
      if (c.spin > 0) {
        c.vy -= 18 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.rx += c.spin * dt;
        c.ry += c.spin * 0.6 * dt;
        if (c.y < c.floor) {
          c.y = c.floor;
          c.vy = -c.vy * 0.35;
          c.vx *= 0.5;
          c.vz *= 0.5;
          c.spin *= 0.5;
          if (Math.abs(c.vy) < 0.4) {
            c.spin = 0;
            c.rx = Math.PI / 2;
          }
        }
      }
      this.position.set(c.x, c.y, c.z);
      this.quaternion.setFromAxisAngle(this.direction.set(Math.sin(c.ry), 0, Math.cos(c.ry)), c.rx);
      const shrink = Math.min(1, c.life * 2);
      this.scale.set(shrink, shrink, shrink);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.casingMesh.setMatrixAt(count++, this.matrix);
    }
    this.casingMesh.count = count;
    this.casingMesh.instanceMatrix.needsUpdate = true;
  }

  /** Allinea le mesh di razzi e granate ai proiettili della partita, con interpolazione. */
  syncProjectiles(projectiles: readonly Projectile[], alpha: number, dt: number): void {
    for (let i = 0; i < projectiles.length; i++) {
      const pr = projectiles[i]!;
      let mesh = this.projectileMeshes.get(i);
      if (!pr.active) {
        if (mesh) mesh.visible = false;
        continue;
      }
      const rocket = pr.def.kind === 'rocket';
      if (!mesh || mesh.userData.model !== pr.def.model) {
        if (mesh) this.scene.remove(mesh);
        mesh = new Mesh(this.library.mergedGeometry(pr.def.model), this.projectileMaterial);
        mesh.userData.model = pr.def.model;
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.projectileMeshes.set(i, mesh);
      }
      mesh.visible = true;
      const x = pr.px + (pr.x - pr.px) * alpha;
      const y = pr.py + (pr.y - pr.py) * alpha;
      const z = pr.pz + (pr.z - pr.pz) * alpha;
      mesh.position.set(x, y, z);
      if (rocket) {
        // Orientato lungo la velocità, con una scia di fumo.
        this.direction.set(-pr.vx, -pr.vy, -pr.vz).normalize();
        mesh.quaternion.setFromUnitVectors(Z_AXIS, this.direction);
        if (Math.random() < dt * 60) {
          this.burst(x - (pr.vx / 34) * 0.3, y - (pr.vy / 34) * 0.3, z - (pr.vz / 34) * 0.3, {
            count: 1,
            color: this.color.set('#c9c4bc'),
            speed: 0.6,
            life: 0.7,
            size: 0.1,
            sizeEnd: 0.4,
            gravity: -1,
            drag: 2,
          });
        }
      } else if (!pr.resting) {
        mesh.rotation.x += dt * 9;
        mesh.rotation.z += dt * 5;
      }
    }
  }
}
