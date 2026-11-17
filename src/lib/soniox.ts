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
  /**
   * Put words on stage from Soniox's provisional hypothesis, within a few
   * hundred milliseconds, and correct them if the final text differs. Off:
   * wait for final words only (exact, but a second or two behind the voice).
   */
  instant: boolean;
}

/** Tuned for a Czech-speaking stage: Czech recognition, restricted to Czech. */
export const DEFAULT_LIVE: LiveConfig = { language: "cs", deviceId: "", primeWithScript: true, instant: true };

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

/** A word already on stage that Soniox has since heard differently. */
export interface WordCorrection {
  /** Position of the word in the whole live session (0 = first word released). */
  index: number;
  word: string;
}

/**
 * Soniox sends sub-word tokens ("do", "ing", "?") with spaces attached to the
 * start of the next token. Final tokens arrive once and never change, but
 * only after a delay of a second or more; non-final tokens are a provisional
 * tail that is re-sent (and sometimes revised) with every response, a few
 * hundred milliseconds after the sound.
 *
 * In instant mode a word is released as soon as it is complete in the
 * provisional hypothesis (the next word has started), and corrected later if
 * the final text disagrees. In confirmed mode only final words are released.
 */
export class WordAssembler {
  /** Final text of the current utterance not yet trimmed away. */
  private final = "";
  /** Words of the current hypothesis already released (aligned with `final`). */
  private released: string[] = [];
  /** Global index of released[0]. */
  private base = 0;
  /** The latest non-final tail, for flush(). */
  private tail = "";

  private readonly instant: boolean;

  constructor(instant = true) {
    this.instant = instant;
  }

  feed(tokens: SonioxToken[]): WordBatch & { provisional: string; corrections: WordCorrection[] } {
    let pause = false;
    let fin = false;
    let tail = "";
    for (const t of tokens) {
      if (t.text === "<end>" || t.text === "<fin>") {
        if (t.is_final) {
          if (t.text === "<end>") pause = true;
          else fin = true;
        }
        continue;
      }
      if (t.is_final) this.final += t.text.normalize("NFC");
      else tail += t.text.normalize("NFC");
    }
    this.tail = tail;

    // how much of the final text is made of finished words
    const finalWords = this.final.split(/\s+/).filter(Boolean);
    const finalEnded = pause || fin || /\s$/.test(this.final) || /^\s/.test(tail);
    const finalComplete = finalEnded ? finalWords.length : Math.max(0, finalWords.length - 1);

    const hyp = this.instant ? this.final + tail : this.final;
    const words = hyp.split(/\s+/).filter(Boolean);
    const hypEnded = this.instant ? pause || fin || /\s$/.test(hyp) : finalEnded;
    const complete = hypEnded ? words.length : Math.max(0, words.length - 1);

    // words already shown that the final text now says otherwise
    const corrections: WordCorrection[] = [];
    for (let i = 0; i < Math.min(this.released.length, finalComplete); i++) {
      if (this.released[i] !== finalWords[i]) {
        this.released[i] = finalWords[i];
        corrections.push({ index: this.base + i, word: finalWords[i] });
      }
    }

    const out: string[] = [];
    for (let i = this.released.length; i < complete; i++) {
      this.released.push(words[i]);
      out.push(words[i]);
    }

    // forget confirmed words so the text never grows without bound
    if (pause) {
      this.base += this.released.length;
      this.final = "";
      this.released = [];
    } else if (finalComplete > 0 && this.released.length >= finalComplete) {
      this.final = this.final.replace(new RegExp(`^(\\s*\\S+){${finalComplete}}`), "");
      this.released.splice(0, finalComplete);
      this.base += finalComplete;
    }

    const rest = (this.instant ? `${this.final}${tail}` : this.final).split(/\s+/).filter(Boolean).slice(this.released.length);
    const provisional = this.instant ? rest.join(" ") : `${rest.join(" ")}${tail}`.trim();
    return { words: out, pause, provisional, corrections };
  }

