/**
 * Live speech → words, via Soniox real-time speech-to-text.
 *
 * The microphone is captured with an AudioWorklet as 16-bit PCM and streamed
 * over a WebSocket straight to Soniox, authenticated with a short-lived key
 * from our own /api/soniox route. Soniox answers with sub-word tokens; the
 * WordAssembler turns confirmed tokens into whole words for the stage.
 */

import { TEXTS } from "./texts";

const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
export const SONIOX_MODEL = "stt-rt-v6";
/** Soniox context is capped at ~10,000 characters. */
const CONTEXT_CHARS = 9000;

export interface LiveConfig {
  /** ISO code used as a language hint, or "" to let Soniox detect it. */
  language: string;
  /** Microphone deviceId, or "" for the system default. */
  deviceId: string;
  /** Hand the script to Soniox as context so its vocabulary is recognised. */
  primeWithScript: boolean;
}

/** Tuned for a Czech-speaking stage: Czech recognition, restricted to Czech. */
export const DEFAULT_LIVE: LiveConfig = { language: "cs", deviceId: "", primeWithScript: true };

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "cs", label: "Čeština (Czech)" },
  { code: "sk", label: "Slovenčina (Slovak)" },
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "no", label: "Norwegian" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "", label: "Detect automatically" },
];

/**
 * The script as recognition context. The built-in presets are English
 * Shakespeare; they would only mislead a Czech recogniser, so they are sent
 * only when the spoken language is English (or left to detection).
 */
export function scriptContext(script: string, config: LiveConfig): string {
  if (!config.primeWithScript) return "";
  const isPreset = TEXTS.some((t) => t.text.trim() === script.trim());
  if (isPreset && config.language !== "en" && config.language !== "") return "";
  return script;
}

export type LiveState = "idle" | "connecting" | "listening" | "reconnecting" | "error";

export interface LiveStatus {
  state: LiveState;
  message?: string;
}

interface SonioxToken {
  text: string;
  is_final: boolean;
}

interface SonioxResponse {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number;
  error_type?: string;
  error_message?: string;
}

// ───────────────────────────── tokens → words ─────────────────────────────

export interface WordBatch {
  words: string[];
  /** The speaker paused (Soniox endpoint): a natural line break after these words. */
  pause: boolean;
}

/**
 * Soniox sends sub-word tokens ("do", "ing", "?") and separate spaces. Final
 * tokens arrive once and never change; non-final ones are a provisional tail
 * that is re-sent with every response. A word is ready for the stage once it
 * is confirmed and something after it shows it has ended: a space, or the
 * end of an utterance.
 */
export class WordAssembler {
  private pending = "";

  feed(tokens: SonioxToken[]): WordBatch & { provisional: string } {
    let pause = false;
    let tail = "";
    for (const t of tokens) {
      if (t.text === "<end>" || t.text === "<fin>") {
        if (t.is_final) pause = true;
        continue;
      }
      if (t.is_final) this.pending += t.text.normalize("NFC");
      else tail += t.text.normalize("NFC");
    }

    const words: string[] = [];
    const cut = this.pending.search(/\s\S*$/);
    if (cut >= 0) {
      words.push(...this.pending.slice(0, cut).split(/\s+/).filter(Boolean));
      this.pending = this.pending.slice(cut).trimStart();
    }
    // the word is over if the speaker paused, or the provisional tail starts a new one
    if (this.pending && (pause || /^\s/.test(tail))) words.push(...this.flush());
    return { words, pause, provisional: `${this.pending}${tail}`.trim() };
  }

  get hasPending() {
    return this.pending.trim().length > 0;
  }

  flush(): string[] {
    const w = this.pending.trim().split(/\s+/).filter(Boolean);
    this.pending = "";
    return w;
  }
}

// ───────────────────────────── microphone ─────────────────────────────

/** Runs on the audio thread: float samples → ~100 ms chunks of 16-bit PCM. */
const WORKLET = `
class SonioxTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buf = new Int16Array(this.size);
    this.n = 0;
    this.peak = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.size) {
        this.port.postMessage({ pcm: this.buf.buffer, peak: this.peak }, [this.buf.buffer]);
        this.buf = new Int16Array(this.size);
        this.n = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}
registerProcessor("soniox-tap", SonioxTap);
`;

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput");
}

/** Ask for microphone permission once so device names become visible. */
export async function unlockMicrophoneNames() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  s.getTracks().forEach((t) => t.stop());
}

export async function sonioxConfigured(): Promise<boolean> {
  try {
    const r = await fetch("/api/soniox", { cache: "no-store" });
    if (!r.ok) return false;
    return Boolean(((await r.json()) as { configured?: boolean }).configured);
  } catch {
    return false;
  }
}

// ───────────────────────────── the session ─────────────────────────────

export interface LiveCallbacks {
  onWords: (batch: WordBatch) => void;
  onStatus?: (s: LiveStatus) => void;
  /** Confirmed-but-unfinished + provisional text: what's being said right now. */
  onProvisional?: (text: string) => void;
  /** Input peak level 0..1, about ten times a second. */
  onLevel?: (peak: number) => void;
}

/** Errors that a fresh connection will not fix. */
const FATAL = new Set([400, 401, 402]);

export class LiveTranscriber {
  private readonly config: LiveConfig;
  private readonly context: string;
  private readonly cb: LiveCallbacks;
  private readonly words = new WordAssembler();

  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private wsReady = false;
  private stopped = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private status: LiveStatus = { state: "idle" };

