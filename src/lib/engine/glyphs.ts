import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter } from "three";

/** Glyph box, in em, around the baseline: room for ascenders, swashes and descenders. */
const ASCENT = 1.25;
const DESCENT = 0.6;
const PAD = 0.3; // horizontal padding per side, in em (italic overhang, blur room)
const GAP = 4; // px between atlas cells so mipmaps don't bleed
const MAX_ROW = 2048;
const MAX_TEX = 4096;

export interface FontSpec {
  family: string;
  italic: boolean;
}

export interface LetterGlyph {
  char: string;
  /** Atlas cell in canvas px. */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  /** Texture rect: u0, vTop, u1, vBottom (v measured from canvas top). */
  rect: [number, number, number, number];
  /** Quad centre relative to word origin (left edge, baseline), world units, y up. */
  centerX: number;
  centerY: number;
  quadW: number;
  quadH: number;
  /** Portion of the word's span this quad covers, 0..1. */
  span: [number, number];
}

export interface WordGlyphs {
  key: string;
  text: string;
  fontPx: number;
  /** Canvas px per world unit. */
  k: number;
  emPx: number;
  width: number;
  spanW: number;
  letters: LetterGlyph[];
  texture: CanvasTexture;
  canvas: HTMLCanvasElement;
  /** Lazily read alpha channel, for particle sampling. */
  alpha(): Uint8ClampedArray;
  dispose(): void;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    measureCtx = c.getContext("2d")!;
  }
  return measureCtx;
}

export function fontString(font: FontSpec, px: number): string {
  return `${font.italic ? "italic " : ""}400 ${px}px ${font.family}`;
}

/** Advance width of `text` in world units at `fontPx`. */
export function measureText(text: string, font: FontSpec, fontPx: number): number {
  const ctx = getMeasureCtx();
  ctx.font = fontString(font, 100);
  return (ctx.measureText(text).width * fontPx) / 100;
}

export function rasterizeWord(text: string, font: FontSpec, fontPx: number, pixelRatio: number): WordGlyphs {
  const chars = Array.from(text);
  let k = Math.min(pixelRatio, 2) * 1.15;
  // keep huge words within texture limits
  k = Math.min(k, 340 / fontPx);

  const build = (k: number) => {
    const em = fontPx * k;
    const ctx = getMeasureCtx();
    ctx.font = fontString(font, em);
    const prefix: number[] = [0];
    let acc = "";
    for (const c of chars) {
      acc += c;
      prefix.push(ctx.measureText(acc).width);
    }
    const pad = Math.ceil(PAD * em);
    const ch = Math.ceil((ASCENT + DESCENT) * em);
    const cells: { x: number; y: number; w: number }[] = [];
    let x = GAP;
    let y = GAP;
    let rowW = 0;
    for (let i = 0; i < chars.length; i++) {
      const adv = Math.max(1, prefix[i + 1] - prefix[i]);
      const w = Math.ceil(adv + pad * 2);
      if (x + w + GAP > MAX_ROW && x > GAP) {
        x = GAP;
        y += ch + GAP;
      }
      cells.push({ x, y, w });
      x += w + GAP;
      rowW = Math.max(rowW, x);
    }
    return { em, prefix, pad, ch, cells, W: Math.max(8, rowW), H: y + ch + GAP };
  };

  let L = build(k);
  while ((L.H > MAX_TEX || L.W > MAX_TEX) && k > 0.25) {
    k *= 0.8;
    L = build(k);
  }

  const canvas = document.createElement("canvas");
  canvas.width = L.W;
  canvas.height = L.H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.font = fontString(font, L.em);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const baseline = Math.round(ASCENT * L.em);

  const width = L.prefix[chars.length] / k;
  const padW = L.pad / k;
  const spanW = width + padW * 2;
  const letters: LetterGlyph[] = chars.map((char, i) => {
    const cell = L.cells[i];
    ctx.fillText(char, cell.x + L.pad, cell.y + baseline);
    const quadW = cell.w / k;
    const quadH = L.ch / k;
    const left = L.prefix[i] / k; // quad left relative to span start
    return {
      char,
      cx: cell.x,
      cy: cell.y,
      cw: cell.w,
      ch: L.ch,
      rect: [cell.x / L.W, cell.y / L.H, (cell.x + cell.w) / L.W, (cell.y + L.ch) / L.H],
      centerX: left - padW + quadW / 2,
      centerY: (baseline - L.ch / 2) / k,
      quadW,
      quadH,
      span: [left / spanW, (left + quadW) / spanW],
    };
  });

  const texture = new CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.flipY = false;
  texture.anisotropy = 4;

  let alphaCache: Uint8ClampedArray | null = null;
  return {
    key: "",
    text,
    fontPx,
    k,
    emPx: L.em,
    width,
    spanW,
    letters,
    texture,
    canvas,
    alpha() {
      if (!alphaCache) {
        const data = ctx.getImageData(0, 0, L.W, L.H).data;
        alphaCache = new Uint8ClampedArray(L.W * L.H);
        for (let i = 0, j = 3; i < alphaCache.length; i++, j += 4) alphaCache[i] = data[j];
      }
      return alphaCache;
    },
    dispose() {
      texture.dispose();
      canvas.width = canvas.height = 0;
      alphaCache = null;
    },
  };
}

export interface GlyphPoint {
  /** Offset from the letter quad centre, world units (y up). */
  dx: number;
  dy: number;
  /** Normalised position along the word span (0..1). */
  wx: number;
}

/** Sample ink pixels of one letter on a jittered grid. */
export function sampleLetter(g: WordGlyphs, index: number, step: number): GlyphPoint[] {
  const L = g.letters[index];
  const a = g.alpha();
  const W = g.canvas.width;
  const out: GlyphPoint[] = [];
  const s = Math.max(1, step);
  for (let y = L.cy; y < L.cy + L.ch; y += s) {
    for (let x = L.cx; x < L.cx + L.cw; x += s) {
      const jx = Math.min(L.cx + L.cw - 1, Math.round(x + Math.random() * s * 0.8));
      const jy = Math.min(L.cy + L.ch - 1, Math.round(y + Math.random() * s * 0.8));
      if (a[jy * W + jx] > 110) {
        const lx = (jx - L.cx) / g.k;
        const ly = (jy - L.cy) / g.k;
        out.push({
          dx: lx - L.quadW / 2,
          dy: L.quadH / 2 - ly,
          wx: L.span[0] + (lx / L.quadW) * (L.span[1] - L.span[0]),
        });
      }
    }
  }
  return out;
}
