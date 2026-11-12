import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { MapData } from '@blockstrike/shared';
import { RENDER } from '../config.ts';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;
    vec3 color = h >= 0.0
      ? mix(horizonColor, topColor, pow(h, 0.6))
      : mix(horizonColor, bottomColor, pow(-h, 0.35));
    float sun = max(dot(dir, sunDirection), 0.0);
    color += sunColor * (pow(sun, 800.0) * 2.5 + pow(sun, 10.0) * 0.15);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Cielo a gradiente con il sole. Segue la telecamera e viene disegnato per primo. */
export function createSky(map: MapData): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      topColor: { value: new Color(map.sky.top) },
      horizonColor: { value: new Color(map.sky.horizon) },
      bottomColor: { value: new Color(map.sky.bottom) },
      // La mappa indica dove viaggia la luce: il sole sta dalla parte opposta.
      sunDirection: { value: new Vector3(...map.sun.direction).normalize().negate() },
      sunColor: { value: new Color(map.sun.color) },
    },
    vertexShader,
    fragmentShader,
    side: BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const sky = new Mesh(new SphereGeometry(1, 32, 16), material);
  sky.scale.setScalar(RENDER.skyRadius);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
