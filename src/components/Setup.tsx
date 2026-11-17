"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FONTS } from "@/lib/fonts";
import {
  DEFAULT_BANNED,
  DEFAULT_SETTINGS,
  LOOKS,
  MODE_DEFAULTS,
  type Entrance,
  type Exit,
  type Mode,
  type Settings,
  type Source,
} from "@/lib/settings";
import { VoiceListener, type VoiceStatus } from "@/lib/soniox";
import { TEXTS } from "@/lib/texts";
import Preview from "./Preview";
import Setups from "./Setups";

interface Props {
  text: string;
  onText: (t: string) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onPlay: () => void;
}

const MODES: { value: Mode; label: string; blurb: string }[] = [
  { value: "word", label: "Word", blurb: "One word at a time, centre stage. Each press sends the last one away." },
  { value: "line", label: "Line", blurb: "Words light up in place along the verse line; the line departs when done." },
  { value: "page", label: "Page", blurb: "The whole passage waits in shadow and is revealed word by word." },
  {
    value: "paragraph",
    label: "Paragraph",
    blurb: "Words gather into a paragraph somewhere on the stage; the next begins elsewhere as the last one leaves.",
  },
];

const SOURCES: { value: Source; label: string }[] = [
  { value: "script", label: "Script" },
  { value: "voice", label: "Voice (Soniox)" },
];

const LANGUAGES: { value: string; label: string }[] = [
  { value: "cs", label: "Čeština" },
  { value: "en", label: "English" },
  { value: "", label: "Detect" },
];

const ENTRANCES: { value: Entrance; label: string }[] = [
  { value: "nebula", label: "Nebula" },
  { value: "fade", label: "Ink" },
  { value: "quill", label: "Quill" },
  { value: "rise", label: "Rise" },
  { value: "arrive", label: "Arrive" },
  { value: "materialize", label: "Gather" },
];

const EXITS: { value: Exit; label: string }[] = [
  { value: "smoke", label: "Smoke" },
  { value: "fall", label: "Fall" },
  { value: "rise", label: "Ascend" },
  { value: "drift", label: "Recede" },
  { value: "dissolve", label: "Dissolve" },
  { value: "scatter", label: "Scatter" },
  { value: "fade", label: "Fade" },
];

const ENTRANCE_NOTES: Record<Entrance, string> = {
  nebula: "Condenses out of a soft cosmic cloud, like smoke gathering into letters.",
  fade: "Bleeds in from soft focus, like wet ink.",
  quill: "Written left to right with a glowing nib.",
  rise: "Lifts gently into place.",
  arrive: "Letters fly in from the dark, out of focus.",
  materialize: "Sparks gather and condense into the word.",
};

const EXIT_NOTES: Record<Exit, string> = {
  smoke: "Thins into smoke that a draft carries off, curling and spreading until it's gone.",
  fall: "Letters loosen and drift down under a gentle gravity.",
  rise: "Letters float upward like embers and smoke.",
  drift: "The word sinks back into the darkness, out of focus.",
  dissolve: "Burns away into dust carried on a breeze.",
  scatter: "Bursts apart in three dimensions.",
  fade: "Simply fades.",
};

type Tab = "mode" | "type" | "motion" | "fog" | "air";
const TABS: { id: Tab; label: string }[] = [
  { id: "mode", label: "Mode" },
  { id: "type", label: "Typeface" },
  { id: "motion", label: "Entrance & Exit" },
  { id: "fog", label: "Fog" },
  { id: "air", label: "Atmosphere" },
];

