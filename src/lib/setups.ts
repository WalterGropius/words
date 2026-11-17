import { DEFAULT_SETTINGS, type Settings } from "./settings";

/**
 * Saved setups: named snapshots of the whole staging, optionally with the text,
 * kept in this browser and movable between machines as a JSON file (so a show
 * built on a laptop can be carried to the theatre's computer).
 */
export interface SavedSetup {
  id: string;
  name: string;
  settings: Settings;
  /** The text, when it was saved with it. */
  text?: string;
  savedAt: number;
}

const KEY = "words.setups.v1";
const ACTIVE_KEY = "words.setups.active";
const FILE_KIND = "words-setups";

const withDefaults = (s: Partial<Settings> | undefined): Settings => ({ ...DEFAULT_SETTINGS, ...(s ?? {}) });

function sanitize(raw: unknown): SavedSetup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Partial<SavedSetup> => !!r && typeof r === "object" && typeof (r as SavedSetup).name === "string")
    .map((r) => ({
      id: typeof r.id === "string" && r.id ? r.id : newSetupId(),
      name: r.name!.trim() || "Untitled",
      settings: withDefaults(r.settings),
      text: typeof r.text === "string" ? r.text : undefined,
      savedAt: typeof r.savedAt === "number" ? r.savedAt : Date.now(),
    }));
}

export function newSetupId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function loadSetups(): SavedSetup[] {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function storeSetups(list: SavedSetup[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — setups last only for this visit; export still works
  }
}

export function loadActiveSetupId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function storeActiveSetupId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // ignore
  }
}

/** Do the current settings (and text, if the setup carries one) still match a saved setup? */
export function matchesSetup(setup: SavedSetup, settings: Settings, text: string) {
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
  if (keys.some((k) => setup.settings[k] !== settings[k])) return false;
  return setup.text === undefined || setup.text === text;
}

export function downloadSetups(list: SavedSetup[], filename = "words-setups.json") {
  const blob = new Blob([JSON.stringify({ kind: FILE_KIND, version: 1, setups: list }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read setups from an exported file (or a bare array of them). Throws on anything else. */
export function parseSetupsFile(json: string): SavedSetup[] {
  const data = JSON.parse(json);
  const list = Array.isArray(data) ? data : data?.kind === FILE_KIND ? data.setups : null;
  const setups = sanitize(list);
  if (!setups.length) throw new Error("No setups found in that file.");
  return setups;
}

/** Imported setups join the list; one with the same name as an existing setup replaces it. */
export function mergeSetups(current: SavedSetup[], incoming: SavedSetup[]): SavedSetup[] {
  const out = [...current];
  for (const s of incoming) {
    const i = out.findIndex((o) => o.name.toLowerCase() === s.name.toLowerCase());
    if (i >= 0) out[i] = { ...s, id: out[i].id };
    else out.push({ ...s, id: out.some((o) => o.id === s.id) ? newSetupId() : s.id });
  }
  return out;
}
