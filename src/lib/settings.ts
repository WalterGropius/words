import type { FontId } from "./fonts";

export type Mode = "word" | "line" | "page";
export type Entrance = "fade" | "quill" | "arrive" | "rise" | "materialize";
export type Exit = "drift" | "fall" | "rise" | "dissolve" | "scatter" | "fade";
export type Align = "center" | "left";

export interface Settings {
  // Staging
  mode: Mode;
  linesAtOnce: number; // line mode
  maxPageLines: number; // page mode
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
  turbulence: number; // 0..1

  // Atmosphere
  glow: number; // 0..1.5
  dust: number; // 0..1
  cameraDrift: number; // 0..1
  breathing: number; // 0..1
  grain: number; // 0..0.15
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "word",
  linesAtOnce: 1,
  maxPageLines: 14,
  stanzaBreaks: true,
  ghost: 0,
  spokenLevel: 0.55,
  align: "center",
  jitter: 0.35,
  autoExit: 0,

  font: "fell-english",
  italic: false,
  caps: false,
  longS: false,
  size: 1,

  entrance: "fade",
  entranceDuration: 1.1,
  entranceStagger: 0.35,

  exit: "fall",
  exitDuration: 6,
  exitStagger: 0.4,
  gravity: 0.3,
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
};

export interface Look {
  id: string;
  name: string;
  blurb: string;
  settings: Partial<Settings>;
}

export const LOOKS: Look[] = [
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

const STORAGE_KEY = "words.v1";

export interface Persisted {
  text: string;
  settings: Settings;
}

export function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      text: typeof parsed.text === "string" ? parsed.text : undefined,
      settings: parsed.settings ? { ...DEFAULT_SETTINGS, ...parsed.settings } : undefined,
    };
  } catch {
    return {};
  }
}

export function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode) — settings just won't persist
  }
}
