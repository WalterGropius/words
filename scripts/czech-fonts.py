#!/usr/bin/env python3
"""
Build Czech-ready copies of the period typefaces and write them to src/fonts/.

    pip install fonttools brotli
    python3 scripts/czech-fonts.py

Google Fonts only serves the IM Fell faces and Meddon with a "latin" subset, which strips
č ř ě ů… even though Igino Marini's full fonts contain them. Tangerine and
UnifrakturMaguntia really do lack the caron and ring letters (they have š ž
but not č ř ě ň ť ď ů). So:

  * Fell (all four, roman + italic) and Meddon: the complete, unmodified font, re-encoded
    as WOFF2 for the web.
  * Tangerine Bold, UnifrakturMaguntia: the missing letters are composed from
    the font's own base letters and its own caron / ring / apostrophe, placed
    the way the font itself places the caron on š/Š and the ring on å/Å.
    Being modified, they are renamed (SIL OFL Reserved Font Names) to
    "Words Script" and "Words Fraktur".

The output is committed; rerun this only to rebuild it.
"""
import io
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent.parent / "src" / "fonts"
CZECH = "ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž"
# An old user agent makes the Google Fonts CSS API hand out full TrueType files.
UA = "Mozilla/4.0"

# (output file, Google family, CSS axis query, style, rename-to or None)
FONTS = [
    ("fell-english", "IM Fell English", "ital@0;1", None),
    ("fell-dw-pica", "IM Fell DW Pica", "ital@0;1", None),
    ("fell-french-canon", "IM Fell French Canon", "ital@0;1", None),
    ("fell-double-pica", "IM Fell Double Pica", "ital@0;1", None),
    ("meddon", "Meddon", None, None),
    ("tangerine", "Tangerine", "wght@700", "Words Script"),
    ("unifraktur", "UnifrakturMaguntia", None, "Words Fraktur"),
]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def download(family: str, axes: str | None) -> dict[str, bytes]:
    """{"normal": ttf, "italic": ttf} for one family."""
    q = family.replace(" ", "+") + (f":{axes}" if axes else "")
    css = fetch(f"https://fonts.googleapis.com/css2?family={q}").decode()
    out = {}
    for style, url in re.findall(r"font-style: (\w+);.*?url\((\S+?)\)", css, re.S):
        out[style] = fetch(url)
    return out


# ───────────────────────────── composing ─────────────────────────────


def bounds(gs, name):
    p = BoundsPen(gs)
    gs[name].draw(p)
    return p.bounds  # xMin, yMin, xMax, yMax


def top_center(gs, name, frac=0.25):
    """x-centre of the top part of a glyph — follows the slant of italic and script letters."""
    rec = DecomposingRecordingPen(gs)
    gs[name].draw(rec)
    pts = [pt for _, args in rec.value for pt in args if isinstance(pt, tuple)]
    _, y0, _, y1 = bounds(gs, name)
    cut = y1 - frac * (y1 - y0)
    xs = [x for x, y in pts if y >= cut]
    return (min(xs) + max(xs)) / 2


def top_right(gs, name, frac=0.2):
    """Rightmost point of the top part of a glyph: where an ascender's stem ends."""
    rec = DecomposingRecordingPen(gs)
    gs[name].draw(rec)
    pts = [pt for _, args in rec.value for pt in args if isinstance(pt, tuple)]
    _, y0, _, y1 = bounds(gs, name)
    cut = y1 - frac * (y1 - y0)
    return max(x for x, y in pts if y >= cut)


def mark_in(gs, composed, base):
    """Bounds of the accent inside a precomposed glyph: the contours above the base letter."""
    rec = DecomposingRecordingPen(gs)
    gs[composed].draw(rec)
    contours, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op in ("closePath", "endPath"):
            contours.append(cur)
            cur = []
    base_top = bounds(gs, base)[3]
    pts = []
    for c in contours:
        cp = [pt for _, args in c for pt in args if isinstance(pt, tuple)]
        if cp and min(y for _, y in cp) > base_top - 20:
            pts += cp
    if not pts:
        return None
    xs, ys = [x for x, _ in pts], [y for _, y in pts]
    return min(xs), min(ys), max(xs), max(ys)


def placement(gs, cmap, ref_composed, ref_base):
    """How the font sets an accent over a letter: (x offset from the letter's top centre, gap above it)."""
    m = mark_in(gs, cmap[ord(ref_composed)], cmap[ord(ref_base)])
    if m is None:
        return None
    base = cmap[ord(ref_base)]
    return (m[0] + m[2]) / 2 - top_center(gs, base), m[1] - bounds(gs, base)[3]


