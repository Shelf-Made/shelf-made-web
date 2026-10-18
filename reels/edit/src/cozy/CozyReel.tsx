import { Audio, Video } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import takesJson from "../takes.json";
import { Badge } from "./Badge";
import { Banner } from "./Banner";
import { Confetti } from "./Confetti";
import { EndCard } from "./EndCard";
import { Pills } from "./Pills";
import { ReviewCard, type Review } from "./ReviewCard";
import { C, clamp, FREDOKA, lift } from "./theme";

export const FPS = 30;
const TAKES: Record<string, { seconds: number; ko: number; marks: { t: number; kind: string; label: string }[] }> = takesJson as never;

export type CozySeg = {
  /** Footage (public/footage/<clip>.mp4 + .wav); omit for a grid card. */
  clip?: string;
  from?: number;
  beats: number;
  rate?: number;
  /** Ease the frame in on the cut (default on); off for match cuts. */
  settle?: boolean;
  banner?: { label?: string; text: string; top?: number; border?: string };
  review?: Review;
  badge?: { n: number; name: string; color: string; sub?: string };
  confetti?: boolean;
  /** The game's clock and cash pills, read from the take's own HUD log. */
  hud?: boolean;
  /** A grid of numbered stills (the "pick one" card). */
  grid?: { stills: string[]; title: string; label?: string };
  sound?: number;
};

export type CozyReelProps = {
  music: string | null;
  grid: number[];
  musicVolume: number;
  gameVolume: number;
  hook?: { label?: string; text: string };
  hookBeats?: number;
  segments: CozySeg[];
  endBeats: number;
  cta: string;
  endLine?: string;
};

export const beatTime = (grid: number[], b: number) => {
  const i = Math.min(Math.floor(b), grid.length - 2);
  return grid[i] + (grid[i + 1] - grid[i]) * (b - i) - grid[0];
};
export const cutFrames = (p: Pick<CozyReelProps, "grid" | "segments">) => {
  const out = [0];
  let beats = 0;
  for (const s of p.segments) { beats += s.beats; out.push(Math.round(beatTime(p.grid, beats) * FPS)); }
  return out;
};
export const cozyLength = (p: Pick<CozyReelProps, "grid" | "segments">) => cutFrames(p)[p.segments.length];

/** The HUD pills for footage second `t` of a take (from its logged `hud` marks). */
const Hud: React.FC<{ clip: string; from: number; rate: number }> = ({ clip, from, rate }) => {
  const f = useCurrentFrame();
  const t = from + (f / FPS) * rate;
  const marks = (TAKES[clip]?.marks ?? []).filter((m) => m.kind === "hud");
  if (!marks.length) return null;
  const m = marks.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  const [time, cash, phase] = m.label.split("|");
  return <Pills time={+time} cash={+cash} night={phase === "night"} />;
};

