import { Group, Mesh, PlaneGeometry, Vector3 } from "three";
import type { Entrance, Exit, Settings } from "../settings";
import { sampleLetter, type LetterGlyph, type WordGlyphs } from "./glyphs";
import { createLetterMaterial, type LetterMaterial } from "./letterMaterial";
import type { ParticleSystem } from "./particles";

const QUAD = new PlaneGeometry(1, 1);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const randomDrift = () => new Vector3(rand(-30, 30), rand(12, 40), -rand(170, 280));

/** Perceptual brightness (0..1) → linear light. */
export const toLinear = (v: number) => Math.pow(clamp01(v), 2.2);

export interface ActorEnv {
  time: number;
  settings: Settings;
  particles: ParticleSystem;
  /** Particle density: samples per em. */
  density: number;
  /** Word-level sway amount (big in word mode, tiny on a page). */
  sway: number;
}

interface Letter {
  mesh: Mesh<PlaneGeometry, LetterMaterial>;
  glyph: LetterGlyph;
  home: Vector3;
  pos: Vector3;
  rot: Vector3;
  scale: number;
  alpha: number;
  blur: number;
  phase: number;
  enterDelay: number;
  // arrive
  from: Vector3;
  fromRot: Vector3;
  // exit
  exitDelay: number;
  exitStarted: boolean;
  alpha0: number;
  start: Vector3;
  startRot: Vector3;
  vel: Vector3;
  angVel: Vector3;
  done: boolean;
}

export interface EnterOptions {
  effect: Entrance;
  duration: number;
  stagger: number;
  delay?: number;
}

export interface ExitOptions {
  effect: Exit;
  duration: number;
  stagger: number;
  delay?: number;
  /** Shared heading for "drift" so a whole line/page recedes as one body. */
  drift?: Vector3;
}

/**
 * One word on stage: a group of letter quads sharing one glyph atlas. Handles
 * its own entrance, idle breathing, brightness, and exit choreography.
 */
export class WordActor {
  readonly group = new Group();
  readonly letters: Letter[];
  readonly glyphs: WordGlyphs;
  readonly fontPx: number;
  readonly origin: Vector3;
  readonly phase: number;

  phaseState: "enter" | "idle" | "exit" | "dead" = "enter";
  /** Time within the current phase; negative while waiting on a delay. */
  t = 0;
  idleAge = 0;

  /** Brightness target / current (linear). */
  level = 1;
  private levelNow = 0;
  /** Extra fade (quick cuts, ghosts) — multiplies everything. */
  private fade = 1;
  private fadeTarget = 1;
  private fadeRate = 0;
  private fadeDelay = 0;
  private killOnFade = false;

  private enter: EnterOptions = { effect: "fade", duration: 1, stagger: 0 };
  private exitOpts: ExitOptions = { effect: "fade", duration: 1, stagger: 0 };
  private enterSpan = 1;
  private letterEnterDur = 1;
  private wipe = 2;
  private dissolve = 0;
  private releaseGlyphs: () => void;

  constructor(glyphs: WordGlyphs, release: () => void, origin: Vector3, level: number, phase = Math.random() * 100) {
    this.glyphs = glyphs;
    this.phase = phase;
    this.releaseGlyphs = release;
    this.fontPx = glyphs.fontPx;
    this.origin = origin.clone();
    this.level = level;
    this.levelNow = level;
    this.letters = glyphs.letters.map((g, i) => {
      const mat = createLetterMaterial(glyphs.texture, g.rect, g.span);
      const mesh = new Mesh(QUAD, mat);
      mesh.frustumCulled = false;
      const home = new Vector3(origin.x + g.centerX, origin.y + g.centerY, origin.z);
      this.group.add(mesh);
      return {
        mesh,
        glyph: g,
        home,
        pos: home.clone(),
        rot: new Vector3(),
        scale: 1,
        alpha: 0,
        blur: 0,
        phase: phase * 7.3 + i * 1.7,
        enterDelay: 0,
        from: home.clone(),
        fromRot: new Vector3(),
        exitDelay: 0,
        exitStarted: false,
        alpha0: 1,
        start: new Vector3(),
        startRot: new Vector3(),
        vel: new Vector3(),
        angVel: new Vector3(),
        done: false,
      };
    });
  }

  get center(): Vector3 {
    return new Vector3(this.origin.x + this.glyphs.width / 2, this.origin.y + this.fontPx * 0.3, this.origin.z);
  }

