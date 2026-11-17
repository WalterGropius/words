/**
 * Live speech-to-text from the microphone through Soniox's real-time API.
 *
 * The mic is recorded as WebM/Opus and streamed to Soniox over a WebSocket
 * ("auto" audio format). Two views of the transcript are offered:
 *  - onWord: finalized words one at a time (stable, but Soniox may only
 *    finalize at the end of a sentence);
 *  - onSegment: the current sentence as heard so far, provisional words
 *    included, so it can be shown live and corrected as Soniox revises it.
 * If the connection drops mid-show it reconnects on its own with a fresh key.
 */

const SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const MODEL = "stt-rt-v6";
/** Soniox allows ~8,000 tokens of context; stay well under it. */
const MAX_CONTEXT_CHARS = 6000;
const CAPTION_CHARS = 220;
/** A word still being spoken is shown once the next one starts, or after this much quiet. */
const TRAILING_WORD_MS = 600;

export type VoiceStatus = "connecting" | "listening" | "muted" | "error" | "stopped";

export interface VoiceOptions {
  /** ISO code such as "en", or "" to let Soniox detect the language. */
  language: string;
  /** Background text (e.g. the script) that biases recognition toward its vocabulary. */
  context?: string;
  onWord?: (word: string) => void;
  /**
   * The current segment's words so far (final and provisional). Earlier
   * entries can change between calls; `done` means the segment is final.
   */
  onSegment?: (words: string[], done: boolean) => void;
  /** The speaker paused: Soniox closed a segment. */
  onPause?: () => void;
  /** Recent transcript for the operator: settled text plus the still-changing tail. */
  onCaption?: (settled: string, pending: string) => void;
  onStatus?: (status: VoiceStatus, detail?: string) => void;
}

interface SonioxToken {
  text: string;
  is_final: boolean;
}

interface SonioxMessage {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number;
  error_type?: string;
  error_message?: string;
}

/** Errors that a reconnect won't fix. */
const FATAL_ERRORS = new Set(["unauthenticated", "invalid_request", "forbidden", "payment_required"]);

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

