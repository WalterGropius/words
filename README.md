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

## Live speech (Soniox)

Instead of a prepared script, the words can come from live speech: pick **Live speech** under *I. The Text*, and every word appears on stage the moment it is spoken, recognised in real time by [Soniox](https://soniox.com) (`stt-rt-v6`). It is tuned for Czech out of the box.

1. Put your Soniox API key on the server, in `.env.local` next to `package.json`:

   ```bash
   SONIOX_KEY=your-soniox-api-key
   ```

   The key needs the *Temporary API keys* and *Speech-to-Text* permissions. It never reaches the browser: the page asks `/api/soniox` for a short-lived, single-use key and streams the microphone straight to Soniox with that.
2. Restart the app, choose **Live speech**, pick the spoken language (Czech by default) and the microphone, and use **Test the microphone** to see what Soniox hears.
3. Raise the curtain and speak. No key presses: `B`, `R` (clear the stage), `F`, `H` and `Esc` still work.

**Tuned for Czech:** recognition is restricted to the chosen language (`language_hints_strict`), so Czech never drifts into Slovak or Polish. The Fell types and Unifraktur have no Czech accents of their own, so letters such as ř, ě and ů are borrowed from EB Garamond; Cormorant, EB Garamond and Cinzel carry their own.

**Prime with the script** sends the text from the *Script* tab to Soniox as context (up to ~9,000 characters), so names and quotations are recognised. Paste the Czech translation the speaker will quote. The built-in English presets are only sent when the language is English.

In *Line* and *Page* modes, live words are set left to right as they are spoken; a pause starts a new line, and the page departs when it is full. *Word* mode works as usual, and *Leave on its own after* clears the stage when the speaker pauses. If the connection drops, it reconnects by itself; the HUD shows the state.

**Instant words** (on by default) puts each word on stage from Soniox's provisional hypothesis, a few hundred milliseconds after it is spoken, instead of waiting a second or two for Soniox to confirm it. If the confirmed text differs, the newest word is swapped in place. When the speaker stops for about half a second the app asks Soniox to finalise straight away, so the last word of a phrase does not hang. Turn it off to show only confirmed words. The entrance effect also adds to the delay you feel: a short *Entrance* duration makes words land sooner.

**Never show these words** holds hesitations and fillers that never reach the stage. The default is a Czech list (*hm, mhm, mm, ehm, eh, em, e, é, uh, uhm, um, ah, ehe*). Matching ignores case and punctuation and squeezes drawn-out letters, so *hm* also catches *Hmmm,* and *eh* catches *ehhh*. Edit the list in the live panel; it applies to the stage and to the microphone test.

Live speech needs internet at the venue. Scripts do not.

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

**Entrances:** Ink (soft-focus bleed), Quill (written left to right with a glowing nib), Rise, Arrive (letters fly in from the dark), Gather (particles condense into the word).

**Exits:** Fall (gentle gravity, tumbling like leaves), Ascend (embers), Recede (sinks back into the dark), Dissolve (burns to dust on a breeze), Scatter (3D burst), Fade.

**Atmosphere:** glow, breathing, camera drift, stage dust, and optional film grain. With grain off, the background stays true black (0,0,0), so you can composite it with a screen or add blend.

**Typefaces:** IM Fell English, DW Pica, French Canon, Double Pica (17th-century Fell types), Cormorant, EB Garamond, Cinzel, UnifrakturMaguntia. There are also options for italic, capitals, and early-modern long ſ spelling.

Settings and text persist in `localStorage`.

## Remote control (next step)

Every input goes through one command bus, `src/lib/commands.ts`. A WebSocket or phone remote only has to call `commands.send("next" | "prev" | "reset" | "blackout")`. On the stage page the bus is also exposed as `window.words` for console rehearsal.

## Code map

- `src/components/Setup.tsx`: setup screen. `Preview.tsx` is the looping rehearsal stage. `StageView.tsx` is the full-screen show.
- `src/lib/engine/stage.ts`: renderer, post-processing (bloom, vignette, grain, blackout), layout, and choreography (next, prev, pages).
- `src/lib/engine/actor.ts`: one word made of letter quads, with its entrance, breathing, and exit physics.
- `src/lib/engine/glyphs.ts`: rasterises each word into a per-letter canvas atlas.
- `src/lib/engine/letterMaterial.ts`: letter shader (blur, quill wipe, burning dissolve edge).
- `src/lib/engine/particles.ts`: GPU particle pool for ash and gather effects. `dust.ts` holds the ambient motes.
