import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C, FREDOKA, lift } from "./theme";

export type CozyCoverProps = { still: string; label?: string; text: string; sticker?: string };

/** Cover: a still with the game's banner in the middle band (survives the grid crop) and the logo. */
export const CozyCover: React.FC<CozyCoverProps> = ({ still, label, text, sticker }) => (
  <AbsoluteFill style={{ backgroundColor: C.cream, fontFamily: FREDOKA }}>
    <Img src={staticFile(still)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 50%, rgba(56,40,20,0.35) 100%)" }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 700, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 920, padding: "30px 50px 36px", borderRadius: 44, background: C.white, border: `8px solid ${C.yellow}`, boxShadow: lift(12), textAlign: "center", color: C.slate, rotate: "-2deg" }}>
        {label ? <div style={{ fontWeight: 700, fontSize: 40, letterSpacing: 3, textTransform: "uppercase", color: C.greenDark }}>{label}</div> : null}
        <div style={{ fontWeight: 700, fontSize: 104, lineHeight: 1.02 }}>{text}</div>
      </div>
    </div>
    {sticker ? <div style={{ position: "absolute", right: 120, top: 640, padding: "12px 28px", borderRadius: 999, background: C.red, color: C.white, fontWeight: 700, fontSize: 44, boxShadow: lift(6), rotate: "8deg" }}>{sticker}</div> : null}
    <Img src={staticFile("brand/logo.png")} style={{ position: "absolute", width: 230, left: 425, top: 1130 }} />
  </AbsoluteFill>
);