async function fetchKey(): Promise<string> {
  const res = await fetch("/api/soniox-key", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { apiKey?: string; error?: string };
  if (!res.ok || !body.apiKey) throw new FatalError(body.error ?? `Key request failed (${res.status})`);
  return body.apiKey;
}

class FatalError extends Error {}

const splitWords = (text: string) => text.split(/\s+/).filter(Boolean);

export class VoiceListener {
  private readonly opts: VoiceOptions;
  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private stopped = false;
  private muted = false;

  private partial = "";
  private settled = "";
  /** Final text of the current segment (since the last endpoint). */
  private segmentFinal = "";
  private hypothesis = "";
  private trailingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: VoiceOptions) {
    this.opts = opts;
  }

  async start() {
    this.status("connecting");
    const mimeType = pickMimeType();
    if (!mimeType) {
      this.fail("This browser can't stream audio in a format Soniox accepts. Use Chrome, Edge or Firefox.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
    } catch (err) {
      const name = (err as DOMException).name;
      this.fail(
        name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the browser's address bar and try again."
          : name === "NotFoundError"
            ? "No microphone found."
            : `Could not open the microphone: ${(err as Error).message}`,
      );
      return;
    }
    await this.connect(mimeType);
  }

  /** Stop sending audio without dropping the connection (for banter between readings). */
  setMuted(muted: boolean) {
    if (this.muted === muted || this.stopped) return;
    this.muted = muted;
    if (muted) {
      // the finalize below closes the segment with a <fin>
      if (this.recorder?.state === "recording") this.recorder.pause();
      this.send(JSON.stringify({ type: "finalize" }));
    } else if (this.recorder?.state === "paused") {
      this.recorder.resume();
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.status(muted ? "muted" : "listening");
  }

  get isMuted() {
    return this.muted;
  }

  stop() {
    if (this.shutdown()) this.status("stopped");
  }

  private shutdown(): boolean {
    if (this.stopped) return false;
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.teardownConnection(true);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    return true;
  }

  // ───────────────────────────── connection ─────────────────────────────

  private async connect(mimeType: string) {
    let key: string;
    try {
      key = await fetchKey();
    } catch (err) {
      if (err instanceof FatalError) this.fail(err.message);
      else this.scheduleRetry(mimeType, (err as Error).message);
      return;
    }
    if (this.stopped || !this.stream) return;

    const ws = new WebSocket(SONIOX_URL, ["soniox-api-key", key]);
    this.ws = ws;
    let fatal = false;

    ws.onopen = () => {
      if (this.stopped || !this.stream) return;
      const context = this.opts.context?.trim().slice(0, MAX_CONTEXT_CHARS);
      ws.send(
        JSON.stringify({
          model: MODEL,
          audio_format: "auto",
          language_hints: this.opts.language ? [this.opts.language] : undefined,
          enable_endpoint_detection: true,
          context: context ? { text: context } : undefined,
        }),
      );
      const recorder = new MediaRecorder(this.stream!, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      recorder.start(100);
      if (this.muted) recorder.pause();
      this.recorder = recorder;
      // only matters while muted: Soniox ends a stream after 20s without data
      this.keepalive = setInterval(() => {
        if (this.muted) this.send(JSON.stringify({ type: "keepalive" }));
      }, 10_000);
      this.status(this.muted ? "muted" : "listening");
    };

    ws.onmessage = (e) => {
      let msg: SonioxMessage;
      try {
        msg = JSON.parse(e.data as string) as SonioxMessage;
      } catch {
        return;
      }
      if (msg.error_code) {
        fatal = FATAL_ERRORS.has(msg.error_type ?? "");
        const detail = `Soniox: ${msg.error_message ?? msg.error_type ?? msg.error_code}`;
        if (fatal) this.fail(detail);
        else this.status("connecting", detail);
        return;
      }
      if (msg.tokens?.length) {
        this.retries = 0;
        this.onTokens(msg.tokens);
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.teardownConnection(false);
      if (!this.stopped && !fatal) this.scheduleRetry(mimeType, "Connection lost, reconnecting…");
    };
  }

  private scheduleRetry(mimeType: string, detail: string) {
    if (this.stopped) return;
    this.status("connecting", detail);
    const delay = Math.min(10_000, 800 * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => void this.connect(mimeType), delay);
  }

  private teardownConnection(graceful: boolean) {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onclose = null;
    if (graceful && ws.readyState === WebSocket.OPEN) {
      // an empty text frame asks Soniox to finish the stream cleanly
      ws.send("");
      setTimeout(() => ws.close(), 1500);
    } else {
      ws.close();
    }
    this.flushPartial();
    this.endSegment();
  }

  private send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  // ───────────────────────────── transcript ─────────────────────────────

  private onTokens(tokens: SonioxToken[]) {
    let pending = "";
    for (const t of tokens) {
      if (!t.is_final) {
        if (!t.text.startsWith("<")) pending += t.text;
        continue;
      }
      if (t.text === "<end>" || t.text === "<fin>") {
        this.flushPartial();
        this.endSegment();
        this.opts.onPause?.();
        continue;
      }
      this.settled = (this.settled + t.text).slice(-CAPTION_CHARS);
      this.segmentFinal += t.text;
      // final text arrives in pieces ("Hel", "lo", " ", "world"): a word is done at whitespace
      const parts = (this.partial + t.text).split(/\s+/);
      this.partial = parts.pop() ?? "";
      for (const w of parts) if (w) this.opts.onWord?.(w);
    }
    this.opts.onCaption?.(this.settled, pending);
    this.updateHypothesis(this.segmentFinal + pending);
  }

  private updateHypothesis(text: string) {
    if (text === this.hypothesis) return;
    this.hypothesis = text;
    if (this.trailingTimer) clearTimeout(this.trailingTimer);
    this.trailingTimer = null;
    if (!this.opts.onSegment) return;
    // hold back a word that may still be growing ("otáz" → "otázka") until it's clearly over
    const words = splitWords(text);
    if (words.length && !/\s$/.test(text)) {
      words.pop();
      this.trailingTimer = setTimeout(() => this.opts.onSegment?.(splitWords(this.hypothesis), false), TRAILING_WORD_MS);
    }
    this.opts.onSegment(words, false);
  }

  private endSegment() {
    if (this.trailingTimer) clearTimeout(this.trailingTimer);
    this.trailingTimer = null;
    const words = splitWords(this.segmentFinal);
    this.segmentFinal = "";
    this.hypothesis = "";
    this.opts.onSegment?.(words, true);
  }

  private flushPartial() {
    const w = this.partial.trim();
    this.partial = "";
    if (w) this.opts.onWord?.(w);
  }

  private status(s: VoiceStatus, detail?: string) {
    this.opts.onStatus?.(s, detail);
  }

  private fail(detail: string) {
    this.shutdown();
    this.status("error", detail);
  }
}