  /** `context` is the text to prime recognition with; see scriptContext(). */
  constructor(config: LiveConfig, callbacks: LiveCallbacks, context = "") {
    this.config = config;
    this.cb = callbacks;
    this.context = context.trim().slice(0, CONTEXT_CHARS);
  }

  get state() {
    return this.status;
  }

  async start() {
    this.stopped = false;
    this.setStatus({ state: "connecting", message: "Opening the microphone…" });
    try {
      await this.openMicrophone();
    } catch (err) {
      this.stop();
      this.setStatus({ state: "error", message: micError(err) });
      return;
    }
    if (this.stopped) return;
    void this.connect();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const ws = this.ws;
    this.ws = null;
    this.wsReady = false;
    if (ws) {
      try {
        // an empty frame tells Soniox the audio is over
        if (ws.readyState === WebSocket.OPEN) ws.send("");
      } catch {
        /* closing anyway */
      }
      setTimeout(() => ws.close(), 300);
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audio?.close().catch(() => {});
    this.audio = null;
    this.setStatus({ state: "idle" });
  }

  private setStatus(s: LiveStatus) {
    this.status = s;
    this.cb.onStatus?.(s);
  }

  private async openMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
    const constraints: MediaTrackConstraints = {
      channelCount: 1,
      // a stage mic is not a phone call: no echo cancelling that eats the voice
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (this.config.deviceId) constraints.deviceId = { exact: this.config.deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });

    const ctx = new AudioContext();
    this.audio = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = ctx.createMediaStreamSource(this.stream);
    const tap = new AudioWorkletNode(ctx, "soniox-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap).connect(mute).connect(ctx.destination);
    tap.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
      this.cb.onLevel?.(e.data.peak);
      if (this.wsReady && this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data.pcm);
    };
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  }

  private async connect() {
    if (this.stopped || !this.audio) return;
    this.setStatus({ state: this.retries ? "reconnecting" : "connecting", message: this.retries ? "Reconnecting to Soniox…" : "Connecting to Soniox…" });

    let key: string;
    try {
      const r = await fetch("/api/soniox", { method: "POST", cache: "no-store" });
      const data = (await r.json().catch(() => ({}))) as { api_key?: string; error?: string };
      if (!r.ok || !data.api_key) {
        const fatal = r.status === 503 || r.status === 403;
        this.fail(data.error ?? `Could not get a Soniox key (${r.status}).`, fatal);
        return;
      }
      key = data.api_key;
    } catch {
      this.fail("Could not reach the server for a Soniox key.", false);
      return;
    }
    if (this.stopped) return;

    const ws = new WebSocket(SONIOX_WS_URL, ["soniox-api-key", key]);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let fatal = false;

    ws.onopen = () => {
      if (ws !== this.ws) return;
      const start: Record<string, unknown> = {
        model: SONIOX_MODEL,
        audio_format: "pcm_s16le",
        sample_rate: this.audio?.sampleRate ?? 48000,
        num_channels: 1,
        enable_endpoint_detection: true,
      };
      if (this.config.language) {
        // one known language: restrict to it, so Czech never comes out as Slovak or Polish
        start.language_hints = [this.config.language];
        start.language_hints_strict = true;
      }
      if (this.context) start.context = { text: this.context };
      ws.send(JSON.stringify(start));
      this.wsReady = true;
      this.retries = 0;
      this.setStatus({ state: "listening" });
    };

    ws.onmessage = (e: MessageEvent) => {
      if (ws !== this.ws || typeof e.data !== "string") return;
      let res: SonioxResponse;
      try {
        res = JSON.parse(e.data) as SonioxResponse;
      } catch {
        return;
      }
      if (res.error_code) {
        fatal = FATAL.has(res.error_code) || (res.error_code === 403 && res.error_type !== "temp_api_key_session_expired");
        this.setStatus({ state: "error", message: `Soniox: ${res.error_message ?? res.error_type ?? res.error_code}` });
        return;
      }
      if (res.tokens?.length) this.handleTokens(res.tokens);
    };

    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.wsReady = false;
      this.ws = null;
      this.release(this.words.flush(), true);
      if (this.stopped) return;
      if (fatal) {
        this.fail(this.status.message ?? "Soniox closed the connection.", true);
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleTokens(tokens: SonioxToken[]) {
    const { words, pause, provisional } = this.words.feed(tokens);
    this.release(words, pause);
    this.cb.onProvisional?.(provisional);

    // fallback for a trailing word that never gets a space or an endpoint
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.words.hasPending) {
      this.idleTimer = setTimeout(() => {
        this.release(this.words.flush(), true);
        this.cb.onProvisional?.("");
      }, 1400);
    }
  }

  private release(words: string[], pause: boolean) {
    if (words.length || pause) this.cb.onWords({ words, pause });
  }

  private fail(message: string, fatal: boolean) {
    if (fatal || this.stopped) {
      this.stop(); // release the microphone too
      this.setStatus({ state: "error", message });
      return;
    }
    this.setStatus({ state: "reconnecting", message });
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.retries++;
    const wait = Math.min(10_000, 600 * 2 ** Math.min(this.retries - 1, 4));
    this.setStatus({ state: "reconnecting", message: this.status.message ?? "Reconnecting to Soniox…" });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), wait);
  }
}

function micError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if ((err as Error)?.message === "insecure") return "The microphone needs a secure page (https or localhost).";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was blocked. Allow it in the browser and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "That microphone was not found. Pick another one in setup.";
  if (name === "NotReadableError") return "The microphone is busy in another app.";
  return "Could not open the microphone.";
}
