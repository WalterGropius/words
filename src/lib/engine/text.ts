export interface Token {
  /** Index in the whole text. */
  index: number;
  text: string;
  line: number;
  stanza: number;
}

export interface ParsedText {
  tokens: Token[];
  /** Token indices grouped by source line (blank lines removed). */
  lines: number[][];
  /** Stanza index of each line in `lines`. */
  lineStanza: number[];
}

export interface TextOptions {
  caps: boolean;
  longS: boolean;
  /** Rewrite the script's words before styling (lexicon, spelling); must keep the count. */
  rewrite?: (words: string[]) => string[];
}

/** Early-modern long s: ſ everywhere except word-final and before f/b/k. */
function toLongS(word: string): string {
  return word.replace(/s(?=[a-zA-Z])/g, (m, offset: number) => {
    const next = word[offset + 1];
    return next === "f" || next === "b" || next === "k" ? m : "ſ";
  });
}

/** Apply the typographic options to one word. */
export function styleWord(word: string, opts: TextOptions): string {
  let w = word;
  if (opts.longS) w = toLongS(w);
  if (opts.caps) w = w.toLocaleUpperCase().replace(/ſ/g, "S");
  return w;
}

export function parseText(raw: string, opts: TextOptions): ParsedText {
  const tokens: Token[] = [];
  const lines: number[][] = [];
  const lineStanza: number[] = [];
  let stanza = 0;
  let sawBlank = false;

  for (const rawLine of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      sawBlank = true;
      continue;
    }
    if (sawBlank && lines.length > 0) stanza++;
    sawBlank = false;
    const lineIdx = lines.length;
    const ids: number[] = [];
    for (const word of words) {
      ids.push(tokens.length);
      tokens.push({ index: tokens.length, text: word, line: lineIdx, stanza });
    }
    lines.push(ids);
    lineStanza.push(stanza);
  }
  const raw2 = tokens.map((t) => t.text);
  const rewritten = opts.rewrite ? opts.rewrite(raw2) : raw2;
  tokens.forEach((t, i) => (t.text = styleWord(rewritten.length === raw2.length ? rewritten[i] : raw2[i], opts)));
  return { tokens, lines, lineStanza };
}

/** Split lines into pages: break at stanzas (optional), then chunk evenly to <= max lines. */
export function paginate(parsed: ParsedText, maxLines: number, stanzaBreaks: boolean): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  parsed.lines.forEach((_, i) => {
    if (stanzaBreaks && current.length > 0 && parsed.lineStanza[i] !== parsed.lineStanza[i - 1]) {
      groups.push(current);
      current = [];
    }
    current.push(i);
  });
  if (current.length) groups.push(current);

  const pages: number[][] = [];
  const max = Math.max(1, Math.floor(maxLines));
  for (const g of groups) {
    const n = Math.ceil(g.length / max);
    const per = Math.ceil(g.length / n);
    for (let i = 0; i < g.length; i += per) pages.push(g.slice(i, i + per));
  }
  return pages;
}
