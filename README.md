# Words, words, words.

A theatrical text visualizer: white words on a black stage, built as a background for a documentary talk show about Shakespeare. It works with any text you paste in.

**Next.js 16 · three.js · Google Fonts (self-hosted)**

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

For the show, use a production build. Fonts are bundled at build time, so it runs with no internet at the venue:

```bash
npm run build && npm start
```

## Voice: live from the microphone (Soniox)

Instead of pressing a key for each word, the show can listen and put each word on stage as it is spoken, using [Soniox](https://soniox.com) real-time speech-to-text (Czech by default).

1. Create an API key in the [Soniox console](https://console.soniox.com).
2. Put it in `.env.local` (copy `.env.example`): `SONIOX_API_KEY=...`, then restart `npm run dev`.
3. In setup, switch **The Text** to **Voice (Soniox)**, pick the language, and press **Test the microphone**.
4. Raise the curtain and speak. `M` mutes the mic, and the HUD shows the mic state and a running transcript for the operator.

The real key stays on the server. `/api/soniox-key` hands the browser a single-use key that expires in a minute. Whatever is in the text box goes to Soniox as a vocabulary hint. Voice needs an internet connection and Chrome, Edge or Firefox (Safari records audio in a format Soniox can't detect). Every typeface has the full Czech alphabet.

**Never show these words** keeps hesitations and fillers off the stage (by default the Czech `hm, mhm, mm, ehm, eh, em, e, é, uh, uhm, um, ah, ehe`). Matching ignores case and punctuation, and treats repeated letters as one, so `hm` also catches `Hmmm,`. Words made only of punctuation are dropped too. The operator transcript still shows everything.

**Live transcript** (on by default) puts each word on stage the moment Soniox hears it, written left to right as running sentences. Word mode uses two large lines, Line mode uses its line count, and Page mode a full page. If Soniox revises a word, only that word and those after it are rewritten. Turn it off to show only confirmed words. That is steadier, but Soniox often confirms only at the end of a sentence.

In Line and Page mode, spoken words are written left to right into the frame. A pause in speech starts a new line, and a full frame departs like a page.

## The two steps

1. **Setup.** Paste the text (or pick a sonnet or soliloquy), choose a *Look* or tune every setting, and watch the live **Rehearsal** preview.
2. **Raise the curtain.** The stage opens on pure black. Every press brings the next word.

| Key | Action |
| --- | --- |
| `Space` · `→` · `↓` · `PageDown` · `Enter` · click | next word (presentation clickers work) |
| `←` · `↑` · `PageUp` · `Backspace` · right-click | back one word |
| `B` or `.` | fade to black and back |
| `R` | restart from black |
| `F` | fullscreen |
| `H` | hide or show the HUD (it also hides itself when the mouse is idle) |
| `Esc` | back to setup |

## Modes

- **Word**: one word at a time, centre stage. Each press sends the previous word off with the exit effect. Because exits are slow, several words drift at once.
- **Line**: words light up in place along the verse line. When the line is done, it departs.
- **Page**: the whole passage waits in shadow ("Unspoken words") and is revealed word by word. Spoken words dim so the current word holds the light.
- **Paragraph** (the default): words gather into a paragraph at a random spot on the stage. When it is full (or, with voice, at a pause once it has a few words; with a script, at a new stanza), the next paragraph begins somewhere else, never overlapping the last one. Once a word has formed it stays readable for a set time ("Each word stays readable for", 1.75 s by default), then leaves with the chosen exit effect ("Then leaves over", 3 s), so a paragraph clears away behind the words still being written. You can set the lines per paragraph, its width, how long words stay and how fast they leave.

**The default look, Nebula**, follows the director's brief: each word appears out of a cosmic nebula that looks and behaves like smoke, is readable for a second or two, then thins into smoke that a draft carries off until it is gone, clearing the view for the words after it. **Restore default staging** in setup brings it back. **Mist** is a variation with a larger but fainter fog; the **Fog** settings (size and strength) tune either one. Staging saved by an older version is reset to it once; the text and voice settings are kept.

**Entrances:** Nebula (condenses out of a soft cosmic cloud), Ink (soft-focus bleed), Quill (written left to right with a glowing nib), Rise, Arrive (letters fly in from the dark), Gather (particles condense into the word).

**Exits:** Smoke (thins into smoke carried off on a draft), Fall (gentle gravity, tumbling like leaves), Ascend (embers), Recede (sinks back into the dark), Dissolve (burns to dust on a breeze), Scatter (3D burst), Fade.

**Atmosphere:** glow, breathing, camera drift, stage dust, and optional film grain. With grain off, the background stays true black (0,0,0), so you can composite it with a screen or add blend.

**Typefaces:** IM Fell English, DW Pica, French Canon, Double Pica (17th-century Fell types), Cormorant, EB Garamond, Cinzel, Cinzel Decorative, Tangerine (renaissance calligraphy), Meddon (quill handwriting), UnifrakturMaguntia, plus three modern sans serifs: Inter, DM Sans and Space Grotesk. There are also options for italic, capitals, and early-modern long ſ spelling.

**Saved setups:** under the rehearsal preview, name and save the current staging (with or without the text), load it back with one click, and update it when it changes. Setups live in the browser; Export/Import moves them between machines as a JSON file, for example from a laptop to the theatre's computer.

**Czech in the period faces:** Google Fonts serves the Fell types and Meddon cut down to basic Latin, and Tangerine and UnifrakturMaguntia lack č ř ě ň ť ď ů. `scripts/czech-fonts.py` (needs `pip install fonttools brotli`) downloads the full fonts, composes the missing letters from each font's own accents, and writes them to `src/fonts/`, which the app loads instead. The output is committed, so you only rerun it to rebuild the fonts.

Settings and text persist in `localStorage`.

## Remote control (next step)

Every input goes through one command bus, `src/lib/commands.ts`. A WebSocket or phone remote only has to call `commands.send("next" | "prev" | "reset" | "blackout")`. On the stage page the bus is also exposed as `window.words` for console rehearsal.

## Code map

- `src/components/Setup.tsx`: setup screen. `Preview.tsx` is the looping rehearsal stage. `StageView.tsx` is the full-screen show.
- `src/lib/engine/stage.ts`: renderer, post-processing (bloom, vignette, grain, blackout), layout, and choreography (next, prev, pages).
- `src/lib/engine/actor.ts`: one word made of letter quads, with its entrance, breathing, and exit physics.
- `src/lib/engine/glyphs.ts`: rasterises each word into a per-letter canvas atlas.
- `src/lib/engine/letterMaterial.ts`: letter shader (blur, quill wipe, burning dissolve edge).
- `src/lib/soniox.ts`: microphone to Soniox WebSocket, turned into whole words. `src/app/api/soniox-key/route.ts` mints the temporary keys.
- `src/lib/engine/particles.ts`: GPU particle pool for ash and gather effects. `dust.ts` holds the ambient motes.
