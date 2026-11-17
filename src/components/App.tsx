"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, loadPersisted, savePersisted, type Settings } from "@/lib/settings";
import { TEXTS } from "@/lib/texts";
import Setup from "./Setup";
import StageView from "./StageView";

export default function App() {
  const [phase, setPhase] = useState<"setup" | "stage">("setup");
  const [text, setText] = useState(TEXTS[0].text);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = loadPersisted();
    if (p.text) setText(p.text);
    if (p.settings) setSettings(p.settings);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) savePersisted({ text, settings });
  }, [text, settings, hydrated]);

  const play = useCallback(() => setPhase("stage"), []);
  const back = useCallback(() => setPhase("setup"), []);

  if (!hydrated) return <main className="boot" />;

  return phase === "setup" ? (
    <Setup text={text} onText={setText} settings={settings} onSettings={setSettings} onPlay={play} />
  ) : (
    <StageView text={text} settings={settings} onExit={back} />
  );
}
