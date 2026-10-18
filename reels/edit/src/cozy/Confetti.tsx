import React from "react";
import { interpolate, random, useCurrentFrame } from "remotion";
import { C, clamp } from "./theme";

/** The game's confetti (yellow, red, green, blue): falls from the top for about two seconds. */
export const Confetti: React.FC<{ seed?: string; count?: number }> = ({ seed = "c", count = 70 }) => {
  const f = useCurrentFrame();
  const colors = [C.yellow, C.red, C.green, C.blue];
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const d = random(`${seed}d${i}`) * 8;
        const t = Math.max(0, f - d);
        const x = 40 + random(`${seed}x${i}`) * 1000 + Math.sin((t + i) * 0.12) * 30;
        const y = interpolate(t, [0, 75], [-40, 1500 + random(`${seed}y${i}`) * 500], clamp);
        return (
          <i
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: 22,
              height: 34,
              borderRadius: 5,
              background: colors[i % 4],
              rotate: `${t * (6 + random(`${seed}r${i}`) * 8)}deg`,
              opacity: interpolate(t, [60, 78], [1, 0], clamp),
            }}
          />
        );
      })}
    </div>
  );
};
