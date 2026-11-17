"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LANGUAGES,
  LiveTranscriber,
  listMicrophones,
  scriptContext,
  unlockMicrophoneNames,
  type LiveConfig,
  type LiveStatus,
} from "@/lib/soniox";

interface Props {
  live: LiveConfig;
  onLive: (c: LiveConfig) => void;
  /** null while checking the server. */
  configured: boolean | null;
  /** The script text, offered to Soniox as context. */
  script: string;
  fontFamily: string;
  fontStyle: string;
}

const STATE_LABEL: Record<LiveStatus["state"], string> = {
  idle: "",
  connecting: "Connecting…",
  listening: "Listening",
  reconnecting: "Reconnecting…",
  error: "Stopped",
};

export default function LivePanel({ live, onLive, configured, script, fontFamily, fontStyle }: Props) {
  const set = <K extends keyof LiveConfig>(k: K, v: LiveConfig[K]) => onLive({ ...live, [k]: v });
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<LiveStatus>({ state: "idle" });
  const [heard, setHeard] = useState<string[]>([]);
  const [provisional, setProvisional] = useState("");
  const [level, setLevel] = useState(0);
  const session = useRef<LiveTranscriber | null>(null);
  const spoken = useRef<string[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const refreshMics = useCallback(() => {
    void listMicrophones().then(setMics).catch(() => setMics([]));
  }, []);

  useEffect(() => {
    refreshMics();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshMics);
  }, [refreshMics]);

  const stopTest = useCallback(() => {
    session.current?.stop();
    session.current = null;
    setTesting(false);
    setLevel(0);
    setProvisional("");
  }, []);

  // never leave the microphone open behind the user's back
  useEffect(() => stopTest, [stopTest]);

  // settings changed mid-test: the running session is stale
  useEffect(() => {
    if (session.current) stopTest();
  }, [live, stopTest]);

  const startTest = () => {
    setHeard([]);
    spoken.current = [];
    setProvisional("");
    const t = new LiveTranscriber(
      live,
      {
        onWords: ({ words, pause }) => {
          spoken.current.push(...words);
          setHeard((h) => [...h, ...words, ...(pause && words.length ? ["\n"] : [])].slice(-160));
        },
        onCorrect: ({ index, word }) => {
          // find the word among the last ones shown (line breaks are not words)
          const back = spoken.current.length - index;
          spoken.current[index] = word;
          setHeard((h) => {
            const next = [...h];
            for (let i = next.length - 1, n = 0; i >= 0; i--) {
              if (next[i] === "\n") continue;
              if (++n === back) {
                next[i] = word;
                break;
              }
            }
            return next;
          });
        },
        onStatus: (s) => {
          setStatus(s);
          if (s.state === "error") {
            session.current = null;
            setTesting(false);
            setLevel(0);
          }
        },
        onProvisional: setProvisional,
        onLevel: (p) => setLevel((l) => Math.max(p, l * 0.6)),
      },
      scriptContext(script, live),
    );
    session.current = t;
    setTesting(true);
    void t.start().then(refreshMics);
  };

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [heard, provisional]);

  const named = mics.some((m) => m.label);
  const unknownMic = live.deviceId && mics.length > 0 && !mics.some((m) => m.deviceId === live.deviceId);

  return (
    <div className="live">
      <p className="live__lede">
        Every word appears on stage the moment it is spoken, recognised live by Soniox. No key presses needed.
      </p>

      {configured === false && (
        <p className="live__warn">
          Live speech needs a Soniox key on the server. Put <code>SONIOX_KEY=…</code> in <code>.env.local</code> and restart the app.
        </p>
      )}

      <div className="live__fields">
        <label className="field">
          <span className="field__label">Spoken language</span>
          <select className="field__select" value={live.language} onChange={(e) => set("language", e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code || "auto"} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Microphone</span>
          <select className="field__select" value={live.deviceId} onChange={(e) => set("deviceId", e.target.value)}>
            <option value="">System default</option>
            {mics
              .filter((m) => m.deviceId && m.deviceId !== "default")
              .map((m, i) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || `Microphone ${i + 1}`}
                </option>
              ))}
            {unknownMic && <option value={live.deviceId}>Saved microphone (not connected)</option>}
          </select>
        </label>
      </div>
      {!named && (
        <button className="live__link" onClick={() => void unlockMicrophoneNames().then(refreshMics).catch(() => {})}>
          Show microphone names
        </button>
      )}
      {live.language === "" ? (
        <p className="note">Soniox will work out the language itself. Pick one for better accuracy.</p>
      ) : (
        <p className="note">Recognition is restricted to this language, so similar ones (Slovak, Polish) never slip in.</p>
      )}

      <button
        role="switch"
        aria-checked={live.primeWithScript}
        className={`toggle ${live.primeWithScript ? "is-on" : ""}`}
        onClick={() => set("primeWithScript", !live.primeWithScript)}
      >
        <span className="toggle__box" />
        <span className="toggle__label">Prime with the script</span>
      </button>
      <p className="note">
        Gives Soniox the text from the Script tab as context, so names, quotations and archaic words are recognised. Paste a
        Czech translation there if the speaker will quote it (the built-in English presets are only sent for English).
      </p>

      <button
        role="switch"
        aria-checked={live.instant}
        className={`toggle ${live.instant ? "is-on" : ""}`}
        onClick={() => set("instant", !live.instant)}
      >
        <span className="toggle__box" />
        <span className="toggle__label">Instant words</span>
      </button>
      <p className="note">
        {live.instant
          ? "Words appear as soon as they are heard, and the newest word is corrected if Soniox changes its mind."
          : "Words appear only once Soniox is sure of them: exact, but a second or two behind the voice."}
      </p>

      <div className="live__test">
        <button className="live__btn" onClick={testing ? stopTest : startTest} disabled={configured === false}>
          {testing ? "Stop the test" : "Test the microphone"}
        </button>
        <span className="meter" aria-hidden>
          <i style={{ transform: `scaleX(${Math.min(1, Math.sqrt(level) * 1.2)})` }} />
        </span>
        <span className={`live__state live__state--${status.state}`}>
          {testing || status.state === "error" ? STATE_LABEL[status.state] : ""}
        </span>
      </div>
      {status.state !== "listening" && status.message && (testing || status.state === "error") && (
        <p className="live__msg">{status.message}</p>
      )}

      <div className="live__transcript" ref={transcriptRef} style={{ fontFamily, fontStyle }}>
        {heard.length === 0 && !provisional ? (
          <span className="live__placeholder">
            {testing ? "Say something…" : "Test the microphone to see what Soniox hears. Nothing here reaches the stage."}
          </span>
        ) : (
          <>
            {heard.join(" ").replace(/ ?\n ?/g, "\n")} <span className="live__provisional">{provisional}</span>
          </>
        )}
      </div>
    </div>
  );
}
