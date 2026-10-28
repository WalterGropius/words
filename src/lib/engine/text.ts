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
}

/** Early-modern long s: ſ everywhere except word-final and before f/b/k. */
function toLongS(word: string): string {
  return word.replace(/s(?=[a-zA-Z])/g, (m, offset: number) => {
    const next = word[offset + 1];
    return next === "f" || next === "b" || next === "k" ? m : "ſ";
  });
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
    for (let w of words) {
      if (opts.longS) w = toLongS(w);
      if (opts.caps) w = w.toLocaleUpperCase().replace(/ſ/g, "S");
      ids.push(tokens.length);
      tokens.push({ index: tokens.length, text: w, line: lineIdx, stanza });
    }
    lines.push(ids);
    lineStanza.push(stanza);
  }
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
