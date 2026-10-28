"use client";

import { useEffect, useRef, useState } from "react";
import { commands, type Command } from "@/lib/commands";
import { Stage, type StageInfo } from "@/lib/engine/stage";
import type { Settings } from "@/lib/settings";

interface Props {
  text: string;
  settings: Settings;
  onExit: () => void;
}

const NEXT_KEYS = new Set([" ", "ArrowRight", "ArrowDown", "PageDown", "Enter"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

export default function StageView({ text, settings, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState<StageInfo | null>(null);
  const [hud, setHud] = useState(true);
  const [hint, setHint] = useState(true);
  const [idle, setIdle] = useState(false);

  // the show itself
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = new Stage(canvas, settings, { onInfo: setInfo });
    void stage.load(text, settings);
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
    };
    // the stage is built once per show; settings are fixed while performing
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

      <div className={`stage__hint ${hint && info?.cursor === -1 ? "is-on" : ""}`}>
        <span className="stage__hint-key">Space</span> to speak the first word
      </div>

      {info?.ended && <div className={`stage__fin ${showHud ? "is-on" : ""}`}>Exeunt. · R to begin again</div>}

      <div className={`stage__hud ${showHud ? "is-on" : ""}`}>
        <button className="hud-back" onClick={onExit}>
          ← Setup
        </button>
        <div className="hud-keys">
          <span><kbd>Space</kbd> next</span>
          <span><kbd>←</kbd> back</span>
          <span><kbd>B</kbd> black</span>
          <span><kbd>R</kbd> restart</span>
          <span><kbd>F</kbd> fullscreen</span>
          <span><kbd>H</kbd> hide</span>
        </div>
        <div className="hud-count">
          {info ? `${Math.max(0, Math.min(info.cursor + 1, info.total))} / ${info.total}` : ""}
          {info?.blackout ? " · black" : ""}
        </div>
        <div className="hud-progress" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </main>
  );
}
