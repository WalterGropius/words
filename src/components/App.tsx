"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, loadPersisted, savePersisted, type Settings, type Source } from "@/lib/settings";
import { DEFAULT_LIVE, type LiveConfig } from "@/lib/soniox";
import { TEXTS } from "@/lib/texts";
import Setup from "./Setup";
import StageView from "./StageView";

export default function App() {
  const [phase, setPhase] = useState<"setup" | "stage">("setup");
  const [text, setText] = useState(TEXTS[0].text);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState<Source>("script");
  const [live, setLive] = useState<LiveConfig>(DEFAULT_LIVE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = loadPersisted();
    if (p.text) setText(p.text);
    if (p.settings) setSettings(p.settings);
    if (p.source) setSource(p.source);
    if (p.live) setLive(p.live);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) savePersisted({ text, settings, source, live });
  }, [text, settings, source, live, hydrated]);

  const play = useCallback(() => setPhase("stage"), []);
  const back = useCallback(() => setPhase("setup"), []);

  if (!hydrated) return <main className="boot" />;

  return phase === "setup" ? (
    <Setup
      text={text}
      onText={setText}
      settings={settings}
      onSettings={setSettings}
      source={source}
      onSource={setSource}
      live={live}
      onLive={setLive}
      onPlay={play}
    />
  ) : (
    <StageView text={text} settings={settings} source={source} live={live} onExit={back} />
  );
}
