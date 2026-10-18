import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FREDOKA, lift } from "./theme";

/** A numbered coin (the HUD's yellow coin), with the shop's name on a chip in its colour. */
export const Badge: React.FC<{ n: number; name: string; color: string; sub?: string }> = ({ n, name, color, sub }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 10, stiffness: 190, mass: 0.6 } });
  const chip = spring({ frame: f - 3, fps, config: { damping: 13, stiffness: 160 } });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 470, display: "flex", flexDirection: "column", alignItems: "center", fontFamily: FREDOKA }}>
      <div
        style={{
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: C.yellow,
          color: C.slate,
          display: "grid",
          placeItems: "center",
          fontWeight: 700,
          fontSize: 130,
          boxShadow: `inset 0 -14px 0 ${C.yellowDark}, ${lift(8)}`,
          border: `8px solid ${C.white}`,
          scale: String(interpolate(pop, [0, 1], [0.3, 1])),
          rotate: `${interpolate(pop, [0, 1], [-25, 0])}deg`,
        }}
      >
        {n}
      </div>
      <div style={{ marginTop: 26, padding: "14px 36px", borderRadius: 999, background: color, color: C.white, fontWeight: 700, fontSize: 56, boxShadow: lift(6), translate: `0px ${interpolate(chip, [0, 1], [40, 0])}px`, opacity: chip }}>
        {name}
      </div>
      {sub ? <div style={{ marginTop: 14, padding: "8px 24px", borderRadius: 999, background: C.white, color: C.slate, fontWeight: 600, fontSize: 32, boxShadow: lift(4), opacity: chip }}>{sub}</div> : null}
    </div>
  );
};