export default function Setup({ text, onText, settings, onSettings, onPlay }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onSettings({ ...settings, [key]: value });
  const s = settings;

  const stats = useMemo(() => {
    const lines = text.split("\n").filter((l) => l.trim()).length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const secs = Math.round(words / 2.2);
    return { lines, words, time: secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s` };
  }, [text]);

  const activePreset = TEXTS.find((t) => t.text.trim() === text.trim())?.id;
  const activeLook = LOOKS.find((l) => Object.entries(l.settings).every(([k, v]) => s[k as keyof Settings] === v))?.id;
  const font = FONTS.find((f) => f.id === s.font) ?? FONTS[0];
  const voice = s.source === "voice";
  const needsCzech = (voice && s.language === "cs") || /[ěščřžťďňůĚŠČŘŽŤĎŇŮ]/.test(text);

  // a face without Czech letters: move to one that has them when Czech is chosen
  const setSource = (source: Source) =>
    onSettings({ ...settings, source, ...(source === "voice" && s.language === "cs" && !font.czech ? { font: "garamond" as const } : {}) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onPlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlay]);

  const canPlay = voice || stats.words > 0;

  const fogUsed = s.entrance === "nebula" || s.exit === "smoke";
  const tabs = TABS.filter((t) => t.id !== "fog" || fogUsed);
  const [tabChoice, setTabChoice] = useState<Tab>("mode");
  useEffect(() => {
    try {
      const t = localStorage.getItem("words.setupTab") as Tab | null;
      if (t && TABS.some((x) => x.id === t)) setTabChoice(t);
    } catch {
      // ignore
    }
  }, []);
  const chooseTab = (t: Tab) => {
    setTabChoice(t);
    try {
      localStorage.setItem("words.setupTab", t);
    } catch {
      // ignore
    }
  };
  const tab: Tab = tabs.some((t) => t.id === tabChoice) ? tabChoice : "mode";

  return (
    <main className="setup">
      <header className="setup__header">
        <div className="brand">
          <h1 className="brand__title">
            Words, words, words<span className="brand__dot">.</span>
          </h1>
          <p className="brand__sub">
            <em>Hamlet</em>, II.ii &nbsp;·&nbsp; a theatre for text
          </p>
        </div>
        <p className="setup__intro">
          {voice ? (
            <>Set the stage, raise the curtain, and speak. Each word appears as you say it.</>
          ) : (
            <>
              Paste a text, set the stage, raise the curtain. Then press <kbd>Space</kbd> as each word is spoken.
            </>
          )}
        </p>
      </header>

      <div className="setup__body">
        {/* ─────────────── I. The text ─────────────── */}
        <section className="col col--text">
          <h2 className="act">
            <span className="act__num">I.</span> The Text
          </h2>
          <Segmented value={s.source} options={SOURCES} onChange={setSource} />
          {voice && (
            <div className="voice">
              <div className="row">
                <span className="voice__label">Language</span>
                <Segmented value={s.language} options={LANGUAGES} onChange={(v) => set("language", v)} />
              </div>
              <Toggle label="Live transcript" value={s.liveTranscript} onChange={(v) => set("liveTranscript", v)} />
              <p className="note">
                {s.liveTranscript
                  ? "Words appear the moment they're heard and run on as sentences across the stage. If Soniox changes its mind about a word, it's quietly rewritten."
                  : "Words appear only once Soniox is sure of them, often at the end of a sentence, and follow the Mode below."}
              </p>
              <label className="voice__field">
                <span className="voice__label">Never show these words</span>
                <textarea
                  className="voice__banned"
                  rows={2}
                  value={s.banned}
                  onChange={(e) => set("banned", e.target.value)}
                  spellCheck={false}
                  placeholder="hm, ehm, eh, uh…"
                />
              </label>
              <p className="note">
                Hesitations and fillers, separated by commas. Drawn-out spellings count too: <em>hm</em> also catches <em>hmmm</em>,{" "}
                <em>eh</em> catches <em>ehhh</em>. The transcript at the bottom still shows them.{" "}
                {s.banned !== DEFAULT_BANNED && (
                  <button className="voice__link" onClick={() => set("banned", DEFAULT_BANNED)}>
                    Restore the Czech defaults
                  </button>
                )}
              </p>
              <MicTest language={s.language} context={text} />
              <p className="note">
                Words appear on stage as Soniox recognises them. The text below is sent along as a vocabulary hint, so names and
                old words are heard correctly. On stage, <kbd>M</kbd> mutes the mic.
              </p>
            </div>
          )}
          <div className="chips">
            {TEXTS.map((t) => (
              <button key={t.id} className={`chip ${activePreset === t.id ? "is-active" : ""}`} onClick={() => onText(t.text)}>
                {t.title}
              </button>
            ))}
          </div>
          <div className="script">
            <textarea
              className="script__area"
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder="Paste your text here. Line breaks are kept; blank lines separate stanzas."
              spellCheck={false}
              style={{ fontFamily: font.family, fontStyle: s.italic && font.hasItalic ? "italic" : "normal" }}
            />
          </div>
          <p className="meta">
            {voice ? (
              <>Vocabulary hint &nbsp;·&nbsp; {stats.words} words</>
            ) : (
              <>
                {stats.lines} lines &nbsp;·&nbsp; {stats.words} words &nbsp;·&nbsp; about {stats.time} spoken
              </>
            )}
          </p>
        </section>

        {/* ─────────────── II. The stage ─────────────── */}
        <section className="col col--stage">
          <h2 className="act">
            <span className="act__num">II.</span> The Stage
          </h2>

          <div className="preview-dock">
            <div className="preview">
              <Preview text={text} settings={settings} />
              <span className="preview__label">Rehearsal</span>
              <i className="corner corner--tl" />
              <i className="corner corner--tr" />
              <i className="corner corner--bl" />
              <i className="corner corner--br" />
            </div>
          </div>

          <Setups
            settings={settings}
            text={text}
            onLoad={(next, t) => {
              onSettings(next);
              if (t !== undefined) onText(t);
            }}
          />

          <div className="looks-head">
            <h3 className="setups__title">Looks</h3>
            <span className="note">Starting points: they change the effects, not the text or the voice setup.</span>
          </div>
          <div className="looks">
            {LOOKS.map((l) => (
              <button
                key={l.id}
                className={`look ${activeLook === l.id ? "is-active" : ""}`}
                onClick={() => onSettings({ ...settings, ...l.settings })}
                title={l.blurb}
              >
                <span className="look__name">{l.name}</span>
                <span className="look__blurb">{l.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ─────────────── III. The staging ─────────────── */}
        <section className="col col--controls">
          <h2 className="act">
            <span className="act__num">III.</span> The Staging
          </h2>
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tabs__tab ${tab === t.id ? "is-active" : ""}`}
                onClick={() => chooseTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="tabpanel" role="tabpanel">
            {tab === "mode" && (
              <>
              <Group title="Mode">
                <div className="modes">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      className={`mode ${s.mode === m.value ? "is-active" : ""}`}
                      onClick={() => onSettings({ ...settings, mode: m.value, ...MODE_DEFAULTS[m.value] })}
                    >
                      <span className="mode__label">{m.label}</span>
                      <span className="mode__blurb">{m.blurb}</span>
                    </button>
                  ))}
                </div>
                {s.mode === "word" && (
                  <>
                    <Slider label="Wander" value={s.jitter} min={0} max={1} step={0.05} onChange={(v) => set("jitter", v)} format={pct} />
                    <Slider
                      label="Leave on its own after"
                      value={s.autoExit}
                      min={0}
                      max={15}
                      step={0.5}
                      onChange={(v) => set("autoExit", v)}
                      format={(v) => (v === 0 ? "never" : `${v}s`)}
                    />
                  </>
                )}
                {s.mode === "line" && (
                  <Slider label="Lines at once" value={s.linesAtOnce} min={1} max={4} step={1} onChange={(v) => set("linesAtOnce", v)} format={(v) => `${v}`} />
                )}
                {s.mode === "page" && (
                  <Slider label="Max lines per page" value={s.maxPageLines} min={4} max={24} step={1} onChange={(v) => set("maxPageLines", v)} format={(v) => `${v}`} />
                )}
                {s.mode === "paragraph" && (
                  <>
                    <Slider label="Lines per paragraph" value={s.paragraphLines} min={2} max={10} step={1} onChange={(v) => set("paragraphLines", v)} format={(v) => `${v}`} />
                    <Slider label="Paragraph width" value={s.paragraphWidth} min={0.25} max={0.7} step={0.01} onChange={(v) => set("paragraphWidth", v)} format={pct} />
                    <Slider label="Each word stays readable for" value={s.paragraphLinger} min={0.25} max={20} step={0.25} onChange={(v) => set("paragraphLinger", v)} format={secs} />
                    <Slider label="Then leaves over" value={s.paragraphFade} min={0.3} max={6} step={0.1} onChange={(v) => set("paragraphFade", v)} format={secs} />
                    <Slider label="Spoken words" value={s.spokenLevel} min={0.1} max={1} step={0.01} onChange={(v) => set("spokenLevel", v)} format={pct} />
                    <div className="row">
                      {voice ? (
                        <Toggle label="New paragraph after a pause" value={s.paragraphOnPause} onChange={(v) => set("paragraphOnPause", v)} />
                      ) : (
                        <Toggle label="New paragraph at stanza" value={s.stanzaBreaks} onChange={(v) => set("stanzaBreaks", v)} />
                      )}
                    </div>
                    <p className="note">
                      Each word forms with the entrance effect, stays readable for a set time, then leaves with the exit effect below,
                      so the paragraph clears away as it is being written. A new paragraph begins elsewhere when this one is full
                      {voice ? ", or at a pause once it has a few words" : ""}.
                    </p>
                  </>
                )}
                {(s.mode === "line" || s.mode === "page") && (
                  <>
                    <Slider label="Unspoken words" value={s.ghost} min={0} max={0.45} step={0.01} onChange={(v) => set("ghost", v)} format={(v) => (v === 0 ? "hidden" : pct(v))} />
                    <Slider label="Spoken words" value={s.spokenLevel} min={0.1} max={1} step={0.01} onChange={(v) => set("spokenLevel", v)} format={pct} />
                    <div className="row">
                      <Segmented
                        value={s.align}
                        options={[
                          { value: "center", label: "Centred" },
                          { value: "left", label: "Book" },
                        ]}
                        onChange={(v) => set("align", v)}
                      />
                      <Toggle label="New page at stanza" value={s.stanzaBreaks} onChange={(v) => set("stanzaBreaks", v)} />
                    </div>
                  </>
                )}
              </Group>

              </>
            )}
            {tab === "type" && (
              <>
              <Group title="Typeface">
                <div className="fonts">
                  {FONTS.map((f) => (
                    <button
                      key={f.id}
                      className={`font ${s.font === f.id ? "is-active" : ""} ${needsCzech && !f.czech ? "is-lacking" : ""}`}
                      onClick={() => set("font", f.id)}
                      title={needsCzech && !f.czech ? "No Czech letters (ř, ě, ů…): they would show in a fallback face" : undefined}
                    >
                      <span className="font__sample" style={{ fontFamily: f.family }}>
                        {f.id === "cinzel" || f.id === "cinzel-decorative" ? "Thou Art" : "Thou art"}
                      </span>
                      <span className="font__name">{f.label}</span>
                    </button>
                  ))}
                </div>
                {needsCzech && !font.czech && (
                  <p className="note note--warn">{font.label} has no Czech letters (ř, ě, ů…). Choose another typeface.</p>
                )}
                <Slider label="Size" value={s.size} min={0.4} max={2} step={0.05} onChange={(v) => set("size", v)} format={(v) => `${Math.round(v * 100)}%`} />
                <div className="row">
                  <Toggle label="Italic" value={s.italic && font.hasItalic} disabled={!font.hasItalic} onChange={(v) => set("italic", v)} />
                  <Toggle label="Capitals" value={s.caps} onChange={(v) => set("caps", v)} />
                  <Toggle label="Long ſ (Folio spelling)" value={s.longS} onChange={(v) => set("longS", v)} />
                </div>
              </Group>

              </>
            )}
            {tab === "motion" && (
              <>
              <Group title="Entrance">
                <Segmented value={s.entrance} options={ENTRANCES} onChange={(v) => set("entrance", v)} />
                <p className="note">{ENTRANCE_NOTES[s.entrance]}</p>
                <Slider label="Duration" value={s.entranceDuration} min={0.2} max={4} step={0.1} onChange={(v) => set("entranceDuration", v)} format={secs} />
                {s.entrance !== "quill" && (
                  <Slider label="Letter stagger" value={s.entranceStagger} min={0} max={1} step={0.05} onChange={(v) => set("entranceStagger", v)} format={pct} />
                )}
              </Group>

              <Group title="Exit">
                <Segmented value={s.exit} options={EXITS} onChange={(v) => set("exit", v)} />
                <p className="note">{EXIT_NOTES[s.exit]}</p>
                <Slider label="Duration" value={s.exitDuration} min={0.5} max={12} step={0.25} onChange={(v) => set("exitDuration", v)} format={secs} />
                {s.exit !== "dissolve" && (
                  <Slider label="Letter stagger" value={s.exitStagger} min={0} max={1} step={0.05} onChange={(v) => set("exitStagger", v)} format={pct} />
                )}
                <Slider label="Gravity" value={s.gravity} min={0} max={1} step={0.05} onChange={(v) => set("gravity", v)} format={pct} />
                <Slider label="Turbulence" value={s.turbulence} min={0} max={1} step={0.05} onChange={(v) => set("turbulence", v)} format={pct} />
              </Group>

              </>
            )}
            {tab === "fog" && (
              <>
              <Group title="Fog">
                <Slider label="Fog size" value={s.fogSize} min={0.5} max={2.5} step={0.05} onChange={(v) => set("fogSize", v)} format={pct} />
                <Slider label="Fog strength" value={s.fogStrength} min={0.2} max={1.5} step={0.05} onChange={(v) => set("fogStrength", v)} format={pct} />
                <p className="note">How large the nebula and smoke around each word are, and how visible. Larger fog reads best a little fainter.</p>
                <Slider label="Noise layers" value={s.smokeLayers} min={1} max={4} step={1} onChange={(v) => set("smokeLayers", v)} format={(v) => `${v}`} />
                <Slider label="Noise intensity" value={s.smokeNoise} min={0} max={1} step={0.05} onChange={(v) => set("smokeNoise", v)} format={pct} />
                <Slider label="Noise contrast" value={s.smokeContrast} min={0.5} max={3} step={0.05} onChange={(v) => set("smokeContrast", v)} format={(v) => `${v.toFixed(2)}×`} />
                <p className="note">Each puff is a soft radial gradient multiplied through a smoke texture at a random, slowly turning angle. More layers add finer wisps (one texture lookup each) — 2 is plenty on most displays.</p>
              </Group>
              </>
            )}
            {tab === "air" && (
              <>
              <Group title="Atmosphere">
                <Slider label="Glow" value={s.glow} min={0} max={1.5} step={0.05} onChange={(v) => set("glow", v)} format={pct} />
                <Slider label="Breathing" value={s.breathing} min={0} max={1} step={0.05} onChange={(v) => set("breathing", v)} format={pct} />
                <Slider label="Camera drift" value={s.cameraDrift} min={0} max={1} step={0.05} onChange={(v) => set("cameraDrift", v)} format={pct} />
                <Slider label="Stage dust" value={s.dust} min={0} max={1} step={0.05} onChange={(v) => set("dust", v)} format={(v) => (v === 0 ? "none" : pct(v))} />
                <Slider label="Film grain" value={s.grain} min={0} max={0.12} step={0.005} onChange={(v) => set("grain", v)} format={(v) => (v === 0 ? "none — pure black" : pct(v / 0.12))} />
              </Group>

              </>
            )}
          </div>

          <button
            className="reset-link"
            onClick={() =>
              onSettings({ ...DEFAULT_SETTINGS, source: s.source, language: s.language, liveTranscript: s.liveTranscript, banned: s.banned })
            }
          >
            Restore default staging
          </button>
        </section>
      </div>

      <footer className="setup__footer">
        <p className="footer__keys">
          {voice ? (
            <>
              On stage: speak · <kbd>M</kbd> mute mic · <kbd>B</kbd> black · <kbd>R</kbd> clear · <kbd>F</kbd> fullscreen · <kbd>Esc</kbd> setup
            </>
          ) : (
            <>
              On stage: <kbd>Space</kbd> / <kbd>→</kbd> / clicker next · <kbd>←</kbd> back · <kbd>B</kbd> black · <kbd>F</kbd> fullscreen ·{" "}
              <kbd>Esc</kbd> setup
            </>
          )}
        </p>
        <button className="curtain" onClick={onPlay} disabled={!canPlay}>
          <span className="curtain__label">Raise the curtain</span>
          <span className="curtain__arrow">⟶</span>
        </button>
      </footer>
    </main>
  );
}

