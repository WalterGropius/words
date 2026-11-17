/**
 * How words are written on stage, before they're drawn:
 *
 *  - the lexicon: phrases that must always be written one way ("být, či nebýt");
 *    heard or scripted words that match one, ignoring case and punctuation, take
 *    its exact form
 *  - the spelling enforcer: names and terms that near-misses snap to (a name
 *    misheard by a consonant, or spelt the way it sounds)
 *  - holding back: a short word (or the start of a lexicon phrase) waits for the
 *    next word, so it never stands alone at the end of a line or paragraph and
 *    a phrase is never written and then corrected
 */

export interface WordingOptions {
  lexicon: string[];
  spelling: string[];
  spellingOn: boolean;
  holdShort: boolean;
  shortMax: number;
}

const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");

/** Letters and digits only, lower case; the long s reads as s. */
export const norm = (w: string) => w.replace(/ſ/g, "s").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** How many letters a word has (punctuation doesn't count). */
export const letterCount = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").length;

export const isShort = (w: string, max: number) => {
  const n = letterCount(w);
  return n > 0 && n <= max;
};

interface Entry {
  words: string[];
  norms: string[];
}

function entries(list: string[]): Entry[] {
  return list
    .map((line) => line.trim().split(/\s+/).filter(Boolean))
    .map((words) => ({ words, norms: words.map(norm) }))
    .filter((e) => e.words.length > 0 && e.norms.every(Boolean));
}

const LEAD = /^[^\p{L}\p{N}]+/u;
const TRAIL = /[^\p{L}\p{N}]+$/u;

/** Put a replacement in place of a source word: keep the source's capital and its own end punctuation. */
function fit(source: string, replacement: string, first: boolean, last: boolean) {
  let out = replacement;
  const src = source.replace(LEAD, "");
  if (first && src && src[0] !== src[0].toLocaleLowerCase() && out[0] === out[0].toLocaleLowerCase()) {
    out = out[0].toLocaleUpperCase() + out.slice(1);
  }
  if (first) {
    const lead = source.match(LEAD)?.[0];
    if (lead && !LEAD.test(out)) out = lead + out;
  }
  if (last) {
    const trail = source.match(TRAIL)?.[0];
    if (trail && !TRAIL.test(out)) out += trail;
  }
  return out;
}

/** Replace every run of words matching a lexicon phrase with the phrase as written. */
export function applyLexicon(words: string[], lexicon: string[]): { words: string[]; fixed: boolean[] } {
  const list = entries(lexicon).sort((a, b) => b.norms.length - a.norms.length);
  const out = [...words];
  const fixed = words.map(() => false);
  const n = words.map(norm);
  for (let i = 0; i < words.length; i++) {
    for (const e of list) {
      const k = e.norms.length;
      if (i + k > words.length || e.norms.some((w, j) => n[i + j] !== w)) continue;
      for (let j = 0; j < k; j++) {
        out[i + j] = fit(words[i + j], e.words[j], j === 0, j === k - 1);
        fixed[i + j] = true;
      }
      i += k - 1;
      break;
    }
  }
  return { words: out, fixed };
}

/** How many of the last words could be the start of a lexicon phrase still being spoken. */
export function lexiconPrefix(words: string[], lexicon: string[]): number {
  const n = words.map(norm);
  let best = 0;
  for (const e of entries(lexicon)) {
    for (let k = Math.min(e.norms.length - 1, n.length); k > best; k--) {
      if (e.norms.slice(0, k).every((w, j) => n[n.length - k + j] === w)) {
        best = k;
        break;
      }
    }
  }
  return best;
}

// ───────────────────────────── the spelling enforcer ─────────────────────────────

const VOWELS = /[aeiouy]/;

/** A rough sound-key: strip accents, spell sounds one way, fold doubled letters. */
export function soundKey(w: string) {
  return strip(norm(w))
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kv")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/x/g, "ks")
    .replace(/y/g, "i")
    .replace(/ch/g, "x")
    .replace(/t[sz]/g, "c")
    .replace(/c(?![eiy])/g, "k")
    .replace(/z/g, "s")
    .replace(/(.)\1+/g, "$1");
}

const consonants = (key: string) => key.replace(new RegExp(VOWELS.source, "g"), "");

function distance(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/**
 * Is `heard` a near-miss of `term`? It must start the same, sound the same or
 * miss by at most one consonant, and be close overall — so short everyday
 * words are never pulled onto a name.
 */
export function nearMiss(heard: string, term: string) {
  const h = soundKey(heard);
  const t = soundKey(term);
  if (h.length < 4 || t.length < 4 || h[0] !== t[0]) return false;
  if (h === t) return true;
  const overall = distance(h, t);
  const allowed = t.length >= 9 ? 2 : 1;
  return overall <= allowed && distance(consonants(h), consonants(t)) <= 1;
}

/** Snap near-misses onto the spelling list (multi-word terms match word by word). */
export function applySpelling(words: string[], terms: string[], skip: boolean[] = []): string[] {
  const list = entries(terms).sort((a, b) => b.words.length - a.words.length);
  const out = [...words];
  for (let i = 0; i < words.length; i++) {
    if (skip[i]) continue;
    for (const e of list) {
      const k = e.words.length;
      if (i + k > words.length) continue;
      let ok = true;
      let exact = true;
      for (let j = 0; j < k && ok; j++) {
        if (skip[i + j]) ok = false;
        else if (norm(words[i + j]) === e.norms[j]) continue;
        else if (nearMiss(words[i + j], e.words[j])) exact = false;
        else ok = false;
      }
      if (!ok) continue;
      if (!exact || e.words.some((w, j) => strip(w) !== strip(words[i + j]).replace(LEAD, "").replace(TRAIL, ""))) {
        for (let j = 0; j < k; j++) out[i + j] = fit(words[i + j], e.words[j], j === 0, j === k - 1);
      }
      i += k - 1;
      break;
    }
  }
  return out;
}

// ───────────────────────────── putting it together ─────────────────────────────

export interface Composed {
  /** The words to show, rewritten. */
  words: string[];
  /** How many of the last input words must wait for the next one. */
  held: number;
}

/** Rewrite a run of words, and say how many at the end must wait for more. */
export function compose(input: string[], o: WordingOptions): Composed {
  const lex = applyLexicon(input, o.lexicon);
  const words = o.spellingOn && o.spelling.length ? applySpelling(lex.words, o.spelling, lex.fixed) : lex.words;
  let held = lexiconPrefix(input, o.lexicon);
  if (o.holdShort) {
    // a run of short words at the end waits together ("a v")
    let k = 0;
    while (k < words.length && isShort(words[words.length - 1 - k], o.shortMax)) k++;
    held = Math.max(held, k);
  }
  return { words, held: Math.min(held, words.length) };
}

/** Rewrite a whole script (no holding: every word is already known). */
export function rewriteAll(words: string[], o: WordingOptions): string[] {
  return compose(words, { ...o, holdShort: false }).words;
}
