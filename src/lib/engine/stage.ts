import {
  Group,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { ensureFontLoaded, getFont } from "../fonts";
import type { Settings } from "../settings";
import { WordActor, randomDrift, toLinear, type ActorEnv, type EnterOptions, type ExitOptions } from "./actor";
import { Dust } from "./dust";
import { measureText, rasterizeWord, type FontSpec, type WordGlyphs } from "./glyphs";
import { ParticleSystem } from "./particles";
import { paginate, parseText, type ParsedText } from "./text";

export interface StageInfo {
  cursor: number;
  total: number;
  ended: boolean;
  page: number;
  pages: number;
  blackout: boolean;
  ready: boolean;
}

export interface StageOptions {
  onInfo?: (info: StageInfo) => void;
  /** Lower particle budget / resolution for the small setup preview. */
  preview?: boolean;
}

const CAMERA_DISTANCE = 1200;

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0 },
    uVignette: { value: 0.35 },
    uMaster: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uMaster;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = (vUv - 0.5) * vec2(1.0, 0.85);
      c.rgb *= 1.0 - smoothstep(0.3, 0.85, length(q)) * uVignette;
      float n = hash(vUv * 1000.0 + fract(uTime * 13.0) * 97.0) - 0.5;
      float lum = max(c.r, max(c.g, c.b));
      c.rgb += n * (uGrain + smoothstep(0.0, 0.03, lum) * 1.5 / 255.0);
      // crush the faintest halo so the stage itself stays true black
      c.rgb = clamp((c.rgb - 0.006) / 0.994, 0.0, 1.0) * uMaster;
      gl_FragColor = vec4(c.rgb, 1.0);
    }
  `,
};

interface Slot {
  x: number;
  y: number;
  f: number;
}

/** Settings that change where/how big words are; changing them restarts the show. */
function layoutKey(s: Settings) {
  return [s.mode, s.font, s.italic, s.caps, s.longS, s.size, s.linesAtOnce, s.maxPageLines, s.stanzaBreaks, s.align].join("|");
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly finalPass: ShaderPass;
  private readonly particles: ParticleSystem;
  private readonly dust: Dust;
  private readonly words = new Group();
  private readonly actors = new Set<WordActor>();
  private readonly glyphCache = new Map<string, { g: WordGlyphs; refs: number }>();
  private readonly ro: ResizeObserver;
  private readonly opts: StageOptions;

  private settings: Settings;
  private text = "";
  private font: FontSpec = { family: "serif", italic: false };
  private parsed: ParsedText = { tokens: [], lines: [], lineStanza: [] };
  private pages: number[][] = [];
  private tokenPage: number[] = [];
  private cursor = -1;
  private pageIndex = -1;
  private slots = new Map<number, Slot>();
  private lit = new Map<number, WordActor>();
  private ghosts = new Map<number, WordActor>();
  private current: WordActor | null = null;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private time = 0;
  private last = 0;
  private master = 1;
  private masterTarget = 1;
  private loadToken = 0;
  private ready = false;
  private relayoutTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, settings: Settings, opts: StageOptions = {}) {
    this.canvas = canvas;
    this.settings = settings;
    this.opts = opts;

    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 1);

    this.camera = new PerspectiveCamera(45, 1, 10, 9000);
    this.camera.position.set(0, 0, CAMERA_DISTANCE);

    this.particles = new ParticleSystem(opts.preview ? 60_000 : 200_000);
    this.dust = new Dust(opts.preview ? 260 : 700);
    this.scene.add(this.dust.points, this.words, this.particles.points);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // tight radius: a halo around the letters, never a grey fog over the black
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), settings.glow, 0.05, 0.2);
    // weight the wide mips down so the glow hugs the letters
    this.bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.6, 0.26, 0.09, 0.025];
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();

    this.last = performance.now() / 1000;
    this.renderer.setAnimationLoop(this.tick);
  }

  // ───────────────────────────── public API ─────────────────────────────

  async load(text: string, settings: Settings) {
    const token = ++this.loadToken;
    this.text = text;
    this.settings = settings;
    const def = getFont(settings.font);
    const font = { family: def.family, italic: settings.italic && def.hasItalic };
    await ensureFontLoaded(font.family, font.italic);
    if (token !== this.loadToken || this.disposed) return;
    this.font = font;
    this.hardClear();
    this.parsed = parseText(text, { caps: settings.caps, longS: settings.longS });
    this.pages =
      settings.mode === "word"
        ? []
        : paginate(this.parsed, settings.mode === "line" ? settings.linesAtOnce : settings.maxPageLines, settings.stanzaBreaks);
    this.tokenPage = [];
    this.pages.forEach((lines, p) => lines.forEach((li) => this.parsed.lines[li].forEach((ti) => (this.tokenPage[ti] = p))));
    this.cursor = -1;
    this.pageIndex = -1;
    this.ready = true;
    this.emit();
  }

  /** Live settings; anything affecting layout restarts from black. */
  setSettings(settings: Settings) {
    const restart = layoutKey(settings) !== layoutKey(this.settings);
    this.settings = settings;
    if (restart) void this.load(this.text, settings);
  }

  next() {
    if (!this.ready) return;
    const total = this.parsed.tokens.length;
    if (this.cursor >= total) return;
    this.cursor++;
    if (this.cursor === total) {
      this.curtain();
      this.emit();
      return;
    }
    if (this.settings.mode === "word") {
      this.current?.beginExit(this.exitOptions(), this.env());
      this.current = this.spawnWord(this.cursor, this.enterOptions());
    } else {
      const p = this.tokenPage[this.cursor];
      let delay = 0;
      if (p !== this.pageIndex) {
        if (this.pageIndex >= 0) {
          this.exitPage();
          delay = Math.min(1.4, 0.25 + this.settings.exitDuration * 0.18);
        }
        this.pageIndex = p;
        this.buildPage(p, this.cursor - 1, { ghostDelay: delay, fadeIn: 0.9 });
      }
      this.revealWord(this.cursor, delay);
    }
    this.emit();
  }

  prev() {
    if (!this.ready || this.cursor < 0) return;
    const total = this.parsed.tokens.length;
    const target = this.cursor - 1;
    const quick: EnterOptions = { effect: "fade", duration: 0.45, stagger: 0 };

    if (this.settings.mode === "word") {
      this.current?.fadeTo(0, 0.3, true);
      this.cursor = target;
      this.current = target >= 0 ? this.spawnWord(target, quick) : null;
    } else if (this.cursor < total && target >= 0 && this.tokenPage[target] === this.pageIndex) {
      // un-speak the last word on this page
      this.lit.get(this.cursor)?.fadeTo(0, 0.3, true);
      this.lit.delete(this.cursor);
      if (this.settings.ghost > 0) this.makeGhost(this.cursor, 0.3, 0);
      const back = this.lit.get(target);
      if (back) back.level = 1;
      this.cursor = target;
    } else {
      this.fadeAll(0.35);
      this.cursor = target;
      if (target >= 0) {
        this.pageIndex = this.tokenPage[target];
        this.buildPage(this.pageIndex, target, { ghostDelay: 0, fadeIn: 0.45 });
      } else {
        this.pageIndex = -1;
      }
    }
    this.emit();
  }

  /** Back to black, start of text. */
  reset() {
    this.fadeAll(0.6);
    this.cursor = -1;
    this.pageIndex = -1;
    this.emit();
  }

  toggleBlackout() {
    this.masterTarget = this.masterTarget > 0.5 ? 0 : 1;
    this.emit();
  }

  get info(): StageInfo {
    const total = this.parsed.tokens.length;
    return {
      cursor: this.cursor,
      total,
      ended: total > 0 && this.cursor >= total,
      page: this.pageIndex,
      pages: this.pages.length,
      blackout: this.masterTarget < 0.5,
      ready: this.ready,
    };
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    if (this.relayoutTimer) clearTimeout(this.relayoutTimer);
    this.hardClear();
    this.particles.dispose();
    this.dust.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ───────────────────────────── choreography ─────────────────────────────

  private env(): ActorEnv {
    const mode = this.settings.mode;
    const density = (mode === "word" ? 34 : mode === "line" ? 24 : 16) * (this.opts.preview ? 0.6 : 1);
    return {
      time: this.time,
      settings: this.settings,
      particles: this.particles,
      density,
      sway: mode === "word" ? 1 : 0.12,
    };
  }

  private enterOptions(delay = 0): EnterOptions {
    const s = this.settings;
    return { effect: s.entrance, duration: s.entranceDuration, stagger: s.entranceStagger, delay };
  }

  private exitOptions(delay = 0): ExitOptions {
    const s = this.settings;
    return { effect: s.exit, duration: s.exitDuration, stagger: s.exitStagger, delay };
  }

  private spawnWord(index: number, enter: EnterOptions): WordActor {
    const token = this.parsed.tokens[index];
    const s = this.settings;
    const w = this.width;
    const h = this.height;
    let f = h * 0.13 * s.size;
    let width = measureText(token.text, this.font, f);
    const maxW = w * 0.86;
    if (width > maxW) {
      f *= maxW / width;
      width = maxW;
    }
    const j = s.jitter;
    const room = Math.max(0, (w * 0.94 - width) / 2);
    const x = MathUtils.clamp(rand(-1, 1) * w * 0.16 * j, -room, room);
    const y = rand(-1, 1) * h * 0.12 * j;
    const z = rand(-1, 0.3) * 220 * j;
    const actor = this.makeActor(token.text, f, new Vector3(x - width / 2, y - f * 0.3, z), 1);
    actor.beginEnter(enter, this.env());
    return actor;
  }

  private makeActor(text: string, f: number, origin: Vector3, level: number, phase?: number): WordActor {
    const key = `${this.font.family}|${this.font.italic}|${text}|${f.toFixed(2)}`;
    let entry = this.glyphCache.get(key);
    if (!entry) {
      entry = { g: rasterizeWord(text, this.font, f, this.pixelRatio), refs: 0 };
      entry.g.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.glyphCache.set(key, entry);
    }
    entry.refs++;
    const e = entry;
    const release = () => {
      e.refs--;
      if (e.refs <= 0) {
        e.g.dispose();
        this.glyphCache.delete(key);
      }
    };
    const actor = new WordActor(e.g, release, origin, level, phase);
    this.words.add(actor.group);
    this.actors.add(actor);
    return actor;
  }

  /** Lay out one page (verse modes) and remember each token's slot. */
  private layoutPage(p: number) {
    const s = this.settings;
    const w = this.width;
    const h = this.height;
    const lines = this.pages[p].map((li) => this.parsed.lines[li]);
    const tokens = this.parsed.tokens;
    const lh = 1.48;
    const maxW = w * 0.86;
    const maxH = h * 0.8;
    const f0 = h * (s.mode === "line" ? 0.085 : 0.06) * s.size;

    const widthAt = (ti: number, f: number) => measureText(tokens[ti].text, this.font, f);
    const spaceAt = (f: number) => measureText(" ", this.font, f) * 1.05;
    const lineW = (line: number[], f: number) => line.reduce((acc, ti) => acc + widthAt(ti, f), 0) + spaceAt(f) * (line.length - 1);

    const natural = Math.max(...lines.map((l) => lineW(l, f0)), 1);
    let f = f0 * Math.min(1, maxW / natural, maxH / (lines.length * lh * f0));
    f = Math.max(f, h * 0.022);

    const wrap = (f: number) => {
      const rows: { ids: number[]; indent: number }[] = [];
      const sp = spaceAt(f);
      for (const line of lines) {
        let row: number[] = [];
        let rw = 0;
        let indent = 0;
        for (const ti of line) {
          const tw = widthAt(ti, f);
          if (row.length && rw + sp + tw + indent > maxW) {
            rows.push({ ids: row, indent });
            row = [];
            rw = 0;
            indent = f * 1.2;
          }
          rw += (row.length ? sp : 0) + tw;
          row.push(ti);
        }
        rows.push({ ids: row, indent });
      }
      return rows;
    };

    let rows = wrap(f);
    while (rows.length * lh * f > maxH && f > h * 0.016) {
      f *= 0.93;
      rows = wrap(f);
    }

    const sp = spaceAt(f);
    const rowWidths = rows.map((r) => r.ids.reduce((acc, ti) => acc + widthAt(ti, f), 0) + sp * (r.ids.length - 1) + r.indent);
    const blockW = Math.max(...rowWidths);
    const top = (rows.length * lh * f) / 2 + h * 0.015;
    this.slots.clear();
    rows.forEach((r, i) => {
      const centerY = top - (i + 0.5) * lh * f;
      const baseline = centerY - f * 0.3;
      let x = s.align === "center" ? -rowWidths[i] / 2 + r.indent : -blockW / 2 + r.indent;
      for (const ti of r.ids) {
        this.slots.set(ti, { x, y: baseline, f });
        x += widthAt(ti, f) + sp;
      }
    });
  }

  private pagePhase(ti: number) {
    return ti * 2.39996 + 11;
  }

  private makeGhost(ti: number, fadeIn: number, delay: number) {
    const slot = this.slots.get(ti);
    if (!slot) return;
    const a = this.makeActor(this.parsed.tokens[ti].text, slot.f, new Vector3(slot.x, slot.y, 0), toLinear(this.settings.ghost), this.pagePhase(ti));
    a.showNow();
    a.setFadeNow(0);
    a.fadeTo(1, fadeIn, false, delay);
    this.ghosts.set(ti, a);
  }

  /** Build page p with every token ≤ revealedUpTo already spoken. */
  private buildPage(p: number, revealedUpTo: number, o: { ghostDelay: number; fadeIn: number }) {
    this.layoutPage(p);
    const s = this.settings;
    const ids = this.pages[p].flatMap((li) => this.parsed.lines[li]);
    for (const ti of ids) {
      const slot = this.slots.get(ti)!;
      if (ti <= revealedUpTo) {
        const level = ti === revealedUpTo ? 1 : toLinear(s.spokenLevel);
        const a = this.makeActor(this.parsed.tokens[ti].text, slot.f, new Vector3(slot.x, slot.y, 0), level, this.pagePhase(ti));
        a.showNow();
        if (o.fadeIn > 0) {
          a.setFadeNow(0);
          a.fadeTo(1, o.fadeIn);
        }
        this.lit.set(ti, a);
      } else if (s.ghost > 0) {
        this.makeGhost(ti, o.fadeIn, o.ghostDelay);
      }
    }
  }

  private revealWord(ti: number, delay: number) {
    const s = this.settings;
    const slot = this.slots.get(ti);
    if (!slot) return;
    const prev = this.lit.get(ti - 1);
    if (prev) prev.level = toLinear(s.spokenLevel);
    const a = this.makeActor(this.parsed.tokens[ti].text, slot.f, new Vector3(slot.x, slot.y, 0), 1, this.pagePhase(ti));
    a.beginEnter(this.enterOptions(delay), this.env());
    this.lit.set(ti, a);
    const ghost = this.ghosts.get(ti);
    if (ghost) {
      ghost.fadeTo(0, delay > 0 ? 0.01 : Math.max(0.3, s.entranceDuration * 1.1), true);
      this.ghosts.delete(ti);
    }
  }

  /** Send the whole page off in a reading-order wave. */
  private exitPage() {
    const s = this.settings;
    const spoken = [...this.lit.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    const wave = Math.min(2.4, s.exitDuration * 0.45) * (0.2 + s.exitStagger);
    const env = this.env();
    const drift = randomDrift();
    spoken.forEach((a, k) => a.beginExit({ ...this.exitOptions(spoken.length > 1 ? (k / (spoken.length - 1)) * wave : 0), drift }, env));
    this.ghosts.forEach((g) => g.fadeTo(0, 0.6, true));
    this.lit.clear();
    this.ghosts.clear();
  }

  private curtain() {
    if (this.settings.mode === "word") {
      this.current?.beginExit(this.exitOptions(), this.env());
      this.current = null;
    } else {
      this.exitPage();
      this.pageIndex = -1;
    }
  }

  private fadeAll(seconds: number) {
    for (const a of this.actors) a.fadeTo(0, seconds, true);
    this.lit.clear();
    this.ghosts.clear();
    this.current = null;
  }

  private hardClear() {
    for (const a of this.actors) a.dispose();
    this.actors.clear();
    this.lit.clear();
    this.ghosts.clear();
    this.slots.clear();
    this.current = null;
    this.particles.clear();
  }

  /** Re-flow the current page instantly after a resize. */
  private relayout() {
    if (!this.ready || this.settings.mode === "word" || this.pageIndex < 0) return;
    for (const a of [...this.lit.values(), ...this.ghosts.values()]) {
      a.dispose();
      this.actors.delete(a);
    }
    this.lit.clear();
    this.ghosts.clear();
    this.buildPage(this.pageIndex, this.cursor, { ghostDelay: 0, fadeIn: 0 });
  }

  private emit() {
    this.opts.onInfo?.(this.info);
  }

  // ───────────────────────────── frame loop ─────────────────────────────

  private resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.opts.preview ? 1.5 : 2);
    const changed = Math.abs(w - this.width) > 1 || Math.abs(h - this.height) > 1;
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = MathUtils.radToDeg(2 * Math.atan(h / 2 / CAMERA_DISTANCE));
    this.camera.updateProjectionMatrix();
    this.dust.resize(w, h);
    const scale = pr * CAMERA_DISTANCE;
    this.particles.material.uniforms.uScale.value = scale;
    this.dust.material.uniforms.uScale.value = scale;
    if (changed && this.ready) {
      if (this.relayoutTimer) clearTimeout(this.relayoutTimer);
      this.relayoutTimer = setTimeout(() => this.relayout(), 180);
    }
  }

  private tick = () => {
    const now = performance.now() / 1000;
    const dt = Math.min(1 / 20, Math.max(0, now - this.last));
    this.last = now;
    this.time += dt;
    const s = this.settings;
    const t = this.time;

    // a slow, breathing camera
    const d = s.cameraDrift;
    this.camera.position.set(
      Math.sin(t * 0.071) * this.width * 0.035 * d,
      Math.cos(t * 0.053) * this.height * 0.03 * d,
      CAMERA_DISTANCE + Math.sin(t * 0.041) * 45 * d,
    );
    this.camera.lookAt(0, 0, 0);

    if (s.mode === "word" && s.autoExit > 0 && this.current?.phaseState === "idle" && this.current.idleAge > s.autoExit) {
      this.current.beginExit(this.exitOptions(), this.env());
      this.current = null;
    }

    const env = this.env();
    for (const a of this.actors) {
      a.update(dt, env);
      if (a.dead) {
        a.dispose();
        this.actors.delete(a);
      }
    }

    const pu = this.particles.material.uniforms;
    pu.uTime.value = t;
    pu.uGravity.value = (s.gravity - 0.3) * 60;
    pu.uTurb.value = s.turbulence;
    this.particles.flush();

    const du = this.dust.material.uniforms;
    du.uTime.value = t;
    du.uAmount.value = s.dust * 0.9;
    this.dust.points.visible = s.dust > 0.01;

    this.master += (this.masterTarget - this.master) * (1 - Math.exp(-dt * 3.2));
    this.bloom.strength = s.glow * 0.75;
    this.bloom.enabled = s.glow > 0.01;
    const fu = this.finalPass.uniforms;
    fu.uTime.value = t;
    fu.uGrain.value = s.grain;
    fu.uMaster.value = this.master < 0.002 ? 0 : this.master;

    this.composer.render(dt);
  };
}
