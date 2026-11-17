import type { FontId } from "./fonts";

export type Mode = "word" | "line" | "page" | "paragraph";
export type Entrance = "nebula" | "fade" | "quill" | "arrive" | "rise" | "materialize";
export type Exit = "smoke" | "drift" | "fall" | "rise" | "dissolve" | "scatter" | "fade";
export type Align = "center" | "left";
export type Source = "script" | "voice";

export interface Settings {
  // Source
  source: Source; // script = pressed word by word, voice = live from the mic via Soniox
  language: string; // voice: ISO language hint, "" = detect
  liveTranscript: boolean; // voice: show words the moment they're heard, as flowing sentences
  banned: string; // voice: comma-separated words never put on stage (fillers, hesitations)

  // Staging
  mode: Mode;
  linesAtOnce: number; // line mode
  maxPageLines: number; // page mode
  paragraphLines: number; // paragraph mode: lines before a new paragraph begins
  paragraphWidth: number; // paragraph mode: 0.25..0.7 of the stage width
  paragraphLinger: number; // paragraph mode: seconds a word stays readable, once formed, before it starts to leave
  paragraphFade: number; // paragraph mode: seconds a word takes to leave
  paragraphOnPause: boolean; // paragraph mode, voice: a pause in speech starts a new paragraph
  stanzaBreaks: boolean;
  ghost: number; // 0..0.4 opacity of words not yet spoken
  spokenLevel: number; // 0.15..1 brightness of words already spoken (verse modes)
  align: Align;
  jitter: number; // 0..1 word mode position wander
  autoExit: number; // seconds, 0 = never (word mode)

  // Typeface
  font: FontId;
  italic: boolean;
  caps: boolean;
  longS: boolean;
  size: number; // multiplier 0.5..2

  // Entrance
  entrance: Entrance;
  entranceDuration: number; // s
  entranceStagger: number; // 0..1

  // Exit
  exit: Exit;
  exitDuration: number; // s
  exitStagger: number; // 0..1
  gravity: number; // 0..1
  fogSize: number; // nebula + smoke: 0.5..2.5 size of the cloud and its puffs
  fogStrength: number; // nebula + smoke: 0.2..1.5 how visible the fog is
  smokeLayers: number; // nebula + smoke: 1..4 noise texture layers per puff
  smokeNoise: number; // nebula + smoke: 0..1 how much noise breaks up each puff
  smokeContrast: number; // nebula + smoke: 0.5..3 how hard-edged the wisps are
  smokeSpeckFade: number; // nebula + smoke: 0..2 how strongly small puffs fade (so they don't show as specks)
  turbulence: number; // 0..1

  // Atmosphere
  glow: number; // 0..1.5
  dust: number; // 0..1
  cameraDrift: number; // 0..1
  breathing: number; // 0..1
  grain: number; // 0..0.15
}

/** Czech hesitations and fillers. */
export const DEFAULT_BANNED = "hm, mhm, mm, ehm, eh, em, e, é, uh, uhm, um, ah, ehe";

export const DEFAULT_SETTINGS: Settings = {
  source: "script",
  language: "cs",
  liveTranscript: true,
  banned: DEFAULT_BANNED,

  // the director's brief: words appear out of a cosmic nebula, stay readable
  // for a second or two, then dissolve like smoke carried off by a draft
  mode: "paragraph",
  linesAtOnce: 1,
  maxPageLines: 14,
  paragraphLines: 4,
  paragraphWidth: 0.42,
  paragraphLinger: 1.75,
  paragraphFade: 3,
  paragraphOnPause: true,
  stanzaBreaks: true,
  ghost: 0,
  spokenLevel: 0.6,
  align: "center",
  jitter: 0.35,
  autoExit: 0,

  font: "fell-english",
  italic: false,
  caps: false,
  longS: false,
  size: 1,

  entrance: "nebula",
  entranceDuration: 1.4,
  entranceStagger: 0.35,

  exit: "smoke",
  exitDuration: 3,
  exitStagger: 0.4,
  gravity: 0.3,
  fogSize: 1,
  fogStrength: 1,
  smokeLayers: 2,
  smokeNoise: 0.85,
  smokeContrast: 1.6,
  smokeSpeckFade: 1,
  turbulence: 0.45,

  glow: 0.55,
  dust: 0.35,
  cameraDrift: 0.35,
  breathing: 0.35,
  grain: 0,
};

/** Defaults applied when switching mode in the UI. */
export const MODE_DEFAULTS: Record<Mode, Partial<Settings>> = {
  word: {},
  line: { ghost: 0, spokenLevel: 0.6 },
  page: { ghost: 0.1, spokenLevel: 0.55 },
  paragraph: { spokenLevel: 0.6 },
};