def compose_czech(font: TTFont):
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    glyf, hmtx = font["glyf"], font["hmtx"]
    upm = font["head"].unitsPerEm
    caron, ring, apos = cmap[0x2C7], cmap[0x2DA], cmap[0x2019]

    def ref(pairs):
        for composed, base in pairs:
            if ord(composed) in cmap and ord(base) in cmap:
                r = placement(gs, cmap, composed, base)
                if r:
                    return r
        return 0.0, 0.08 * upm

    refs = {
        (caron, False): ref([("š", "s"), ("ž", "z")]),
        (caron, True): ref([("Š", "S"), ("Ž", "Z")]),
        (ring, False): ref([("å", "a"), ("š", "s")]),
        (ring, True): ref([("Å", "A"), ("Š", "S")]),
    }

    order = list(font.getGlyphOrder())
    added = []
    for ch in CZECH:
        if ord(ch) in cmap:
            continue
        base_ch, mark_cp = unicodedata.normalize("NFD", ch)
        base = cmap[ord(base_ch)]
        name = unicodedata.name(ch).replace("LATIN ", "").replace(" LETTER ", "_").replace(" WITH ", "_").replace(" ", "_").lower()
        name = f"cz_{name}"
        pen = TTGlyphPen(gs)
        pen.addComponent(base, (1, 0, 0, 1, 0, 0))
        bx0, by0, bx1, by1 = bounds(gs, base)
        adv = hmtx[base][0]
        if ch in "ďť":
            # Czech sets the caron on ascender letters as a little apostrophe just
            # right of the stem: past the letter's right edge in an upright face, at
            # the top of the ascender in a script whose ascender loops over its neighbour
            ax0, ay0, ax1, ay1 = bounds(gs, apos)
            top = by1 if ch == "ď" else max(by1, bounds(gs, cmap[ord("l")])[3] * 0.82)
            anchor = max(top_right(gs, base), min(bx1, adv))
            dx = round(anchor + 0.02 * upm - ax0)
            dy = round(top - ay1)
            pen.addComponent(apos, (1, 0, 0, 1, dx, dy))
            # make room for it — unless the letter already reaches over its neighbour (scripts)
            if bx1 <= adv:
                adv = max(adv, round(ax1 + dx + 0.01 * upm))
        else:
            mark = caron if mark_cp == "̌" else ring
            off, gap = refs[(mark, base_ch.isupper())]
            mx0, my0, mx1, my1 = bounds(gs, mark)
            dx = round(top_center(gs, base) + off - (mx0 + mx1) / 2)
            dy = round(by1 + gap - my0)
            pen.addComponent(mark, (1, 0, 0, 1, dx, dy))
        g = pen.glyph()
        glyf[name] = g
        g.recalcBounds(glyf)
        hmtx[name] = (adv, g.xMin)
        order.append(name)
        added.append((ch, name))
    font.setGlyphOrder(order)
    glyf.glyphOrder = order
    for t in font["cmap"].tables:
        if t.isUnicode():
            for ch, name in added:
                t.cmap[ord(ch)] = name
    return [ch for ch, _ in added]


def rename(font: TTFont, family: str, style: str):
    ps = family.replace(" ", "") + "-" + style.replace(" ", "")
    for rec in list(font["name"].names):
        if rec.nameID in (1, 4, 6, 16, 17, 21, 22):
            font["name"].removeNames(nameID=rec.nameID)
    for nid, val in ((1, family), (2, style), (4, f"{family} {style}"), (6, ps)):
        font["name"].setName(val, nid, 3, 1, 0x409)
        font["name"].setName(val, nid, 1, 0, 0)
    font["name"].setName(
        "Modified for Czech by the Words project: composed č ř ě ň ť ď ů and capitals from the font's own glyphs.",
        5, 3, 1, 0x409)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, family, axes, new_name in FONTS:
        for style, data in download(family, axes).items():
            font = TTFont(io.BytesIO(data), recalcTimestamp=False)
            added = []
            if new_name:
                added = compose_czech(font)
                rename(font, new_name, "Italic" if style == "italic" else "Regular")
            missing = [c for c in CZECH if ord(c) not in font.getBestCmap()]
            if missing:
                sys.exit(f"{family} {style}: still missing {''.join(missing)}")
            font.flavor = "woff2"
            path = OUT / f"{slug}-{style}.woff2"
            font.save(path)
            note = f"composed {''.join(added)}" if added else "complete as is"
            print(f"{path.relative_to(OUT.parent.parent)}  {path.stat().st_size // 1024} KB  {note}")


if __name__ == "__main__":
    main()
