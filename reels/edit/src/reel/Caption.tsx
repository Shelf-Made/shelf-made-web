import { loadFont } from "@remotion/fonts";
import React from "react";
import { Easing, interpolate, staticFile, useCurrentFrame } from "remotion";

// Anton (SIL Open Font License), bundled: renders don't depend on reaching Google Fonts.
export const ANTON = "Anton";
loadFont({ family: ANTON, url: staticFile("fonts/Anton-Regular.ttf") });

// Shelf Made's brand colours (tools/gen-logo.ts, src/ui/styles.css).
/** Highlight colour for *words* and labels. */
export const ACCENT = "#FFC044";
/** Second, hotter highlight (bosses, danger, top tier). */
export const HOT = "#E8573F";
/** Light text on the end card. */
export const CREAM = "#FFF3DC";
/** Outline / dark. */
export const INK = "#1E1E22";
/** Shelf Made green (the awning). */
export const GREEN = "#3FA87A";
/** Shelf Made blue. */
export const BLUE = "#4F8FE0";

/** Splits "THE *BOSS*" into plain and highlighted runs. */
const runs = (text: string) => text.split(/(\*[^*]+\*)/).filter(Boolean).map((r) => (r.startsWith("*") ? { hi: true, t: r.slice(1, -1) } : { hi: false, t: r }));

/** The big punchy caption: Anton caps, heavy black outline, slams in. */
export const Caption: React.FC<{ text: string; sub?: string; accent?: string; top?: number; size?: number; delay?: number }> = ({
  text,
  sub,
  accent = ACCENT,
  top = 300,
  size = 150,
  delay = 0,
}) => {
  const f = useCurrentFrame() - delay;
  if (f < 0) return null;
  const pop = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 1.4, 0.4, 1) } as const;
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          fontFamily: ANTON,
          fontSize: size,
          lineHeight: 0.98,
          textAlign: "center",
          textTransform: "uppercase",
          color: "white",
          WebkitTextStroke: `${Math.round(size * 0.09)}px ${INK}`,
          paintOrder: "stroke fill",
          textShadow: `0 ${size * 0.06}px 0 ${INK}, 0 0 40px rgba(0,0,0,0.55)`,
          scale: interpolate(f, [0, 5], [1.6, 1], pop),
          rotate: interpolate(f, [0, 5], ["-7deg", "-2deg"], pop),
          opacity: interpolate(f, [0, 2], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        {runs(text).map((r, i) => (
          <span key={i} style={{ color: r.hi ? accent : "white" }}>
            {r.t}
          </span>
        ))}
      </div>
      {sub ? (
        <div
          style={{
            marginTop: 26,
            fontFamily: ANTON,
            fontSize: size * 0.36,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: INK,
            background: accent,
            padding: "6px 22px 4px",
            rotate: "-2deg",
            translate: interpolate(f, [2, 7], ["0px 40px", "0px 0px"], pop),
            opacity: interpolate(f, [2, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};
