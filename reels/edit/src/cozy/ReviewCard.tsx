import React from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, clamp, FREDOKA, lift } from "./theme";

/** One review, word for word as a shopper wrote it in the game (reels/out/reviews-*.json). */
export type Review = { author: string; stars: number; text: string; guide?: boolean; reviews?: number; when?: string; photo?: string };

const AVATAR = [C.green, C.red, C.blue, C.honey, "#7E57C2", "#22A699"];
const initials = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2);

/** The review as the game's map listing shows it: avatar, name, Local Guide, stars, text, a photo. */
export const ReviewCard: React.FC<{ r: Review; top?: number; frames: number }> = ({ r, top = 1000, frames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 2, fps, config: { damping: 14, stiffness: 140 } });
  const out = interpolate(f, [frames - 6, frames], [1, 0], clamp);
  const hue = AVATAR[[...r.author].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top, opacity: out, translate: `0px ${interpolate(pop, [0, 1], [260, 0]) + interpolate(out, [0, 1], [40, 0])}px` }}>
      <div style={{ background: C.white, borderRadius: 40, boxShadow: lift(10), padding: "34px 40px 36px", fontFamily: FREDOKA, color: C.slate }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ width: 92, height: 92, borderRadius: "50%", background: hue, color: C.white, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 40 }}>{initials(r.author)}</div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontWeight: 700, fontSize: 44 }}>{r.author}</span>
            <span style={{ fontWeight: 500, fontSize: 28, opacity: 0.65 }}>{r.guide ? "Local Guide · " : ""}{r.reviews ?? 3} reviews</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              style={{
                fontSize: 58,
                lineHeight: 1,
                color: i < r.stars ? C.yellow : "#D9DDE2",
                scale: String(interpolate(spring({ frame: f - 8 - i * 3, fps, config: { damping: 9, stiffness: 200 } }), [0, 1], [0.2, 1])),
                textShadow: i < r.stars ? `0 4px 0 ${C.yellowDark}` : "none",
              }}
            >
              ★
            </span>
          ))}
          <span style={{ marginLeft: 16, fontSize: 30, fontWeight: 500, opacity: 0.6 }}>{r.when ?? "a day ago"}</span>
        </div>
        <div style={{ display: "flex", gap: 26, marginTop: 18, alignItems: "flex-start" }}>
          <div style={{ flex: 1, fontSize: 46, fontWeight: 500, lineHeight: 1.22 }}>{r.text}</div>
          {r.photo ? <Img src={staticFile(r.photo)} style={{ width: 250, height: 188, objectFit: "cover", borderRadius: 22, boxShadow: lift(5), rotate: "2deg" }} /> : null}
        </div>
      </div>
    </div>
  );
};
