import { CustomBlending, MaxEquation, OneFactor, ShaderMaterial, Texture, Vector2, Vector4 } from "three";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec4 uRect;       // u0, vTop, u1, vBottom
  uniform vec2 uSpan;       // portion of the word span covered by this quad
  uniform vec2 uBlur;       // blur radius in texture uv
  uniform float uLod;       // mip bias so each blur tap is itself soft
  uniform float uTaps;      // blur taps, 8..32 by radius
  uniform float uOpacity;
  uniform float uIntensity;
  uniform float uDissolve;  // 0 intact .. 1 gone
  uniform float uWipe;      // quill reveal front along the word, > 1.2 = fully written
  uniform float uSeed;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  uniform vec2 uTexSize;    // atlas size in px

  // An explicit, capped mip level: a tilted quad (arrive, scatter) already asks
  // for coarse mips, and adding the blur bias on top used to reach levels where
  // the whole atlas averages to grey, filling the letter's quad with a box.
  float gLod;
  float tap(vec2 uv) {
    // outside the letter's cell is empty paper, not a smear of its edge
    vec2 inside = step(uRect.xy, uv) * step(uv, uRect.zw);
    return textureLod(uMap, uv, gLod).a * inside.x * inside.y;
  }

  void main() {
    vec2 uv = vec2(mix(uRect.x, uRect.z, vUv.x), mix(uRect.w, uRect.y, vUv.y));
    vec2 px = uv * uTexSize;
    float footprint = max(length(dFdx(px)), length(dFdy(px)));
    gLod = clamp(max(log2(max(footprint, 1e-4)), uLod), 0.0, 3.2);
    float a;
    if (uBlur.x > 0.00002) {
      // a Gaussian-weighted Vogel (golden-angle) disc: irregular, so the taps
      // don't line up into ghost copies of the letter; soft mips fill the gaps
      float rot = uSeed * 6.2831853; // one turn per letter: no per-pixel noise or stripes
      float sum = 0.0, wsum = 0.0;
      for (int i = 0; i < 32; i++) {
        if (float(i) >= uTaps) break;
        float r = sqrt((float(i) + 0.5) / uTaps);
        float th = float(i) * 2.3999632 + rot;
        float w = exp(-2.2 * r * r);
        sum += tap(uv + vec2(cos(th), sin(th)) * r * uBlur) * w;
        wsum += w;
      }
      a = sum / wsum;
    } else {
      a = tap(uv);
    }

    float wx = mix(uSpan.x, uSpan.y, vUv.x);
    float glow = 0.0;

    // quill: ink flows in along the word with a ragged, glowing wet edge
    float soft = 0.1;
    float front = uWipe + (noise(vec2(vUv.y * 9.0, uSeed * 3.0)) - 0.5) * 0.05;
    float written = 1.0 - smoothstep(front - soft, front, wx);
    glow += written * (1.0 - written) * 3.0;

    // dissolve: a burning edge sweeps along the word
    float n = noise(vec2(wx * 22.0, vUv.y * 5.0) + uSeed * 7.0) * 0.6
            + noise(vec2(wx * 64.0, vUv.y * 15.0) + uSeed * 3.0) * 0.4;
    float th = wx * 0.65 + n * 0.35;
    float d = uDissolve * 1.1 - 0.05;
    float keep = smoothstep(d, d + 0.012, th);
    glow += (1.0 - smoothstep(d, d + 0.07, th)) * keep * step(0.0005, uDissolve) * 4.0;

    float alpha = a * uOpacity * written * keep;
    if (alpha < 0.002) discard;
    // premultiplied for MAX blending: overlapping letters stay white instead of piling up
    gl_FragColor = vec4(vec3(uIntensity * (1.0 + glow)) * alpha, alpha);
  }
`;

export type LetterMaterial = ShaderMaterial & {
  uniforms: {
    uMap: { value: Texture };
    uRect: { value: Vector4 };
    uSpan: { value: Vector2 };
    uBlur: { value: Vector2 };
    uLod: { value: number };
    uTaps: { value: number };
    uTexSize: { value: Vector2 };
    uOpacity: { value: number };
    uIntensity: { value: number };
    uDissolve: { value: number };
    uWipe: { value: number };
    uSeed: { value: number };
  };
};

export function createLetterMaterial(map: Texture, rect: [number, number, number, number], span: [number, number]): LetterMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uMap: { value: map },
      uRect: { value: new Vector4(...rect) },
      uSpan: { value: new Vector2(...span) },
      uBlur: { value: new Vector2(0, 0) },
      uLod: { value: 0 },
      uTaps: { value: 8 },
      uTexSize: { value: new Vector2(1, 1) },
      uOpacity: { value: 0 },
      uIntensity: { value: 1 },
      uDissolve: { value: 0 },
      uWipe: { value: 2 },
      uSeed: { value: Math.random() * 100 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
  }) as LetterMaterial;
}
