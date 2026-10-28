import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
} from "three";

/**
 * One GPU particle pool for every dust / spark effect. Motion is computed
 * entirely in the vertex shader from spawn parameters, so the CPU only writes
 * when particles are born.
 *
 * mode 0 — ballistic dust: start + vel·t + gravity + turbulence
 * mode 1 — converge: eases from start to target (vec = target)
 */
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uGravity;
  uniform float uTurb;
  attribute vec3 aStart;
  attribute vec3 aVec;
  attribute vec4 aParams; // birth, life, seed, mode
  attribute float aSize;
  varying float vAlpha;
  varying float vHeat;

  void main() {
    float age = uTime - aParams.x;
    float life = aParams.y;
    if (age < 0.0 || age > life || life <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }
    float u = age / life;
    float seed = aParams.z;
    vec3 p;
    float a;
    if (aParams.w < 0.5) {
      vec3 swirl = vec3(
        sin(age * 1.3 + seed * 31.0) + 0.5 * sin(age * 2.9 + seed * 7.0),
        cos(age * 1.1 + seed * 23.0) + 0.4 * sin(age * 2.3 + seed * 13.0),
        sin(age * 0.9 + seed * 11.0));
      p = aStart + aVec * age + vec3(0.0, -0.5 * uGravity * age * age, 0.0) + swirl * uTurb * age * 14.0;
      a = (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.03, u);
      vHeat = pow(1.0 - u, 6.0);
    } else {
      float e = u < 0.5 ? 4.0 * u * u * u : 1.0 - pow(-2.0 * u + 2.0, 3.0) * 0.5;
      vec3 swirl = vec3(sin(seed * 40.0 + age * 2.0), cos(seed * 33.0 + age * 1.7), sin(seed * 21.0 + age)) * (1.0 - e);
      p = mix(aStart, aVec, e) + swirl * (20.0 + uTurb * 60.0);
      a = smoothstep(0.0, 0.3, u) * (1.0 - smoothstep(0.82, 1.0, u));
      vHeat = smoothstep(0.6, 0.95, u) * 0.8;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSize * uScale / max(1.0, -mv.z);
    if (size < 1.5) { a *= size / 1.5; size = 1.5; }
    gl_PointSize = size;
    vAlpha = a;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uIntensity;
  varying float vAlpha;
  varying float vHeat;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(uIntensity * (1.0 + vHeat * 1.5)), a);
  }
`;

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  birth: number;
  life: number;
  size: number;
  mode: 0 | 1;
}

export class ParticleSystem {
  readonly points: Points;
  readonly material: ShaderMaterial;
  private readonly capacity: number;
  private readonly start: Float32Array;
  private readonly vec: Float32Array;
  private readonly params: Float32Array;
  private readonly size: Float32Array;
  private readonly attrs: BufferAttribute[];
  private cursor = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;

  constructor(capacity = 160_000) {
    this.capacity = capacity;
    this.start = new Float32Array(capacity * 3);
    this.vec = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    const geo = new BufferGeometry();
    const mk = (arr: Float32Array, n: number) => {
      const a = new BufferAttribute(arr, n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.attrs = [mk(this.start, 3), mk(this.vec, 3), mk(this.params, 4), mk(this.size, 1)];
    geo.setAttribute("position", this.attrs[0]); // required by three; unused by shader
    geo.setAttribute("aStart", this.attrs[0]);
    geo.setAttribute("aVec", this.attrs[1]);
    geo.setAttribute("aParams", this.attrs[2]);
    geo.setAttribute("aSize", this.attrs[3]);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1000 },
        uGravity: { value: 0 },
        uTurb: { value: 0.5 },
        uIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  spawn(p: ParticleSpawn) {
    const i = this.cursor;
    const i3 = i * 3;
    const i4 = i * 4;
    this.start[i3] = p.x;
    this.start[i3 + 1] = p.y;
    this.start[i3 + 2] = p.z;
    this.vec[i3] = p.vx;
    this.vec[i3 + 1] = p.vy;
    this.vec[i3 + 2] = p.vz;
    this.params[i4] = p.birth;
    this.params[i4 + 1] = p.life;
    this.params[i4 + 2] = Math.random();
    this.params[i4 + 3] = p.mode;
    this.size[i] = p.size;
    if (this.dirtyFrom < 0) this.dirtyFrom = i;
    this.dirtyTo = i;
    this.cursor++;
    if (this.cursor >= this.capacity) {
      this.cursor = 0;
      this.wrapped = true;
    }
  }

  /** Upload only the ranges written this frame. */
  flush() {
    if (this.dirtyFrom < 0) return;
    const sizes = [3, 3, 4, 1];
    this.attrs.forEach((attr, j) => {
      const n = sizes[j];
      attr.clearUpdateRanges();
      if (this.wrapped) {
        attr.addUpdateRange(this.dirtyFrom * n, (this.capacity - this.dirtyFrom) * n);
        attr.addUpdateRange(0, (this.dirtyTo + 1) * n);
      } else {
        attr.addUpdateRange(this.dirtyFrom * n, (this.dirtyTo - this.dirtyFrom + 1) * n);
      }
      attr.needsUpdate = true;
    });
    this.dirtyFrom = this.dirtyTo = -1;
    this.wrapped = false;
  }

  /** Kill everything still alive (used on hard resets). */
  clear() {
    this.params.fill(0);
    this.attrs[2].clearUpdateRanges();
    this.attrs[2].needsUpdate = true;
    this.dirtyFrom = this.dirtyTo = -1;
    this.wrapped = false;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
