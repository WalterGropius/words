import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from "three";

/** Faint motes hanging in a stage light. Fully shader-driven and looping. */
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform vec3 uBox;
  attribute vec4 aSeed;
  varying float vAlpha;
  void main() {
    vec3 drift = vec3(sin(aSeed.w * 6.2831) * 6.0, 4.0 + aSeed.w * 6.0, cos(aSeed.w * 12.0) * 4.0);
    vec3 p = position * uBox + drift * uTime;
    p.x += sin(uTime * 0.2 + aSeed.x * 40.0) * 18.0;
    p.y += cos(uTime * 0.17 + aSeed.y * 40.0) * 14.0;
    p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
    p.z -= uBox.z * 0.35;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = (1.2 + aSeed.z * 3.2) * uScale / max(1.0, -mv.z);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.4 + aSeed.y) + aSeed.x * 50.0);
    vAlpha = (0.15 + 0.85 * aSeed.w) * twinkle;
    if (size < 1.2) { vAlpha *= size / 1.2; size = 1.2; }
    gl_PointSize = size;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uAmount;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * uAmount;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export class Dust {
  readonly points: Points;
  readonly material: ShaderMaterial;

  constructor(count = 700) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() - 0.5;
      pos[i * 3 + 1] = Math.random() - 0.5;
      pos[i * 3 + 2] = Math.random() - 0.5;
      for (let j = 0; j < 4; j++) seed[i * 4 + j] = Math.random();
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new BufferAttribute(seed, 4));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1000 },
        uBox: { value: new Vector3(1, 1, 1) },
        uAmount: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -1;
  }

  /** Positions live in a unit box; the shader stretches it over the viewport. */
  resize(w: number, h: number) {
    (this.material.uniforms.uBox.value as Vector3).set(w * 1.6, h * 1.6, 2400);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
