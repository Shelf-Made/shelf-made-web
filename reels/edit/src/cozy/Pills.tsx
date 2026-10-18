import React from "react";
import { C, FREDOKA, lift } from "./theme";

/** The game's clock label: day second 0 is 8:00 am, a game second is a minute. */
export const clockLabel = (t: number) => {
  const total = 8 * 60 + Math.floor(Math.min(t, 720));
  const h24 = Math.floor(total / 60) % 24, m = total % 60;
  return `${((h24 + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
};

const pill: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  height: 92,
  padding: "0 30px 0 12px",
  borderRadius: 999,
  background: C.white,
  color: C.slate,
  boxShadow: lift(6),
  fontFamily: FREDOKA,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

/** The HUD's day and cash pills, as the game draws them (top left). */
export const Pills: React.FC<{ time: number; cash: number; night: boolean }> = ({ time, cash, night }) => {
  const dusk = time / 720;
  return (
    <div style={{ position: "absolute", left: 50, top: 70, display: "flex", gap: 20 }}>
      <div style={pill}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", background: night || dusk > 0.86 ? C.slate2 : C.yellow, display: "grid", placeItems: "center", boxShadow: `inset 0 -5px 0 ${night || dusk > 0.86 ? "#2a2a2e" : C.yellowDark}` }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: night || dusk > 0.86 ? C.cream : C.white, boxShadow: night || dusk > 0.86 ? `inset 10px -6px 0 ${C.slate2}` : "none" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.02 }}>
          <span style={{ fontSize: 42, fontVariantNumeric: "tabular-nums" }}>{night ? "Closed" : clockLabel(time)}</span>
          <span style={{ fontSize: 26, fontWeight: 600, opacity: 0.7 }}>Day 1</span>
        </div>
      </div>
      <div style={pill}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", background: C.yellow, color: "#8a5a00", display: "grid", placeItems: "center", fontSize: 42, boxShadow: `inset 0 -5px 0 ${C.yellowDark}` }}>$</div>
        <span style={{ fontSize: 50, color: C.greenDark, fontVariantNumeric: "tabular-nums" }}>{cash.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
};