  // ───────────────────────────── entrance ─────────────────────────────

  beginEnter(opts: EnterOptions, env: ActorEnv) {
    this.enter = opts;
    this.phaseState = "enter";
    this.t = -(opts.delay ?? 0);
    const n = this.letters.length;
    const f = this.fontPx;
    const stagger = opts.effect === "quill" ? 0 : opts.stagger;
    this.enterSpan = stagger * opts.duration * 0.6;
    this.letterEnterDur = Math.max(0.05, opts.duration - this.enterSpan);
    this.wipe = opts.effect === "quill" ? 0 : 2;
    this.letters.forEach((L, i) => {
      L.enterDelay = n > 1 ? (i / (n - 1)) * this.enterSpan : 0;
      L.alpha = 0;
      if (opts.effect === "arrive") {
        L.from.set(
          L.home.x + rand(-1, 1) * f * 3.2,
          L.home.y + rand(-1, 1) * f * 2.2,
          L.home.z - rand(900, 2400),
        );
        L.fromRot.set(rand(-0.9, 0.9), rand(-1.2, 1.2), rand(-0.8, 0.8));
      }
    });
    if (opts.effect === "materialize") this.emitGather(env);
  }

  /** Show instantly (resize / rebuild). */
  showNow() {
    this.phaseState = "idle";
    this.t = 0;
    this.wipe = 2;
    this.letters.forEach((L) => (L.alpha = 1));
  }

  private emitGather(env: ActorEnv) {
    const g = this.glyphs;
    const step = g.emPx / env.density;
    const scale = 1 / g.k;
    const f = this.fontPx;
    const turb = env.settings.turbulence;
    const startAt = env.time + (this.enter.delay ?? 0);
    this.letters.forEach((L, i) => {
      const pts = sampleLetter(g, i, step);
      for (const p of pts) {
        const tx = L.home.x + p.dx;
        const ty = L.home.y + p.dy;
        const tz = L.home.z;
        // random point on a shell around the letter
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(rand(-1, 1));
        const r = f * rand(0.5, 2.2) * (0.5 + turb * 0.8);
        env.particles.spawn({
          x: tx + Math.sin(ph) * Math.cos(th) * r,
          y: ty + Math.sin(ph) * Math.sin(th) * r,
          z: tz + Math.cos(ph) * r * 0.5 + rand(-380, 60),
          vx: tx,
          vy: ty,
          vz: tz,
          birth: startAt + L.enterDelay + rand(0, 0.12),
          life: this.letterEnterDur * rand(0.72, 0.95),
          size: step * scale * rand(0.8, 1.5),
          mode: 1,
        });
      }
    });
  }

  // ─────────────────────────────── exit ───────────────────────────────

  beginExit(opts: ExitOptions, env: ActorEnv) {
    if (this.phaseState === "exit" || this.phaseState === "dead") return;
    // a word that never finished arriving just leaves from where it is
    this.exitOpts = opts;
    this.phaseState = "exit";
    this.t = -(opts.delay ?? 0);
    const n = this.letters.length;
    const span = opts.stagger * Math.min(opts.duration * 0.35, 1.6);
    const order = this.letters.map((_, i) => i);
    if (opts.effect === "fall" || opts.effect === "rise") order.sort(() => Math.random() - 0.5);
    order.forEach((idx, k) => {
      const L = this.letters[idx];
      L.exitDelay = opts.effect === "dissolve" ? 0 : n > 1 ? (k / (n - 1)) * span : 0;
      L.exitStarted = false;
      L.done = false;
    });
    if (opts.effect === "dissolve") this.emitAsh(env);
  }

  /** Quick fade (used for rewinding, resets, ghosts). */
  fadeTo(target: number, seconds: number, kill = false, delay = 0) {
    this.fadeTarget = target;
    this.fadeRate = seconds <= 0 ? Infinity : 1 / seconds;
    this.fadeDelay = delay;
    this.killOnFade = kill;
  }

  setFadeNow(v: number) {
    this.fade = v;
  }

