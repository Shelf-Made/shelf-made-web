import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Shelf Made's own UI font (Fredoka, SIL OFL), bundled with the game: public/fonts/Fredoka-latin.woff2.
export const FREDOKA = "Fredoka";
loadFont({ family: FREDOKA, url: staticFile("fonts/Fredoka-latin.woff2"), weight: "300 700" });

// The game's palette (src/ui/styles.css :root).
export const C = {
  green: "#3FA87A",
  greenDark: "#2E8560",
  honey: "#D9A066",
  yellow: "#FFC044",
  yellowDark: "#D9A033",
  slate: "#38383D",
  slate2: "#4A4A52",
  cream: "#FFF3DC",
  white: "#FFFFFF",
  red: "#E8573F",
  blue: "#4F8FE0",
};

/** The game's hard drop shadow under every card and pill, plus its soft one. */
export const lift = (px = 8) => `0 ${px}px 0 rgba(56,56,61,0.25), 0 ${px * 2}px ${px * 4}px rgba(20,30,40,0.18)`;

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
