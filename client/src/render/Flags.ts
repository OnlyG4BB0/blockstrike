/**
 * Bandiere di "cattura la bandiera": un'asta, un drappo a blocchi del colore della squadra e una
 * base a terra. La posizione arriva dal server; quella portata segue il portatore come lo si vede.
 */
import { BoxGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import type { FlagSnapshot } from '@blockstrike/shared';
import { TEAMS } from '../config.ts';

interface FlagMesh {
  group: Group;
  base: Mesh;
  cloth: Mesh;
}

/** Misure della bandiera (m). */
const POLE_HEIGHT = 2.2;
const CLOTH = [0.9, 0.55, 0.06] as const;
const BASE = [1.4, 0.1, 1.4] as const;

export class Flags {
  readonly object = new Group();
  private readonly meshes: FlagMesh[] = [];
  private readonly poleGeometry = new BoxGeometry(0.08, POLE_HEIGHT, 0.08);
  private readonly clothGeometry = new BoxGeometry(...CLOTH);
  private readonly baseGeometry = new BoxGeometry(...BASE);
  private readonly poleMaterial = new MeshLambertMaterial({ color: new Color('#d9d4c8') });
  private time = 0;

  /**
   * @param flags stato delle bandiere dal server, nell'ordine delle squadre (prima la 1).
   * @param carrierPoint posizione disegnata del portatore (null se non visibile, per esempio sé stessi).
   */
  update(
    dt: number,
    flags: readonly FlagSnapshot[],
    homes: readonly { team: number; pos: readonly [number, number, number] }[],
    carrierPoint: (id: number) => { x: number; y: number; z: number } | null,
  ): void {
    this.time += dt;
    while (this.meshes.length < flags.length) this.meshes.push(this.create(homes[this.meshes.length]?.team ?? 1));
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i]!;
      const flag = flags[i];
      const home = homes[i];
      mesh.group.visible = flag !== undefined;
      mesh.base.visible = home !== undefined;
      if (home) mesh.base.position.set(home.pos[0], home.pos[1] + BASE[1] / 2, home.pos[2]);
      if (!flag) continue;
      let x = flag.x;
      let y = flag.y;
      let z = flag.z;
      if (flag.state === 1) {
        // Portata: sopra la testa del portatore come lo si vede (o nascosta se si porta da sé).
        const point = carrierPoint(flag.carrier);
        if (!point) {
          mesh.group.visible = false;
          continue;
        }
        x = point.x;
        y = point.y - POLE_HEIGHT * 0.6;
        z = point.z;
      }
      mesh.group.position.set(x, y, z);
      // Il drappo ondeggia un poco.
      mesh.cloth.rotation.y = Math.sin(this.time * 2.4 + i) * 0.25;
    }
  }

  private create(team: number): FlagMesh {
    const color = new Color(TEAMS.colors[team] ?? '#ffffff');
    const group = new Group();
    const pole = new Mesh(this.poleGeometry, this.poleMaterial);
    pole.position.y = POLE_HEIGHT / 2;
    const cloth = new Mesh(this.clothGeometry, new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 }));
    cloth.position.set(CLOTH[0] / 2, POLE_HEIGHT - CLOTH[1] / 2, 0);
    pole.castShadow = true;
    cloth.castShadow = true;
    group.add(pole, cloth);
    const base = new Mesh(this.baseGeometry, new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 }));
    base.receiveShadow = true;
    this.object.add(group, base);
    return { group, base, cloth };
  }
}
