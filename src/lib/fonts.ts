import {
  IM_Fell_English,
  IM_Fell_DW_Pica,
  IM_Fell_French_Canon,
  IM_Fell_Double_Pica,
  Cormorant_Garamond,
  EB_Garamond,
  Cinzel,
  UnifrakturMaguntia,
  Inter,
  DM_Sans,
  Space_Grotesk,
  Meddon,
} from "next/font/google";

// All faces are Google Fonts (SIL Open Font License), self-hosted by next/font at
// build time, so the show also runs with no internet at the venue.

const fellEnglish = IM_Fell_English({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "block",
  variable: "--font-fell",
});
const fellPica = IM_Fell_DW_Pica({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "block",
  preload: false,
});
const fellCanon = IM_Fell_French_Canon({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "block",
  preload: false,
});
const fellDouble = IM_Fell_Double_Pica({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "block",
  preload: false,
});
const cormorant = Cormorant_Garamond({
  weight: ["400", "500"],
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  display: "block",
  variable: "--font-cormorant",
});
const garamond = EB_Garamond({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  display: "block",
  preload: false,
});
const cinzel = Cinzel({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "block",
  preload: false,
});
const fraktur = UnifrakturMaguntia({
  weight: "400",
  subsets: ["latin"],
  display: "block",
  preload: false,
});

// modern sans serifs, all with Czech letters
const inter = Inter({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  display: "block",
  preload: false,
});
const dmSans = DM_Sans({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  display: "block",
  preload: false,
});
const spaceGrotesk = Space_Grotesk({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "block",
  preload: false,
});

// an 18th-century hand: quill copperplate
const meddon = Meddon({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "block",
  preload: false,
});

export type FontId =
  | "fell-english"
  | "fell-pica"
  | "fell-canon"
  | "fell-double"
  | "cormorant"
  | "garamond"
  | "cinzel"
  | "fraktur"
  | "inter"
  | "dm-sans"
  | "space-grotesk"
  | "meddon";

export interface FontDef {
  id: FontId;
  label: string;
  note: string;
  family: string;
  hasItalic: boolean;
  /** Has the Central European letters Czech needs (č, ř, ě, ů…). */
  czech: boolean;
}

export const FONTS: FontDef[] = [
  { id: "fell-english", label: "Fell English", note: "1670s Oxford type", family: fellEnglish.style.fontFamily, hasItalic: true, czech: false },
  { id: "fell-pica", label: "Fell DW Pica", note: "First Folio texture", family: fellPica.style.fontFamily, hasItalic: true, czech: false },
  { id: "fell-canon", label: "Fell French Canon", note: "Large display Fell", family: fellCanon.style.fontFamily, hasItalic: true, czech: false },
  { id: "fell-double", label: "Fell Double Pica", note: "Rough, inky", family: fellDouble.style.fontFamily, hasItalic: true, czech: false },
  { id: "cormorant", label: "Cormorant", note: "Elegant Garalde", family: cormorant.style.fontFamily, hasItalic: true, czech: true },
  { id: "garamond", label: "EB Garamond", note: "Renaissance classic", family: garamond.style.fontFamily, hasItalic: true, czech: true },
  { id: "cinzel", label: "Cinzel", note: "Roman capitals", family: cinzel.style.fontFamily, hasItalic: false, czech: true },
  { id: "fraktur", label: "Unifraktur", note: "Blackletter", family: fraktur.style.fontFamily, hasItalic: false, czech: false },
  { id: "inter", label: "Inter", note: "Neutral modern sans", family: inter.style.fontFamily, hasItalic: true, czech: true },
  { id: "dm-sans", label: "DM Sans", note: "Soft geometric sans", family: dmSans.style.fontFamily, hasItalic: true, czech: true },
  { id: "space-grotesk", label: "Space Grotesk", note: "Quirky grotesque", family: spaceGrotesk.style.fontFamily, hasItalic: false, czech: true },
  { id: "meddon", label: "Meddon", note: "18th-century hand", family: meddon.style.fontFamily, hasItalic: false, czech: true },
];

export function getFont(id: FontId): FontDef {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** Class names that register the UI font CSS variables on <html>. */
export const fontVariables = `${fellEnglish.variable} ${cormorant.variable}`;

/** Make sure the face (and its Czech subset, where it has one) is decoded before we rasterise glyphs onto canvas. */
export async function ensureFontLoaded(family: string, italic: boolean): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const style = italic ? "italic " : "";
  try {
    await Promise.race([
      document.fonts.load(`${style}400 64px ${family}`, "Shall I compare thee ſ čřěůžš"),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch {
    // fall back to whatever the browser has — never block the show
  }
}
