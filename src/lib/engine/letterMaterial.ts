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

  float tap(vec2 uv) {
    return texture2D(uMap, clamp(uv, uRect.xy, uRect.zw), uLod).a;
  }

  void main() {
    vec2 uv = vec2(mix(uRect.x, uRect.z, vUv.x), mix(uRect.w, uRect.y, vUv.y));
    float a;
    if (uBlur.x > 0.00002) {
      a = tap(uv) * 0.16;
      for (int i = 0; i < 6; i++) {
        float ang = float(i) * 1.0471976;
        vec2 d = vec2(cos(ang), sin(ang));
        vec2 d2 = vec2(cos(ang + 0.5235988), sin(ang + 0.5235988));
        a += tap(uv + d * uBlur * 0.45) * 0.07;
        a += tap(uv + d2 * uBlur) * 0.07;
      }
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
