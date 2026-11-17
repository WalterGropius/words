"use client";

import { useEffect, useRef, useState } from "react";
import { commands, type Command } from "@/lib/commands";
import { Stage, type StageInfo } from "@/lib/engine/stage";
import type { Settings } from "@/lib/settings";
import { VoiceListener, type VoiceStatus } from "@/lib/soniox";

interface Props {
  text: string;
  settings: Settings;
  onExit: () => void;
}

const NEXT_KEYS = new Set([" ", "ArrowRight", "ArrowDown", "PageDown", "Enter"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

const VOICE_LABEL: Record<VoiceStatus, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  muted: "Mic muted",
  error: "Mic error",
  stopped: "Mic off",
};

export default function StageView({ text, settings, onExit }: Props) {
  const voice = settings.source === "voice";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const listenerRef = useRef<VoiceListener | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<{ status: VoiceStatus; detail?: string }>({ status: "connecting" });
  const [caption, setCaption] = useState({ settled: "", pending: "" });
  const [info, setInfo] = useState<StageInfo | null>(null);
  const [hud, setHud] = useState(true);
  const [hint, setHint] = useState(true);
  const [idle, setIdle] = useState(false);

  // the show itself
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = new Stage(canvas, settings, { onInfo: setInfo });
    stageRef.current = stage;
    void (voice ? stage.listen(settings) : stage.load(text, settings));
    const unsub = commands.subscribe((cmd: Command) => {
      if (cmd === "next") stage.next();
      else if (cmd === "prev") stage.prev();
      else if (cmd === "reset") stage.reset();
      else if (cmd === "blackout") stage.toggleBlackout();
    });
    // handy for rehearsal from the devtools console, and for a future remote
    (window as unknown as { words?: typeof commands }).words = commands;
    return () => {
      unsub();
      stage.dispose();
      stageRef.current = null;
    };
    // the stage is built once per show; settings are fixed while performing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the microphone, in voice mode
  useEffect(() => {
    if (!voice) return;
    const listener = new VoiceListener({
      language: settings.language,
      context: text,
      ...(settings.liveTranscript
        ? {
            onSegment: (words: string[], done: boolean) => {
              stageRef.current?.transcribe(words);
              if (done) stageRef.current?.endSegment();
              if (words.length) setHint(false);
            },
          }
        : {
            onWord: (w: string) => {
              stageRef.current?.speak(w);
              setHint(false);
            },
            onPause: () => stageRef.current?.pause(),
          }),
      onCaption: (settled, pending) => setCaption({ settled, pending }),
      onStatus: (status, detail) => setVoiceStatus({ status, detail }),
    });
    listenerRef.current = listener;
    void listener.start();
    return () => {
      listener.stop();
      listenerRef.current = null;
    };
    // one listener per show, like the stage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyboard + presentation clickers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (NEXT_KEYS.has(e.key)) {
        e.preventDefault();
        if (!e.repeat) commands.send("next");
        setHint(false);
      } else if (PREV_KEYS.has(e.key)) {
        e.preventDefault();
        if (!e.repeat) commands.send("prev");
      } else if (e.key === "b" || e.key === "B" || e.key === ".") {
        commands.send("blackout");
      } else if (e.key === "r" || e.key === "R") {
        commands.send("reset");
      } else if ((e.key === "m" || e.key === "M") && listenerRef.current) {
        listenerRef.current.setMuted(!listenerRef.current.isMuted);
      } else if (e.key === "h" || e.key === "H") {
        setHud((v) => !v);
      } else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      } else if (e.key === "Escape" && !document.fullscreenElement) {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  // hide the cursor and hints when nobody's touching anything
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2200);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const showHud = hud && !idle;
  const progress = info && info.total > 0 ? Math.max(0, Math.min(info.cursor + 1, info.total)) / info.total : 0;

  return (
    <main className={`stage ${idle ? "stage--idle" : ""}`}>
      <canvas
        ref={canvasRef}
        className="stage__canvas"
        onClick={() => {
          commands.send("next");
          setHint(false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          commands.send("prev");
        }}
      />

      <div className={`stage__hint ${hint && info?.cursor === -1 && voiceStatus.status !== "error" ? "is-on" : ""}`}>
        {voice ? (
          voiceStatus.status === "listening" ? (
            "Listening. Begin speaking"
          ) : (
            VOICE_LABEL[voiceStatus.status]
          )
        ) : (
          <>
            <span className="stage__hint-key">Space</span> to speak the first word
          </>
        )}
      </div>

      {voice && voiceStatus.status === "error" && <div className="stage__error">{voiceStatus.detail}</div>}

      {voice && (
        <div className={`stage__caption ${showHud ? "is-on" : ""}`}>
          {caption.settled.slice(-160)}
          <span className="stage__caption-pending">{caption.pending}</span>
        </div>
      )}

      {info?.ended && <div className={`stage__fin ${showHud ? "is-on" : ""}`}>Exeunt. · R to begin again</div>}

      <div className={`stage__hud ${showHud ? "is-on" : ""}`}>
        <button className="hud-back" onClick={onExit}>
          ← Setup
        </button>
        {voice && (
          <div className={`hud-mic hud-mic--${voiceStatus.status}`} title={voiceStatus.detail}>
            <i className="hud-mic__dot" />
            {VOICE_LABEL[voiceStatus.status]}
            {voiceStatus.status === "connecting" && voiceStatus.detail ? ` · ${voiceStatus.detail}` : ""}
          </div>
        )}
        <div className="hud-keys">
          {voice ? (
            <span><kbd>M</kbd> mute</span>
          ) : (
            <>
              <span><kbd>Space</kbd> next</span>
              <span><kbd>←</kbd> back</span>
            </>
          )}
          <span><kbd>B</kbd> black</span>
          <span><kbd>R</kbd> restart</span>
          <span><kbd>F</kbd> fullscreen</span>
          <span><kbd>H</kbd> hide</span>
        </div>
        <div className="hud-count">
          {info ? (voice ? `${info.total} words` : `${Math.max(0, Math.min(info.cursor + 1, info.total))} / ${info.total}`) : ""}
          {info?.blackout ? " · black" : ""}
        </div>
        {!voice && <div className="hud-progress" style={{ transform: `scaleX(${progress})` }} />}
      </div>
    </main>
  );
}