const GridCard: React.FC<{ g: NonNullable<CozySeg["grid"]>; frames: number }> = ({ g, frames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${C.white}, ${C.cream} 70%)`, fontFamily: FREDOKA, alignItems: "center", opacity: interpolate(f, [frames - 4, frames], [1, 0.6], clamp) }}>
      <div style={{ marginTop: 150, textAlign: "center", color: C.slate }}>
        {g.label ? <div style={{ fontWeight: 700, fontSize: 36, letterSpacing: 3, textTransform: "uppercase", color: C.greenDark }}>{g.label}</div> : null}
        <div style={{ fontWeight: 700, fontSize: 84, lineHeight: 1.05 }}>{g.title}</div>
      </div>
      <div style={{ marginTop: 50, display: "grid", gridTemplateColumns: "repeat(3, 300px)", gap: 26 }}>
        {g.stills.map((s, i) => {
          const pop = spring({ frame: f - 2 - i * 2, fps, config: { damping: 12, stiffness: 170 } });
          return (
            <div key={s} style={{ position: "relative", width: 300, height: 420, borderRadius: 30, overflow: "hidden", border: `6px solid ${C.white}`, boxShadow: lift(7), scale: String(interpolate(pop, [0, 1], [0.5, 1])), opacity: pop }}>
              <Img src={staticFile(s)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", left: 14, top: 14, width: 78, height: 78, borderRadius: "50%", background: C.yellow, color: C.slate, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 50, boxShadow: `inset 0 -6px 0 ${C.yellowDark}` }}>{i + 1}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** One cut: footage settling in on the beat, with whatever cards it carries. */
const Cut: React.FC<{ s: CozySeg; frames: number; gameVolume: number; textFrames: number }> = ({ s, frames, gameVolume, textFrames }) => {
  const f = useCurrentFrame();
  const rate = s.rate ?? 1;
  const settle = s.settle === false ? 1 : interpolate(f, [0, 12], [1.045, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const tf = Math.min(frames, textFrames);
  if (s.grid) return <GridCard g={s.grid} frames={frames} />;
  const trim = Math.round((s.from ?? 0) * FPS);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ scale: String(settle) }}>
        <Video src={staticFile(`footage/${s.clip}.mp4`)} trimBefore={trim} playbackRate={rate} muted objectFit="cover" />
      </AbsoluteFill>
      <Audio src={staticFile(`footage/${s.clip}.wav`)} trimBefore={trim} playbackRate={rate} volume={s.sound ?? gameVolume} />
      {s.hud && s.clip ? <Hud clip={s.clip} from={s.from ?? 0} rate={rate} /> : null}
      {tf > 0 && s.banner ? <Sequence durationInFrames={tf} layout="none"><Banner {...s.banner} frames={tf} /></Sequence> : null}
      {tf > 0 && s.review ? <Sequence durationInFrames={tf} layout="none"><ReviewCard r={s.review} frames={tf} /></Sequence> : null}
      {tf > 0 && s.badge ? <Sequence durationInFrames={tf} layout="none"><Badge {...s.badge} /></Sequence> : null}
      {s.confetti ? <Confetti seed={s.clip} /> : null}
    </AbsoluteFill>
  );
};

export const CozyReel: React.FC<CozyReelProps> = (p) => {
  const { fps } = useVideoConfig();
  const cuts = cutFrames(p);
  const total = cuts[p.segments.length];
  const beat = ((p.grid[p.grid.length - 1] - p.grid[0]) / (p.grid.length - 1)) * fps;
  const endFrom = total - Math.round(p.endBeats * beat);
  const hookFrames = Math.round((p.hookBeats ?? 0) * beat);
  return (
    <AbsoluteFill style={{ backgroundColor: C.cream }}>
      {p.segments.map((s, i) => (
        <Sequence key={i} from={cuts[i]} durationInFrames={cuts[i + 1] - cuts[i]} name={`${i + 1}. ${s.clip ?? "grid"}`}>
          <Cut s={s} frames={cuts[i + 1] - cuts[i]} gameVolume={p.gameVolume} textFrames={endFrom - cuts[i]} />
        </Sequence>
      ))}
      {/* A soft warm vignette: keeps the edges calm under Instagram's buttons. */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 60%, rgba(56,40,20,0.28) 100%)", pointerEvents: "none" }} />
      {p.hook && hookFrames > 0 ? (
        <Sequence durationInFrames={hookFrames} name="Hook">
          <Banner label={p.hook.label} text={p.hook.text} top={190} frames={hookFrames} size={80} />
        </Sequence>
      ) : null}
      <Sequence from={endFrom} durationInFrames={total - endFrom} name="End card">
        <EndCard frames={total - endFrom} cta={p.cta} line={p.endLine} />
      </Sequence>
      {p.music ? <Audio src={staticFile(p.music)} trimBefore={Math.round(p.grid[0] * fps)} volume={(fr) => p.musicVolume * interpolate(fr, [total - 10, total], [1, 0.5], clamp)} /> : null}
    </AbsoluteFill>
  );
};