const MIC_LABEL: Record<VoiceStatus, string> = {
  connecting: "Connecting…",
  listening: "Listening. Say something",
  muted: "Muted",
  error: "Error",
  stopped: "Stopped",
};

/** Try the mic and the Soniox key before the show. */
function MicTest({ language, context }: { language: string; context: string }) {
  const listenerRef = useRef<VoiceListener | null>(null);
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<{ status: VoiceStatus; detail?: string } | null>(null);
  const [caption, setCaption] = useState({ settled: "", pending: "" });

  const stop = () => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setOn(false);
  };

  const start = () => {
    stop();
    setCaption({ settled: "", pending: "" });
    const listener = new VoiceListener({
      language,
      context,
      onCaption: (settled, pending) => setCaption({ settled, pending }),
      onStatus: (st, detail) => {
        setStatus({ status: st, detail });
        if (st === "error") setOn(false);
      },
    });
    listenerRef.current = listener;
    setOn(true);
    void listener.start();
  };

  // a new language needs a new stream; and never leave the mic open
  useEffect(() => stop, [language]);

  return (
    <div className="mictest">
      <button className={`mictest__btn ${on ? "is-on" : ""}`} onClick={on ? stop : start}>
        <i className="hud-mic__dot" /> {on ? "Stop test" : "Test the microphone"}
      </button>
      {status && (status.status !== "stopped" || caption.settled) && (
        <div className={`mictest__out hud-mic--${status.status}`}>
          <span className="mictest__status">
            {MIC_LABEL[status.status]}
            {status.detail ? ` · ${status.detail}` : ""}
          </span>
          {(caption.settled || caption.pending) && (
            <span className="mictest__text">
              {caption.settled.slice(-200)}
              <span className="stage__caption-pending">{caption.pending}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}s`;

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="group">
      <legend className="group__title">{title}</legend>
      {children}
    </fieldset>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const { label, value, min, max, step, onChange, format } = props;
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider__head">
        <span className="slider__label">{label}</span>
        <span className="slider__value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />
    </label>
  );
}

function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={props.value === o.value}
          className={`segmented__opt ${props.value === o.value ? "is-active" : ""}`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={props.value}
      disabled={props.disabled}
      className={`toggle ${props.value ? "is-on" : ""}`}
      onClick={() => props.onChange(!props.value)}
    >
      <span className="toggle__box" />
      <span className="toggle__label">{props.label}</span>
    </button>
  );
}
