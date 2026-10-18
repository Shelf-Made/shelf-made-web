import beatsJson from "./beats.json";
import { ACCENT, BLUE, GREEN, HOT } from "./reel/Caption";
import type { CoverProps } from "./reel/Cover";
import type { ReelProps, Segment } from "./reel/types";
import takesJson from "./takes.json";

// Written by the music step (scripts/beats.py, bed.py) and by stage.sh.
const BEATS: Record<string, { beats: number[] }> = beatsJson;
const TAKES: Record<string, { ko: number; seconds: number }> = takesJson;

/** The measured beats of a track from `start` (s) on: the reel's grid. */
const grid = (track: string, start = 0) => (BEATS[track]?.beats ?? [0, 0.5]).filter((b) => b >= start - 0.02);

/** Second of a take at which its finishing blow lands. */
const ko = (take: string) => {
  const t = TAKES[take]?.ko ?? -1;
  // (Missing a take: the other reels still build.)
  if (t < 0) console.warn(`${take}: no KO in the takes`);
  return Math.max(0, t);
};

/** A cut that opens `lead` seconds before the take's KO, so the blow lands just after the beat. */
const koCut = (take: string, beats: number, extra: Partial<Segment> = {}, lead = 0.3): Segment => ({ clip: take, from: ko(take) - lead, beats, ...extra });

// Tier colours for the ranking reel (D to S, cool to hot).
const TIER = { D: "#9AA7B8", C: GREEN, B: BLUE, A: ACCENT, S: HOT };

/** 1. The glow-up: an empty corner shop on day one to a packed market hall by day thirty. */
const glowUp: ReelProps = {
  music: "music/happy.mp3",
  grid: grid("happy", 8.7),
  musicVolume: 0.72,
  gameVolume: 0.85,
  hook: "MY GROCERY STORE: *DAY 1* VS *DAY 30*",
  hookBeats: 8,
  endBeats: 6,
  title: "SHELF *MADE*",
  cta: "LINK IN BIO",
  segments: [
    { clip: "a_empty", from: 1.0, beats: 4, text: "DAY *1*", sub: "ONE EMPTY ROOM", push: 1.1 },
    { clip: "a_build", from: 0.4, beats: 6, rate: 1.6, text: "FIT IT *OUT*", sub: "SHELF BY SHELF", accent: GREEN },
    koCut("a_open", 4, { text: "DOORS *OPEN*", accent: GREEN }, 0.4),
    koCut("b_truck", 4, { text: "*STOCK* UP" }, 0.5),
    { clip: "a_busy", from: 1.0, beats: 4, text: "DAY *30*", sub: "A WHOLE MARKET HALL", accent: ACCENT },
    { clip: "b_refill", from: 2.6, beats: 4, rate: 1.3 },
    { clip: "a_dusk", from: 0.2, beats: 14, rate: 1.2, text: "THE TOWN'S *FAVOURITE*", sub: "GROCER", accent: ACCENT, push: 1.02 },
  ],
};

/** 2. Restock ASMR: the truck, the boxes, every shelf filling, then the till ringing. */
const restock: ReelProps = {
  music: "music/funk.mp3",
  grid: grid("funk", 8.3),
  musicVolume: 0.55,
  gameVolume: 1,
  hook: "GROCERY *RESTOCK* ASMR",
  hookBeats: 8,
  endBeats: 5,
  title: "SHELF *MADE*",
  cta: "LINK IN BIO",
  segments: [
    { clip: "b_truck", from: 2.2, beats: 4, text: "THE TRUCK'S *HERE*" },
    koCut("b_truck", 4, { text: "*UNLOAD*", accent: GREEN }, 0.4),
    { clip: "b_refill", from: 0.7, beats: 8, text: "FILL *EVERY* SHELF", accent: GREEN, push: 1.08 },
    koCut("b_refill", 4, { text: "*PERFECT*" }, 0.3),
    { clip: "b_aisle", from: 1.0, beats: 6, text: "THEN THE *RUSH*", accent: HOT },
    { clip: "b_till", from: 1.4, beats: 6, text: "BEEP BEEP *KA-CHING*" },
    { clip: "a_busy", from: 2.0, beats: 6 },
  ],
};

/** 3. Ranking the chaos: a spill (D) up to a lightning strike on the shop (S). */
const tierList: ReelProps = {
  music: "music/pop.mp3",
  grid: grid("pop", 9.1),
  musicVolume: 0.7,
  gameVolume: 0.9,
  hook: "RANKING THE *CHAOS* IN MY GROCERY GAME",
  hookBeats: 6,
  endBeats: 5,
  title: "SHELF *MADE*",
  cta: "LINK IN BIO",
  segments: [
    koCut("c_spill", 6, { text: "*D* TIER", sub: "SPILL IN AISLE 2", accent: TIER.D }, 0.6),
    { clip: "c_rival", from: 0.6, beats: 6, text: "*C* TIER", sub: "RIVAL PRICE WAR", accent: TIER.C },
    koCut("c_bump", 6, { text: "*B* TIER", sub: "FENDER BENDER", accent: TIER.B }, 0.6),
    koCut("c_thief", 8, { text: "*A* TIER", sub: "SHOPLIFTER", accent: TIER.A }, 1.6),
    koCut("c_storm", 14, { text: "*S* TIER", sub: "LIGHTNING STRIKE", accent: TIER.S, hits: [7.2] }, 0.5),
  ],
};

export const REELS: Record<string, ReelProps> = {
  Reel1GlowUp: glowUp,
  Reel2Restock: restock,
  Reel3TierList: tierList,
};

export const COVERS: Record<string, CoverProps> = {
  Cover1GlowUp: { still: "stills/glowup.jpg", text: "DAY *1* VS *30*", sub: "MY GROCERY STORE", accent: ACCENT },
  Cover2Restock: { still: "stills/restock.jpg", text: "RESTOCK *ASMR*", sub: "SOUND ON", accent: GREEN },
  Cover3TierList: { still: "stills/tierlist.jpg", text: "CHAOS *TIER* LIST", sub: "WHAT'S YOUR S TIER?", accent: HOT },
};

// Every cut has to stay inside its take (a cut running off the end of the footage freezes).
for (const [id, r] of Object.entries(REELS)) {
  let at = 0;
  for (const s of r.segments) {
    const g = r.grid;
    const span = (n: number) => {
      const i = Math.min(Math.floor(n), g.length - 2);
      return g[i] + (g[i + 1] - g[i]) * (n - i);
    };
    const secs = (span(at + s.beats) - span(at)) * (s.rate ?? 1);
    const len = TAKES[s.clip]?.seconds ?? 0;
    if (s.from + secs > len + 0.01) console.warn(`${id}: ${s.clip} cut runs ${(s.from + secs - len).toFixed(2)}s past the take`);
    at += s.beats;
  }
}