export interface Look {
  id: string;
  name: string;
  blurb: string;
  settings: Partial<Settings>;
}

export const LOOKS: Look[] = [
  {
    id: "nebula",
    name: "Nebula",
    blurb: "Out of a cosmic nebula, gone again like smoke on a draft",
    settings: {
      mode: "paragraph",
      entrance: "nebula",
      exit: "smoke",
      paragraphLinger: 1.75,
      paragraphFade: 3,
      spokenLevel: 0.6,
      entranceDuration: 1.4,
      fogSize: 1,
      fogStrength: 1,
    },
  },
  {
    id: "mist",
    name: "Mist",
    blurb: "The same nebula and smoke, a larger fog but fainter",
    settings: {
      mode: "paragraph",
      entrance: "nebula",
      exit: "smoke",
      paragraphLinger: 1.75,
      paragraphFade: 3,
      spokenLevel: 0.6,
      entranceDuration: 1.4,
      fogSize: 1.8,
      fogStrength: 0.55,
    },
  },
  {
    id: "leaves",
    name: "Autumn",
    blurb: "Words ink in, then fall like leaves",
    settings: { mode: "word", entrance: "fade", exit: "fall", exitDuration: 6, gravity: 0.3, turbulence: 0.45, entranceDuration: 1.1 },
  },
  {
    id: "ashes",
    name: "Ashes",
    blurb: "Each word burns away to dust",
    settings: { mode: "word", entrance: "quill", exit: "dissolve", exitDuration: 4, gravity: 0.15, turbulence: 0.6, entranceDuration: 0.9 },
  },
  {
    id: "embers",
    name: "Embers",
    blurb: "Gathered from sparks, rising as smoke",
    settings: { mode: "word", entrance: "materialize", exit: "rise", exitDuration: 6, gravity: 0.35, turbulence: 0.7, entranceDuration: 1.4 },
  },
  {
    id: "abyss",
    name: "Abyss",
    blurb: "Words fly in from the dark and drift back",
    settings: { mode: "word", entrance: "arrive", exit: "drift", exitDuration: 7, turbulence: 0.35, entranceDuration: 1.6 },
  },
  {
    id: "tempest",
    name: "Tempest",
    blurb: "Arrive from the deep, shatter on the next",
    settings: { mode: "word", entrance: "arrive", exit: "scatter", exitDuration: 3.5, turbulence: 0.8, entranceDuration: 1.2 },
  },
  {
    id: "scattered",
    name: "Scattered",
    blurb: "Paragraphs written around the stage, burning away behind the pen",
    settings: { mode: "paragraph", entrance: "fade", exit: "dissolve", paragraphLinger: 4, paragraphFade: 1.5, spokenLevel: 0.6, entranceDuration: 0.9 },
  },
  {
    id: "verse",
    name: "Verse",
    blurb: "Line by line, each word lights in place",
    settings: { mode: "line", linesAtOnce: 1, ghost: 0, entrance: "rise", exit: "drift", exitDuration: 5, spokenLevel: 0.6, entranceDuration: 0.9 },
  },
  {
    id: "folio",
    name: "Folio",
    blurb: "The whole page waits in shadow, revealed word by word",
    settings: { mode: "page", ghost: 0.1, entrance: "quill", exit: "dissolve", exitDuration: 4, spokenLevel: 0.55, entranceDuration: 0.8 },
  },
];

/**
 * v2 made the nebula look the default. Staging saved under v1 is dropped so
 * everyone starts from it; the text and the voice setup are carried over.
 */
const STORAGE_KEY = "words.v2";
const LEGACY_KEY = "words.v1";
const CARRIED_OVER = ["source", "language", "liveTranscript", "banned"] as const;

export interface Persisted {
  text: string;
  settings: Settings;
}

export function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return loadLegacy();
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      text: typeof parsed.text === "string" ? parsed.text : undefined,
      settings: parsed.settings ? { ...DEFAULT_SETTINGS, ...parsed.settings } : undefined,
    };
  } catch {
    return {};
  }
}

function loadLegacy(): Partial<Persisted> {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Partial<Persisted>;
  const old = (parsed.settings ?? {}) as Partial<Settings>;
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const k of CARRIED_OVER) if (old[k] !== undefined) (settings as unknown as Record<string, unknown>)[k] = old[k];
  return { text: typeof parsed.text === "string" ? parsed.text : undefined, settings };
}

export function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode) — settings just won't persist
  }
}
