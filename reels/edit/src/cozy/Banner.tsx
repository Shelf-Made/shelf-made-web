import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, clamp, FREDOKA, lift } from "./theme";

/**
 * The game's celebration banner ("Goal reached!"): a white card with a yellow border, a small
 * uppercase label in green over one big line. Springs in, eases out at the end.
 */
export const Banner: React.FC<{ label?: string; text: string; top?: number; frames: number; size?: number; border?: string; labelColor?: string }> = ({
  label,
  text,
  top = 230,
  frames,
  size = 86,
  border = C.yellow,
  labelColor = C.greenDark,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 11, stiffness: 170, mass: 0.7 } });
  const out = interpolate(f, [frames - 6, frames], [1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center", opacity: Math.min(1, f / 3) * out }}>
      <div
        style={{
          maxWidth: 900,
          padding: "26px 46px 30px",
          borderRadius: 40,
          background: C.white,
          border: `7px solid ${border}`,
          boxShadow: lift(10),
          textAlign: "center",
          fontFamily: FREDOKA,
          color: C.slate,
          scale: String(interpolate(pop, [0, 1], [0.55, 1]) * interpolate(out, [0, 1], [0.9, 1])),
          translate: `0px ${interpolate(pop, [0, 1], [50, 0])}px`,
        }}
      >
        {label ? <div style={{ fontWeight: 700, fontSize: size * 0.4, letterSpacing: 3, textTransform: "uppercase", color: labelColor, marginBottom: 6 }}>{label}</div> : null}
        <div style={{ fontWeight: 700, fontSize: size, lineHeight: 1.05 }}>{text}</div>
      </div>
    </div>
  );
};
