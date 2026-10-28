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