  get hasPending() {
    return this.pendingWords().length > 0;
  }

  /** Anything heard that Soniox has not yet confirmed. */
  get unconfirmed() {
    return this.hasPending || this.tail.trim().length > 0 || this.released.length > 0;
  }

  /**
   * Release whatever is left, as if the speaker had stopped. The words stay
   * tracked, so if final tokens for them arrive later they become
   * corrections rather than repeats.
   */
  flush(): string[] {
    const w = this.pendingWords();
    this.released.push(...w);
    return w;
  }

  /** Start over (a new connection): nothing pending, nothing to correct. */
  reset() {
    this.base += this.released.length;
    this.final = "";
    this.tail = "";
    this.released = [];
  }

  private pendingWords() {
    const hyp = this.instant ? this.final + this.tail : this.final;
    return hyp.split(/\s+/).filter(Boolean).slice(this.released.length);
  }
}

// ───────────────────────────── microphone ─────────────────────────────

/** Runs on the audio thread: float samples → ~50 ms chunks of 16-bit PCM. */
const WORKLET = `
class SonioxTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 20);
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
  /** A word already released was heard differently once Soniox confirmed it. */
  onCorrect?: (c: WordCorrection) => void;
  onStatus?: (s: LiveStatus) => void;
  /** Confirmed-but-unfinished + provisional text: what's being said right now. */
  onProvisional?: (text: string) => void;
  /** Input peak level 0..1, about twenty times a second. */
  onLevel?: (peak: number) => void;
}

/** Silence (no change in what Soniox hears) before forcing finalisation. */
const FINALIZE_AFTER_MS = 450;

/** Errors that a fresh connection will not fix. */
const FATAL = new Set([400, 401, 402]);

export class LiveTranscriber {
  private readonly config: LiveConfig;
  private readonly context: string;
  private readonly cb: LiveCallbacks;
  private readonly words: WordAssembler;

  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private wsReady = false;
  private stopped = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private status: LiveStatus = { state: "idle" };
  private lastProvisional = "";

  /** `context` is the text to prime recognition with; see scriptContext(). */
  constructor(config: LiveConfig, callbacks: LiveCallbacks, context = "") {
    this.config = config;
    this.cb = callbacks;
    this.context = context.trim().slice(0, CONTEXT_CHARS);
    this.words = new WordAssembler(config.instant);
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
    this.clearTimers();
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
      // keep the stream alive through long silences on stage
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = setInterval(() => this.sendControl("keepalive"), 8000);
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
      this.clearTimers();
      this.release(this.words.flush(), true);
      this.words.reset();
      if (this.stopped) return;
      if (fatal) {
        this.fail(this.status.message ?? "Soniox closed the connection.", true);
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleTokens(tokens: SonioxToken[]) {
    const { words, pause, provisional, corrections } = this.words.feed(tokens);
    corrections.forEach((c) => this.cb.onCorrect?.(c));
    this.release(words, pause);
    this.cb.onProvisional?.(provisional);

    // Soniox sends a response for every chunk of audio; an unchanged
    // hypothesis means the speaker has stopped for now
    const changed = provisional !== this.lastProvisional || words.length > 0;
    this.lastProvisional = provisional;
    if (!changed && this.idleTimer) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.idleTimer = this.flushTimer = null;
    if (!this.words.unconfirmed) return;

    // A short silence: ask Soniox to finalise now rather than wait for its
    // endpoint detection, so the last word lands and is confirmed at once.
    this.idleTimer = setTimeout(() => {
      this.sendControl("finalize");
      // and if even that never comes back, release the word anyway
      this.flushTimer = setTimeout(() => {
        this.release(this.words.flush(), false);
        this.cb.onProvisional?.("");
      }, 900);
    }, FINALIZE_AFTER_MS);
  }

  private sendControl(type: "finalize" | "keepalive") {
    if (this.wsReady && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type }));
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.retryTimer = this.idleTimer = this.flushTimer = this.keepaliveTimer = null;
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
