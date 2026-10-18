import { Audio, Video } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ANTON, Caption, CREAM, HOT, ACCENT, INK } from "./Caption";
import type { ReelProps, Segment } from "./types";

export const FPS = 30;

/** Time (s from the reel's start) of beat `b` of the grid; fractions fall between beats. */
export const beatTime = (grid: number[], b: number) => {
  const i = Math.min(Math.floor(b), grid.length - 2);
  return grid[i] + (grid[i + 1] - grid[i]) * (b - i) - grid[0];
};

/** Cut points in frames: every cut on a measured beat of the music. */
export const cutFrames = (p: Pick<ReelProps, "grid" | "segments">) => {
  const out = [0];
  let beats = 0;
  for (const s of p.segments) {
    beats += s.beats;
    out.push(Math.round(beatTime(p.grid, beats) * FPS));
  }
  return out;
};

export const reelLength = (p: Pick<ReelProps, "grid" | "segments">) => cutFrames(p)[p.segments.length];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** One cut: the footage (and its game sound) punched in on the beat. */
const Cut: React.FC<{ s: Segment; frames: number; beatFrames: number; gameVolume: number; hookTop: number; textFrames: number }> = ({
  s,
  frames,
  beatFrames,
  gameVolume,
  hookTop,
  textFrames,
}) => {
  const f = useCurrentFrame();
  const rate = s.rate ?? 1;
  const kicks = [0, ...(s.hits ?? []).map((b) => Math.round(b * beatFrames))];
  // The most recent kick: zoom punch and flash fall away from it.
  const since = Math.min(...kicks.map((k) => (f >= k ? f - k : Infinity)));
  const punch = interpolate(since, [0, 9], [1.13, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const push = interpolate(f, [0, frames], [1, s.push ?? 1.04], clamp);
  const flash = interpolate(since, [0, 4], [0.6, 0], clamp);
  const shake = since < 6 ? (6 - since) * 2.2 : 0;
  const trim = Math.round(s.from * FPS);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ scale: punch * push, translate: `${Math.sin(f * 2.1) * shake}px ${Math.cos(f * 2.7) * shake}px` }}>
        <Video src={staticFile(`footage/${s.clip}.mp4`)} trimBefore={trim} playbackRate={rate} muted objectFit="cover" />
      </AbsoluteFill>
      <Audio src={staticFile(`footage/${s.clip}.wav`)} trimBefore={trim} playbackRate={rate} volume={s.sound ?? gameVolume} />
      <AbsoluteFill style={{ backgroundColor: "white", opacity: flash }} />
      {s.text && textFrames > 0 ? (
        <Sequence durationInFrames={textFrames} layout="none">
          <Caption text={s.text} sub={s.sub} accent={s.accent} top={hookTop} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

/** Logo + call to action over the last beats; fades back toward the opening for the loop. */
const EndCard: React.FC<{ title: string; cta: string; frames: number }> = ({ title, cta, frames }) => {
  const f = useCurrentFrame();
  const pop = { ...clamp, easing: Easing.bezier(0.2, 1.4, 0.4, 1) };
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 45%, rgba(17,18,22,0.55), rgba(17,18,22,0.92))`, opacity: interpolate(f, [0, 4], [0, 1], clamp) }} />
      <Img
        src={staticFile("brand/logo.png")}
        style={{ width: 520, marginTop: -160, scale: interpolate(f, [0, 6], [1.8, 1], pop), opacity: interpolate(f, [0, 3], [0, 1], clamp) }}
      />
      <div
        style={{
          fontFamily: ANTON,
          fontSize: 132,
          color: CREAM,
          letterSpacing: 2,
          marginTop: 10,
          translate: interpolate(f, [2, 8], ["0px 60px", "0px 0px"], pop),
          opacity: interpolate(f, [2, 5], [0, 1], clamp),
        }}
      >
        {title.split(/(\*[^*]+\*)/).filter(Boolean).map((r, i) => (
          <span key={i} style={{ color: r.startsWith("*") ? ACCENT : CREAM }}>
            {r.replace(/\*/g, "")}
          </span>
        ))}
      </div>
      <div
        style={{
          marginTop: 34,
          fontFamily: ANTON,
          fontSize: 64,
          letterSpacing: 6,
          color: INK,
          background: ACCENT,
          padding: "10px 34px 6px",
          rotate: "-2deg",
          scale: interpolate(f, [6, 12], [0.4, 1], pop),
          opacity: interpolate(f, [6, 8], [0, 1], clamp),
          boxShadow: `0 10px 0 ${HOT}`,
        }}
      >
        {cta}
      </div>
      {/* Dip to white on the very last frames: the loop restarts on a flash, like every other cut. */}
      <AbsoluteFill style={{ backgroundColor: "white", opacity: interpolate(f, [frames - 3, frames - 1], [0, 0.5], clamp) }} />
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = (p) => {
  const { fps } = useVideoConfig();
  const cuts = cutFrames(p);
  const total = cuts[p.segments.length];
  const beatFrames = ((p.grid[p.grid.length - 1] - p.grid[0]) / (p.grid.length - 1)) * fps;
  const endFrom = total - Math.round(p.endBeats * beatFrames);
  const hookFrames = Math.round((p.hookBeats ?? 0) * beatFrames);
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      {p.segments.map((s, i) => (
        <Sequence key={i} from={cuts[i]} durationInFrames={cuts[i + 1] - cuts[i]} name={`${i + 1}. ${s.clip}${s.text ? ` · ${s.text}` : ""}`}>
          <Cut s={s} frames={cuts[i + 1] - cuts[i]} beatFrames={beatFrames} gameVolume={p.gameVolume} hookTop={cuts[i] < hookFrames ? 470 : 300} textFrames={endFrom - cuts[i]} />
        </Sequence>
      ))}
      {/* Vignette: pulls the eye to the fight, darkens the edges under Instagram's buttons. */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)" }} />
      {p.hook && hookFrames > 0 ? (
        <Sequence durationInFrames={hookFrames} name="Hook">
          <Caption text={p.hook} top={190} size={100} />
        </Sequence>
      ) : null}
      <Sequence from={endFrom} durationInFrames={total - endFrom} name="End card">
        <EndCard title={p.title} cta={p.cta} frames={total - endFrom} />
      </Sequence>
      {p.music ? (
        <Audio
          src={staticFile(p.music)}
          trimBefore={Math.round(p.grid[0] * fps)}
          volume={(fr) => p.musicVolume * interpolate(fr, [total - 8, total], [1, 0.6], clamp)}
        />
      ) : null}
    </AbsoluteFill>
  );
};
