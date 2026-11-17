import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  LinearMipmapLinearFilter,
  Points,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
} from "three";

/**
 * A tileable smoke texture, built once on the CPU: R is soft fBm, G is
 * billowy fBm (folded octaves, puffier lobes). Smoke and nebula puffs sample
 * it under a radial falloff with their own random, slowly turning rotation, so
 * a puff a thousand pixels wide on a big display still has fine, wispy detail
 * instead of a magnified blob — and it costs a texture fetch per layer rather
 * than per-pixel procedural noise.
 */
function makeSmokeTexture(size = 256) {
  const hash = (x: number, y: number, s: number) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  // value noise on a lattice that wraps every `period` cells
  const vnoise = (x: number, y: number, period: number, s: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
    const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
    const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x: number, y: number, s: number, billow: boolean) => {
    let sum = 0, amp = 1, norm = 0, period = 4;
    for (let o = 0; o < 6; o++) {
      let n = vnoise((x * period) / size, (y * period) / size, period, s + o * 17);
      if (billow) n = Math.abs(n * 2 - 1);
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      period *= 2;
    }
    return sum / norm;
  };
  const r = new Float32Array(size * size);
  const g = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      r[y * size + x] = fbm(x, y, 1, false);
      g[y * size + x] = fbm(x, y, 7, true);
    }
  // stretch each channel to the full range so contrast behaves the same on both
  const stretch = (ch: Float32Array) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of ch) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const k = 255 / Math.max(1e-6, hi - lo);
    return (i: number) => Math.round((ch[i] - lo) * k);
  };
  const sr = stretch(r), sg = stretch(g);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = sr(i);
    data[i * 4 + 1] = sg(i);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * One GPU particle pool for every dust / spark effect. Motion is computed
 * entirely in the vertex shader from spawn parameters, so the CPU only writes
 * when particles are born.
 *
 * mode 0 — ballistic dust: start + vel·t + gravity + turbulence
 * mode 1 — converge: eases from start to target (vec = target)
 * mode 2 — smoke: a soft puff carried on a draft (vec = velocity), growing as it thins
 * mode 3 — nebula: a soft puff that swirls in from a cloud and condenses on target (vec = target)
 */
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uGravity;
  uniform float uTurb;
  uniform float uSpeckPx; // smoke/nebula puffs smaller than this (device px) fade out; 0 = off
  attribute vec3 aStart;
  attribute vec3 aVec;
  attribute vec4 aParams; // birth, life, seed, mode
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying float vHeat;
  varying float vSoft;
  varying float vSeed;
  varying float vAge;
  varying float vU;
  float grow = 1.0;

  void main() {
    float age = uTime - aParams.x;
    float life = aParams.y;
    if (age < 0.0 || age > life || life <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      vHeat = 0.0;
      vSoft = 0.0;
      vSeed = 0.0;
      vAge = 0.0;
      vU = 0.0;
      return;
    }
    vAge = age;
    float u = age / life;
    vU = u;
    float seed = aParams.z;
    vSeed = seed;
    vec3 p;
    float a;
    vSoft = 0.0;
    if (aParams.w > 2.5) {
      // nebula: a wide, soft cloud that swirls in and condenses into the letters
      float e = 1.0 - pow(1.0 - u, 3.0);
      vec3 swirl = vec3(sin(seed * 40.0 + age * 1.2), cos(seed * 33.0 + age), sin(seed * 21.0 + age * 0.8)) * (1.0 - e);
      p = mix(aStart, aVec, e) + swirl * (30.0 + uTurb * 80.0);
      a = smoothstep(0.0, 0.35, u) * (1.0 - smoothstep(0.55, 1.0, u)) * 0.5;
      vHeat = 0.0;
      vSoft = 1.0;
      grow = mix(10.0, 1.0, e);
    } else if (aParams.w > 1.5) {
      // smoke: carried off on a draft, curling, rising a little, spreading thin
      vec3 curl = vec3(
        sin(age * 0.7 + seed * 31.0) + 0.5 * sin(age * 1.9 + seed * 7.0),
        cos(age * 0.6 + seed * 23.0) + 0.5 * sin(age * 1.6 + seed * 13.0),
        sin(age * 0.5 + seed * 11.0));
      p = aStart + aVec * age + vec3(0.0, 4.0 * age * age, 0.0) + curl * (8.0 + uTurb * 30.0) * age;
      a = smoothstep(0.0, 0.2, u) * pow(1.0 - u, 2.0) * 0.45;
      vHeat = 0.0;
      vSoft = 1.0;
      grow = 1.0 + 5.0 * u;
    } else if (aParams.w < 0.5) {
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
    float size = aSize * grow * uScale / max(1.0, -mv.z);
    // a soft puff only reads as smoke when it's big: small ones fade away rather
    // than show as bright specks (condensing nebula, distant or young smoke)
    if (vSoft > 0.5 && uSpeckPx > 0.5) { float k = smoothstep(uSpeckPx * 0.3, uSpeckPx, size); a *= k * k; }
    if (size < 1.5) { a *= size / 1.5; size = 1.5; }
    gl_PointSize = size;
    vAlpha = a * aAlpha;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uIntensity;
  uniform sampler2D uNoise;
  uniform float uLayers;    // 1..4 texture samples per puff
  uniform float uNoiseAmt;  // 0..1 how much the noise breaks up the puff
  uniform float uContrast;  // 0.5..3 how hard the wisps are
  varying float vAlpha;
  varying float vHeat;
  varying float vSoft;
  varying float vSeed;
  varying float vAge;
  varying float vU;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc);
    float a;
    if (vSoft > 0.5) {
      // smoke and nebula: a radial falloff multiplied through layers of noise
      // texture, each at its own random rotation that turns slowly with age
      float spin = (fract(vSeed * 7.31) - 0.5) * 0.6;
      float ang = vSeed * 6.2832 + vAge * spin;
      float n = 0.0, wsum = 0.0, amp = 1.0, sc = 0.55;
      for (int i = 0; i < 4; i++) {
        if (float(i) >= uLayers) break;
        float fi = float(i);
        float r = ang + fi * 2.39996 * (1.0 + vSeed);
        float c = cos(r), s = sin(r);
        vec2 uv = mat2(c, s, -s, c) * pc * sc + vec2(vSeed * 3.7 + fi * 0.37, vSeed * 5.3 + fi * 0.61);
        vec4 t = texture2D(uNoise, uv);
        n += mix(t.r, t.g, mod(fi, 2.0)) * amp;
        wsum += amp;
        amp *= 0.6;
        sc *= 2.2;
      }
      n /= wsum;
      n = clamp((n - 0.5) * uContrast + 0.5, 0.0, 1.0);
      // the noise eats into the falloff rather than just tinting it, so thin
      // edges get carved away and the puff's outline is the smoke's, not a disc
      float radial = exp(-d * d * 12.0);
      // and more so as it ages: thinning smoke frays into wisps rather than
      // drifting apart as separate balls
      float v = radial - (1.0 - n) * uNoiseAmt * mix(0.7, 1.15, vU);
      a = max(v, 0.0) * smoothstep(0.5, 0.38, d) * (1.0 + uNoiseAmt) * 0.9 * vAlpha;
    } else {
      // sparks and dust: crisp dots
      a = smoothstep(0.5, 0.1, d) * vAlpha;
    }
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
  mode: 0 | 1 | 2 | 3;
  /** Opacity multiplier, default 1. */
  alpha?: number;
}

