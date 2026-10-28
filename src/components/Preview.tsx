"use client";

import { useEffect, useRef } from "react";
import { Stage } from "@/lib/engine/stage";
import type { Settings } from "@/lib/settings";

/** A small rehearsal stage that performs the text on a loop with the current settings. */
export default function Preview({ text, settings }: { text: string; settings: Settings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const stage = new Stage(canvasRef.current!, settingsRef.current, { preview: true });
    stageRef.current = stage;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const beat = () => {
      if (!alive) return;
      const info = stage.info;
      const s = settingsRef.current;
      if (info.ready && info.ended) {
        stage.reset();
        timer = setTimeout(beat, 1800);
        return;
      }
      stage.next();
      const pace = s.mode === "word" ? 0.85 : 0.42;
      timer = setTimeout(beat, pace * 1000);
    };
    timer = setTimeout(beat, 900);
    return () => {
      alive = false;
      clearTimeout(timer);
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  // text changes restart the rehearsal (debounced while typing)
  useEffect(() => {
    const t = setTimeout(() => void stageRef.current?.load(text, settingsRef.current), 350);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    stageRef.current?.setSettings(settings);
  }, [settings]);

  return <canvas ref={canvasRef} className="preview__canvas" aria-label="Live preview" />;
}