  private emitAsh(env: ActorEnv) {
    const g = this.glyphs;
    const s = env.settings;
    const step = g.emPx / env.density;
    const scale = 1 / g.k;
    const dur = this.exitOpts.duration;
    const sweep = dur * 0.55;
    const delay = this.exitOpts.delay ?? 0;
    const windA = rand(0.05, 0.7);
    const windS = 30 + 70 * s.turbulence;
    const wind = new Vector3(Math.cos(windA) * windS, Math.sin(windA) * windS * (1 - s.gravity), rand(-30, 10));
    const spread = 12 + 40 * s.turbulence;
    const brightness = this.levelNow * this.fade;
    this.letters.forEach((L, i) => {
      const pts = sampleLetter(g, i, step);
      for (const p of pts) {
        const th = p.wx * 0.65 + (0.5 + (Math.random() - 0.5) * 0.7) * 0.35;
        env.particles.spawn({
          x: L.pos.x + p.dx * L.scale,
          y: L.pos.y + p.dy * L.scale,
          z: L.pos.z,
          vx: wind.x + rand(-1, 1) * spread,
          vy: wind.y + rand(-0.6, 1) * spread,
          vz: wind.z + rand(-1, 1) * spread,
          birth: env.time + delay + (sweep * (th + 0.05)) / 1.1,
          life: dur * rand(0.45, 1) + 0.6,
          size: step * scale * rand(0.7, 1.6) * Math.max(0.35, Math.sqrt(brightness)),
          mode: 0,
        });
      }
    });
  }

  // ────────────────────────────── update ──────────────────────────────

  update(dt: number, env: ActorEnv) {
    if (this.phaseState === "dead") return;
    this.t += dt;
    const time = env.time;
    const s = env.settings;
    const f = this.fontPx;

    // brightness + fades
    this.levelNow += (this.level - this.levelNow) * (1 - Math.exp(-dt * 5));
    if (this.fadeDelay > 0) this.fadeDelay -= dt;
    else if (this.fade !== this.fadeTarget) {
      const step = this.fadeRate * dt;
      this.fade = Math.abs(this.fadeTarget - this.fade) <= step ? this.fadeTarget : this.fade + Math.sign(this.fadeTarget - this.fade) * step;
    }
    if (this.killOnFade && this.fade <= 0.0001) {
      this.phaseState = "dead";
      return;
    }

    // idle breathing (the base every effect builds on)
    const b = s.breathing;
    const sway = env.sway;
    const wx = Math.sin(time * 0.31 + this.phase) * f * 0.07 * b * sway;
    const wy = Math.sin(time * 0.47 + this.phase * 1.3) * f * 0.06 * b * sway;
    const wz = Math.sin(time * 0.23 + this.phase * 0.7) * f * 0.5 * b * sway;

    if (this.phaseState === "enter") {
      if (this.t >= this.enterSpan + this.letterEnterDur) {
        this.phaseState = "idle";
        this.idleAge = 0;
        this.wipe = 2;
      }
    } else if (this.phaseState === "idle") {
      this.idleAge += dt;
    }

    let allDone = this.phaseState === "exit";
    const exit = this.exitOpts;
    const turb = s.turbulence;

    for (const L of this.letters) {
      const bx = L.home.x + wx;
      const by = L.home.y + wy + Math.sin(time * 0.9 + L.phase) * f * 0.012 * b;
      const bz = L.home.z + wz;
      const brz = Math.sin(time * 0.6 + L.phase) * 0.014 * b;

      if (this.phaseState === "enter" || this.phaseState === "idle") {
        L.pos.set(bx, by, bz);
        L.rot.set(0, 0, brz);
        L.scale = 1;
        L.blur = 0;
        L.alpha = 1;
        if (this.phaseState === "enter") this.applyEnter(L, bx, by, bz, brz);
        continue;
      }

      // exit
      const tl = this.t - L.exitDelay;
      if (tl < 0) {
        allDone = false;
        continue;
      }
      if (!L.exitStarted) this.startLetterExit(L, env);
      const dur = exit.effect === "fade" ? Math.min(exit.duration * 0.5, 3) : exit.effect === "dissolve" ? exit.duration * 0.6 : exit.duration;
      const u = clamp01(tl / dur);
      if (u >= 1) {
        L.done = true;
        L.alpha = 0;
        continue;
      }
      allDone = false;
      this.applyExit(L, tl, u, f, turb, s.gravity);
      L.alpha *= L.alpha0 + (1 - L.alpha0) * smooth(0, 0.2, u);
      // a departing word steps back so the new one owns the light
      if (exit.effect !== "dissolve") L.alpha *= 1 - 0.32 * smooth(0, 0.12, u);
    }

    if (this.phaseState === "exit") {
      const d = exit.duration * 0.55;
      this.dissolve = exit.effect === "dissolve" ? clamp01(this.t / d) : 0;
      if (allDone) {
        this.phaseState = "dead";
        return;
      }
    }

    if (this.phaseState === "enter" && this.enter.effect === "quill") {
      this.wipe = easeInOutSine(clamp01(this.t / this.enter.duration)) * 1.25 - 0.02;
    }

    this.writeUniforms();
  }