export class ParticleSystem {
  readonly points: Points;
  readonly material: ShaderMaterial;
  private readonly capacity: number;
  private readonly start: Float32Array;
  private readonly vec: Float32Array;
  private readonly params: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly attrs: BufferAttribute[];
  private cursor = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;
  private readonly noise = makeSmokeTexture();

  constructor(capacity = 160_000) {
    this.capacity = capacity;
    this.start = new Float32Array(capacity * 3);
    this.vec = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    const geo = new BufferGeometry();
    const mk = (arr: Float32Array, n: number) => {
      const a = new BufferAttribute(arr, n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.attrs = [mk(this.start, 3), mk(this.vec, 3), mk(this.params, 4), mk(this.size, 1), mk(this.alpha, 1)];
    geo.setAttribute("position", this.attrs[0]); // required by three; unused by shader
    geo.setAttribute("aStart", this.attrs[0]);
    geo.setAttribute("aVec", this.attrs[1]);
    geo.setAttribute("aParams", this.attrs[2]);
    geo.setAttribute("aSize", this.attrs[3]);
    geo.setAttribute("aAlpha", this.attrs[4]);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1000 },
        uGravity: { value: 0 },
        uTurb: { value: 0.5 },
        uSpeckPx: { value: 0 },
        uIntensity: { value: 1 },
        uNoise: { value: this.noise },
        uLayers: { value: 2 },
        uNoiseAmt: { value: 0.85 },
        uContrast: { value: 1.6 },
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
    this.alpha[i] = p.alpha ?? 1;
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
    const sizes = [3, 3, 4, 1, 1];
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
    this.noise.dispose();
  }
}
