"use client";

import { useEffect, useRef, useState } from "react";
import type { Settings } from "@/lib/settings";
import {
  downloadSetups,
  loadActiveSetupId,
  loadSetups,
  matchesSetup,
  mergeSetups,
  newSetupId,
  parseSetupsFile,
  storeActiveSetupId,
  storeSetups,
  type SavedSetup,
} from "@/lib/setups";

interface Props {
  settings: Settings;
  text: string;
  /** Apply a setup: its settings, and its text when it carries one. */
  onLoad: (settings: Settings, text?: string) => void;
}

const when = (t: number) =>
  new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Setups({ settings, text, onLoad }: Props) {
  const [list, setList] = useState<SavedSetup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [withText, setWithText] = useState(true);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const l = loadSetups();
    setList(l);
    const a = loadActiveSetupId();
    setActiveId(a && l.some((s) => s.id === a) ? a : null);
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const commit = (next: SavedSetup[], active: string | null = activeId) => {
    setList(next);
    storeSetups(next);
    setActiveId(active);
    storeActiveSetupId(active);
  };

  const active = list.find((s) => s.id === activeId) ?? null;
  const dirty = active ? !matchesSetup(active, settings, text) : false;

  const load = (s: SavedSetup) => {
    onLoad(s.settings, s.text);
    commit(list, s.id);
  };

  const saveNew = () => {
    const n = name.trim();
    if (!n) return;
    const existing = list.find((s) => s.name.toLowerCase() === n.toLowerCase());
    if (existing && !window.confirm(`Replace the setup “${existing.name}”?`)) return;
    const entry: SavedSetup = {
      id: existing?.id ?? newSetupId(),
      name: n,
      settings: { ...settings },
      text: withText ? text : undefined,
      savedAt: Date.now(),
    };
    commit(existing ? list.map((s) => (s.id === existing.id ? entry : s)) : [...list, entry], entry.id);
    setName("");
    setMessage(existing ? `Replaced “${n}”.` : `Saved “${n}”.`);
  };

  const update = () => {
    if (!active) return;
    const entry = { ...active, settings: { ...settings }, text: active.text !== undefined ? text : undefined, savedAt: Date.now() };
    commit(list.map((s) => (s.id === active.id ? entry : s)));
    setMessage(`Updated “${active.name}”.`);
  };

  const remove = (s: SavedSetup) => {
    if (!window.confirm(`Delete the setup “${s.name}”?`)) return;
    commit(
      list.filter((o) => o.id !== s.id),
      activeId === s.id ? null : activeId,
    );
  };

  const finishRename = () => {
    if (!renaming) return;
    const n = renaming.name.trim();
    if (n) commit(list.map((s) => (s.id === renaming.id ? { ...s, name: n } : s)));
    setRenaming(null);
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const importFile = async (file: File) => {
    try {
      const incoming = parseSetupsFile(await file.text());
      commit(mergeSetups(list, incoming));
      setMessage(`Imported ${incoming.length} setup${incoming.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setMessage(e instanceof Error && e.message.startsWith("No setups") ? e.message : "That file isn't a setups file.");
    }
  };

  return (
    <div className="setups">
      <div className="setups__head">
        <h3 className="setups__title">Saved setups</h3>
        <div className="setups__io">
          <button className="link" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button className="link" onClick={() => downloadSetups(list)} disabled={!list.length}>
            Export
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {list.length === 0 ? (
        <p className="note">
          Nothing saved yet. Shape the staging, name it below and save it: you can come back to it, or export it and carry it to
          the theatre&apos;s computer.
        </p>
      ) : (
        <ul className="setups__list">
          {list.map((s, i) => {
            const isActive = s.id === activeId;
            return (
              <li key={s.id} className={`setup-row ${isActive ? "is-active" : ""}`}>
                {renaming?.id === s.id ? (
                  <input
                    className="field setup-row__rename"
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button className="setup-row__main" onClick={() => load(s)} title="Load this setup">
                    <span className="setup-row__name">
                      {s.name}
                      {isActive && dirty && <span className="setup-row__dirty" title="Changed since it was saved"> · changed</span>}
                    </span>
                    <span className="setup-row__meta">
                      {s.text !== undefined ? "staging + text" : "staging only"} · {when(s.savedAt)}
                    </span>
                  </button>
                )}
                <span className="setup-row__actions">
                  {isActive && dirty && (
                    <button className="btn btn--small" onClick={update} title="Save the current staging into this setup">
                      Update
                    </button>
                  )}
                  <button className="icon" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move up">
                    ↑
                  </button>
                  <button className="icon" onClick={() => move(i, 1)} disabled={i === list.length - 1} title="Move down" aria-label="Move down">
                    ↓
                  </button>
                  <button className="icon" onClick={() => setRenaming({ id: s.id, name: s.name })} title="Rename" aria-label="Rename">
                    ✎
                  </button>
                  <button className="icon" onClick={() => remove(s)} title="Delete" aria-label="Delete">
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="setups__save"
        onSubmit={(e) => {
          e.preventDefault();
          saveNew();
        }}
      >
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this setup…" maxLength={60} />
        <button className="btn" type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
      <button
        role="switch"
        aria-checked={withText}
        className={`toggle ${withText ? "is-on" : ""}`}
        onClick={() => setWithText(!withText)}
      >
        <span className="toggle__box" />
        <span className="toggle__label">Save the text with it</span>
      </button>
      {message && <p className="setups__msg">{message}</p>}
    </div>
  );
}