  private applyEnter(L: Letter, bx: number, by: number, bz: number, brz: number) {
    const tl = this.t - L.enterDelay;
    const u = clamp01(tl / this.letterEnterDur);
    const f = this.fontPx;
    switch (this.enter.effect) {
      case "fade": {
        L.alpha = easeInOutSine(u);
        L.blur = (1 - u) * (1 - u) * 0.22;
        L.scale = 1 + 0.07 * Math.pow(1 - u, 2);
        break;
      }
      case "rise": {
        const e = easeOutCubic(u);
        L.pos.y = by - f * 0.5 * (1 - e);
        L.alpha = smooth(0, 0.65, u);
        L.blur = (1 - e) * 0.18;
        break;
      }
      case "arrive": {
        const e = easeOutQuart(u);
        L.pos.set(L.from.x + (bx - L.from.x) * e, L.from.y + (by - L.from.y) * e, L.from.z + (bz - L.from.z) * e);
        L.rot.set(L.fromRot.x * (1 - e), L.fromRot.y * (1 - e), L.fromRot.z * (1 - e) + brz * e);
        L.alpha = smooth(0, 0.35, u);
        L.blur = Math.pow(1 - e, 1.5) * 0.55;
        break;
      }
      case "quill": {
        L.alpha = this.t < 0 ? 0 : 1;
        break;
      }
      case "materialize": {
        L.alpha = smooth(0.55, 1, u);
        L.blur = (1 - u) * 0.3;
        break;
      }
    }
  }

  private startLetterExit(L: Letter, env: ActorEnv) {
    L.exitStarted = true;
    // leave from wherever the letter is, as bright as it was (it may still be arriving)
    L.start.copy(L.pos);
    L.startRot.copy(L.rot);
    L.alpha0 = L.alpha;
    const s = env.settings;
    const turb = s.turbulence;
    const f = this.fontPx;
    switch (this.exitOpts.effect) {
      case "drift": {
        // the word recedes into the dark together, slowly loosening
        const common = this.exitOpts.drift ?? this.driftCommon ?? (this.driftCommon = randomDrift());
        L.vel.set(common.x + rand(-8, 8) * turb, common.y + rand(-6, 10) * turb, common.z + rand(-25, 25) * turb);
        L.angVel.set(rand(-0.12, 0.12) * turb, rand(-0.2, 0.2) * turb, rand(-0.15, 0.15) * turb);
        break;
      }
      case "fall": {
        L.vel.set(rand(-18, 18), rand(-4, 22), rand(-40, 40));
        L.angVel.set(rand(-1.4, 1.4) * turb, rand(-1.1, 1.1) * turb, rand(-1, 1) * (0.25 + turb));
        break;
      }
      case "rise": {
        L.vel.set(rand(-10, 10), rand(10, 40), -rand(20, 120));
        L.angVel.set(rand(-0.6, 0.6) * turb, rand(-0.6, 0.6) * turb, rand(-0.5, 0.5) * turb);
        break;
      }
      case "scatter": {
        const c = this.center;
        const dir = new Vector3(L.start.x - c.x, L.start.y - c.y, 0);
        if (dir.lengthSq() < 1) dir.set(rand(-1, 1), rand(-1, 1), 0);
        dir.normalize();
        dir.x += rand(-0.5, 0.5);
        dir.y += rand(-0.5, 0.5) + 0.15;
        const speed = rand(180, 480) * (0.55 + turb);
        L.vel.set(dir.x * speed, dir.y * speed, rand(-700, 420));
        L.angVel.set(rand(-3, 3), rand(-3, 3), rand(-2.5, 2.5)).multiplyScalar(0.5 + turb);
        break;
      }
      default: {
        L.vel.set(0, f * 0.15, 0);
        L.angVel.set(0, 0, 0);
      }
    }
  }

  private driftCommon: Vector3 | null = null;

