"use client";

import { useEffect, useMemo } from "react";
import { FONTS } from "@/lib/fonts";
import {
  DEFAULT_SETTINGS,
  LOOKS,
  MODE_DEFAULTS,
  type Entrance,
  type Exit,
  type Mode,
  type Settings,
} from "@/lib/settings";
import { TEXTS } from "@/lib/texts";
import Preview from "./Preview";

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
];

const ENTRANCES: { value: Entrance; label: string }[] = [
  { value: "fade", label: "Ink" },
  { value: "quill", label: "Quill" },
  { value: "rise", label: "Rise" },
  { value: "arrive", label: "Arrive" },
  { value: "materialize", label: "Gather" },
];

const EXITS: { value: Exit; label: string }[] = [
  { value: "fall", label: "Fall" },
  { value: "rise", label: "Ascend" },
  { value: "drift", label: "Recede" },
  { value: "dissolve", label: "Dissolve" },
  { value: "scatter", label: "Scatter" },
  { value: "fade", label: "Fade" },
];

const ENTRANCE_NOTES: Record<Entrance, string> = {
  fade: "Bleeds in from soft focus, like wet ink.",
  quill: "Written left to right with a glowing nib.",
  rise: "Lifts gently into place.",
  arrive: "Letters fly in from the dark, out of focus.",
  materialize: "Sparks gather and condense into the word.",
};

const EXIT_NOTES: Record<Exit, string> = {
  fall: "Letters loosen and drift down under a gentle gravity.",
  rise: "Letters float upward like embers and smoke.",
  drift: "The word sinks back into the darkness, out of focus.",
  dissolve: "Burns away into dust carried on a breeze.",
  scatter: "Bursts apart in three dimensions.",
  fade: "Simply fades.",
};

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

  const canPlay = stats.words > 0;

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
          Paste a text, set the stage, raise the curtain. Then press <kbd>Space</kbd> as each word is spoken.
        </p>
      </header>

      <div className="setup__body">
        {/* ─────────────── I. The text ─────────────── */}
        <section className="col col--text">
          <h2 className="act">
            <span className="act__num">I.</span> The Text
          </h2>
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
            {stats.lines} lines &nbsp;·&nbsp; {stats.words} words &nbsp;·&nbsp; about {stats.time} spoken
          </p>
        </section>

        {/* ─────────────── II. The staging ─────────────── */}
        <section className="col col--stage">
          <h2 className="act">
            <span className="act__num">II.</span> The Staging
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
            {s.mode !== "word" && (
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

          <Group title="Typeface">
            <div className="fonts">
              {FONTS.map((f) => (
                <button key={f.id} className={`font ${s.font === f.id ? "is-active" : ""}`} onClick={() => set("font", f.id)}>
                  <span className="font__sample" style={{ fontFamily: f.family }}>
                    {f.id === "cinzel" ? "Thou Art" : "Thou art"}
                  </span>
                  <span className="font__name">{f.label}</span>
                </button>
              ))}
            </div>
            <Slider label="Size" value={s.size} min={0.4} max={2} step={0.05} onChange={(v) => set("size", v)} format={(v) => `${Math.round(v * 100)}%`} />
            <div className="row">
              <Toggle label="Italic" value={s.italic && font.hasItalic} disabled={!font.hasItalic} onChange={(v) => set("italic", v)} />
              <Toggle label="Capitals" value={s.caps} onChange={(v) => set("caps", v)} />
              <Toggle label="Long ſ (Folio spelling)" value={s.longS} onChange={(v) => set("longS", v)} />
            </div>
          </Group>

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

          <Group title="Atmosphere">
            <Slider label="Glow" value={s.glow} min={0} max={1.5} step={0.05} onChange={(v) => set("glow", v)} format={pct} />
            <Slider label="Breathing" value={s.breathing} min={0} max={1} step={0.05} onChange={(v) => set("breathing", v)} format={pct} />
            <Slider label="Camera drift" value={s.cameraDrift} min={0} max={1} step={0.05} onChange={(v) => set("cameraDrift", v)} format={pct} />
            <Slider label="Stage dust" value={s.dust} min={0} max={1} step={0.05} onChange={(v) => set("dust", v)} format={(v) => (v === 0 ? "none" : pct(v))} />
            <Slider label="Film grain" value={s.grain} min={0} max={0.12} step={0.005} onChange={(v) => set("grain", v)} format={(v) => (v === 0 ? "none — pure black" : pct(v / 0.12))} />
          </Group>

          <button className="reset-link" onClick={() => onSettings(DEFAULT_SETTINGS)}>
            Restore default staging
          </button>
        </section>
      </div>

      <footer className="setup__footer">
        <p className="footer__keys">
          On stage: <kbd>Space</kbd> / <kbd>→</kbd> / clicker next · <kbd>←</kbd> back · <kbd>B</kbd> black · <kbd>F</kbd> fullscreen · <kbd>Esc</kbd> setup
        </p>
        <button className="curtain" onClick={onPlay} disabled={!canPlay}>
          <span className="curtain__label">Raise the curtain</span>
          <span className="curtain__arrow">⟶</span>
        </button>
      </footer>
    </main>
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
