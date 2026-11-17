"use client";

import { useEffect, useRef, useState } from "react";
import { commands, type Command } from "@/lib/commands";
import { Stage, type StageInfo } from "@/lib/engine/stage";
import type { Settings, Source } from "@/lib/settings";
import { LiveTranscriber, scriptContext, type LiveConfig, type LiveStatus } from "@/lib/soniox";

interface Props {
  text: string;
  settings: Settings;
  source: Source;
  live: LiveConfig;
  onExit: () => void;
}

const NEXT_KEYS = new Set([" ", "ArrowRight", "ArrowDown", "PageDown", "Enter"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

export default function StageView({ text, settings, source, live, onExit }: Props) {
  const isLive = source === "live";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState<StageInfo | null>(null);
  const [hud, setHud] = useState(true);
  const [hint, setHint] = useState(true);
  const [idle, setIdle] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const stageRef = useRef<Stage | null>(null);

  // the show itself
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = new Stage(canvas, settings, { onInfo: setInfo, live: isLive });
    stageRef.current = stage;
    void stage.load(isLive ? "" : text, settings);
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

  // live speech: the microphone drives the show
  useEffect(() => {
    if (!isLive) return;
    const t = new LiveTranscriber(live, {
        onWords: (b) => stageRef.current?.appendLive(b),
        onCorrect: (c) => stageRef.current?.correctLive(c.index, c.word),
        onStatus: setLiveStatus,
      }, scriptContext(text, live));
    void t.start();
    return () => t.stop();
    // one session per show (or per retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // keyboard + presentation clickers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isLive && (NEXT_KEYS.has(e.key) || PREV_KEYS.has(e.key))) {
        // the voice drives a live show; keep keys from scrolling or clicking anything
        e.preventDefault();
      } else if (NEXT_KEYS.has(e.key)) {
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
  }, [onExit, isLive]);

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
  const progress = !isLive && info && info.total > 0 ? Math.max(0, Math.min(info.cursor + 1, info.total)) / info.total : 0;
  const liveTrouble = isLive && (liveStatus.state === "error" || liveStatus.state === "reconnecting");

  return (
    <main className={`stage ${idle ? "stage--idle" : ""}`}>
      <canvas
        ref={canvasRef}
        className="stage__canvas"
        onClick={() => {
          if (isLive) return;
          commands.send("next");
          setHint(false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!isLive) commands.send("prev");
        }}
      />

      {isLive ? (
        <div className={`stage__hint ${(hint && info?.cursor === -1 && liveStatus.state === "listening") || (liveTrouble && hud) ? "is-on" : ""}`}>
          {liveTrouble ? liveStatus.message ?? "Live speech stopped." : "Listening. Speak, and the words will appear."}
        </div>
      ) : (
        <div className={`stage__hint ${hint && info?.cursor === -1 ? "is-on" : ""}`}>
          <span className="stage__hint-key">Space</span> to speak the first word
        </div>
      )}

      {info?.ended && <div className={`stage__fin ${showHud ? "is-on" : ""}`}>Exeunt. · R to begin again</div>}

      <div className={`stage__hud ${showHud ? "is-on" : ""}`}>
        <button className="hud-back" onClick={onExit}>
          ← Setup
        </button>
        {isLive && (
          <div className={`hud-live hud-live--${liveStatus.state}`}>
            <i className="hud-live__dot" />
            {LIVE_LABEL[liveStatus.state]}
            {liveStatus.state === "error" && (
              <button className="hud-retry" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            )}
          </div>
        )}
        <div className="hud-keys">
          {!isLive && (
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
          {info ? (isLive ? `${info.total} words` : `${Math.max(0, Math.min(info.cursor + 1, info.total))} / ${info.total}`) : ""}
          {info?.blackout ? " · black" : ""}
        </div>
        <div className="hud-progress" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </main>
  );
}

const LIVE_LABEL: Record<LiveStatus["state"], string> = {
  idle: "Mic off",
  connecting: "Connecting",
  listening: "Listening",
  reconnecting: "Reconnecting",
  error: "Stopped",
};