  private applyExit(L: Letter, tl: number, u: number, f: number, turb: number, gravity: number) {
    const S = L.start;
    const R = L.startRot;
    switch (this.exitOpts.effect) {
      case "drift": {
        const sw = Math.sin(tl * 0.8 + L.phase) * f * 0.12 * turb * u;
        L.pos.set(S.x + L.vel.x * tl + sw, S.y + L.vel.y * tl + Math.cos(tl * 0.6 + L.phase) * f * 0.05 * turb * u, S.z + L.vel.z * tl);
        L.rot.set(R.x + L.angVel.x * tl, R.y + L.angVel.y * tl, R.z + L.angVel.z * tl);
        L.alpha = 1 - easeInOutSine(u);
        L.blur = u * 0.3;
        L.scale = 1;
        break;
      }
      case "fall": {
        const g = 14 + gravity * 150;
        const sway = Math.sin(tl * 1.5 + L.phase) * f * 0.45 * turb * smooth(0, 0.3, u);
        L.pos.set(S.x + L.vel.x * tl + sway, S.y + L.vel.y * tl - 0.5 * g * tl * tl, S.z + L.vel.z * tl);
        L.rot.set(R.x + L.angVel.x * tl, R.y + L.angVel.y * tl + Math.sin(tl * 1.5 + L.phase) * 0.4 * turb, R.z + L.angVel.z * tl);
        L.alpha = 1 - smooth(0.4, 1, u);
        L.blur = smooth(0.3, 1, u) * 0.18;
        L.scale = 1;
        break;
      }
      case "rise": {
        const a = 8 + gravity * 70;
        const sway = Math.sin(tl * 1.1 + L.phase) * f * 0.6 * turb * u;
        L.pos.set(S.x + L.vel.x * tl + sway, S.y + L.vel.y * tl + 0.5 * a * tl * tl, S.z + L.vel.z * tl);
        L.rot.set(R.x + L.angVel.x * tl, R.y + L.angVel.y * tl, R.z + L.angVel.z * tl);
        L.alpha = 1 - smooth(0.25, 1, u);
        L.blur = u * 0.45;
        L.scale = 1 - 0.25 * u;
        break;
      }
      case "scatter": {
        const k = 1.15;
        const e = (1 - Math.exp(-k * tl)) / k;
        L.pos.set(S.x + L.vel.x * e, S.y + L.vel.y * e - 0.5 * (10 + gravity * 60) * tl * tl * 0.3, S.z + L.vel.z * e);
        L.rot.set(R.x + L.angVel.x * e, R.y + L.angVel.y * e, R.z + L.angVel.z * e);
        L.alpha = 1 - smooth(0.15, 1, u);
        L.blur = Math.min(0.6, Math.abs(L.pos.z) / 1800) + u * 0.15;
        L.scale = 1;
        break;
      }
      case "dissolve": {
        L.pos.copy(S);
        L.rot.copy(R);
        L.alpha = 1;
        L.blur = 0;
        L.scale = 1;
        break;
      }
      default: {
        // fade
        L.pos.set(S.x, S.y + L.vel.y * easeOutCubic(u), S.z);
        L.rot.copy(R);
        L.alpha = 1 - easeInOutSine(u);
        L.blur = u * 0.28;
        L.scale = 1 + 0.06 * u;
      }
    }
  }

  private writeUniforms() {
    const g = this.glyphs;
    const opacity = this.levelNow * this.fade;
    const blurBase = g.emPx;
    const W = g.canvas.width;
    const H = g.canvas.height;
    for (const L of this.letters) {
      const m = L.mesh;
      const u = m.material.uniforms;
      m.position.copy(L.pos);
      m.rotation.set(L.rot.x, L.rot.y, L.rot.z);
      m.scale.set(L.glyph.quadW * L.scale, L.glyph.quadH * L.scale, 1);
      const a = L.done ? 0 : L.alpha * opacity;
      u.uOpacity.value = a;
      m.visible = a > 0.001;
      const blurPx = Math.min(L.blur, 0.32) * blurBase;
      u.uBlur.value.set(blurPx / W, blurPx / H);
      u.uLod.value = blurPx > 3 ? Math.min(4, Math.log2(blurPx * 0.4)) : 0;
      u.uWipe.value = this.wipe;
      u.uDissolve.value = this.dissolve;
    }
  }

  get dead() {
    return this.phaseState === "dead";
  }

  dispose() {
    for (const L of this.letters) L.mesh.material.dispose();
    this.group.removeFromParent();
    this.releaseGlyphs();
  }
}
