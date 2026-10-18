import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Confetti } from "./Confetti";
import { C, clamp, FREDOKA } from "./theme";

/**
 * The shop sign and the game's yellow "Open shop" button saying LINK IN BIO, on cream, with
 * confetti; the button breathes like the in-game one. Fades back toward the footage at the very end.
 */
export const EndCard: React.FC<{ frames: number; cta: string; line?: string }> = ({ frames, cta, line }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame: f, fps, config: { damping: 10, stiffness: 150 } });
  const btn = spring({ frame: f - 6, fps, config: { damping: 9, stiffness: 170 } });
  const pulse = 1 + 0.035 * Math.sin(Math.max(0, f - 14) * ((2 * Math.PI) / 48));
  return (
    <AbsoluteFill style={{ fontFamily: FREDOKA, alignItems: "center", justifyContent: "center", opacity: interpolate(f, [frames - 5, frames], [1, 0.25], clamp) }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, ${C.white} 0%, ${C.cream} 55%, #F6E2BC 100%)`, opacity: interpolate(f, [0, 5], [0, 1], clamp) }} />
      <Img src={staticFile("brand/logo.png")} style={{ width: 600, marginTop: -170, scale: String(interpolate(logo, [0, 1], [0.4, 1])), rotate: `${interpolate(logo, [0, 1], [-8, 0])}deg` }} />
      {line ? <div style={{ marginTop: 6, fontWeight: 600, fontSize: 46, color: C.slate, opacity: interpolate(f, [4, 9], [0, 1], clamp) }}>{line}</div> : null}
      <div
        style={{
          marginTop: 44,
          padding: "26px 64px",
          borderRadius: 40,
          background: C.yellow,
          color: C.slate,
          fontWeight: 700,
          fontSize: 76,
          letterSpacing: 2,
          boxShadow: `0 12px 0 ${C.yellowDark}, 0 26px 50px rgba(20,30,40,0.2)`,
          scale: String(interpolate(btn, [0, 1], [0.3, 1]) * pulse),
          opacity: Math.min(1, btn * 2),
        }}
      >
        {cta}
      </div>
      <Confetti seed="end" />
    </AbsoluteFill>
  );
};
