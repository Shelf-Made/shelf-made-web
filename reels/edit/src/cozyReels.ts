import beatsJson from "./beats.json";
import type { CozyCoverProps } from "./cozy/CozyCover";
import type { CozyReelProps, CozySeg } from "./cozy/CozyReel";

import takesJson from "./takes.json";

// Round two: the cozy kit (Fredoka, the game's banners, pills, review cards and confetti).
const BEATS: Record<string, { beats: number[] }> = beatsJson;
const TAKES: Record<string, { seconds: number }> = takesJson;
const grid = (track: string, start = 0) => (BEATS[track]?.beats ?? [0, 0.5]).filter((b) => b >= start - 0.02);

/** 4. One whole day, opening to lights-on, in one continuous timelapse (the HUD clock ticking). */
const DAY_RATE = 1.05;
const dayCuts = (labels: ([string, string] | null)[], beats: number[], g: number[], from = 0.2): CozySeg[] => {
  let at = 0;
  return labels.map((lab, i) => {
    const t0 = g[at] - g[0];
    at += beats[i];
    return { clip: "d_day", from: from + t0 * DAY_RATE, beats: beats[i], rate: DAY_RATE, hud: true, settle: i > 0, banner: lab ? { label: lab[0], text: lab[1], top: 330 } : undefined };
  });
};
const dayGrid = grid("day", 4.95);
const day: CozyReelProps = {
  music: "music/day.mp3",
  grid: dayGrid,
  musicVolume: 0.8,
  gameVolume: 0.7,
  hook: { label: "POV", text: "A whole day at my shop in 20 seconds" },
  hookBeats: 8,
  endBeats: 6,
  cta: "LINK IN BIO",
  endLine: "Free web beta",
  segments: dayCuts(
    [null, null, ["Morning", "First shoppers in"], null, ["Lunchtime", "The queue starts"], null, ["Afternoon", "Shelves need a top-up"], ["Golden hour", "Still busy"], ["Closing time", "Lights on"], null],
    [4, 4, 4, 4, 4, 4, 3, 3, 4, 3],
    dayGrid,
  ),
};

/** 5. Pick your shop: the same camera move through six colourways, then vote. */
const SHOPS = [
  { name: "Corner Fresh", color: "#3FA87A", sub: "classic sign · wood floor" },
  { name: "Berry Good", color: "#C2417A", sub: "neon sign · checkerboard" },
  { name: "Sunny Side", color: "#F2702E", sub: "lit sign · terracotta" },
  { name: "Plum & Co", color: "#7E57C2", sub: "neon sign · marble" },
  { name: "Tidal Grocer", color: "#22A699", sub: "LED sign · stone" },
  { name: "Bean There", color: "#8B5A3C", sub: "lit sign · parquet" },
];
const pick: CozyReelProps = {
  music: "music/pick.mp3",
  grid: grid("pick", 6.5),
  musicVolume: 0.78,
  gameVolume: 0.6,
  hook: { label: "Pick one", text: "Which shop would you run?" },
  hookBeats: 12,
  endBeats: 4,
  cta: "LINK IN BIO",
  endLine: "Build yours in Shelf Made",
  segments: [
    // One continuous camera move, the shop changing colour on every second beat.
    ...SHOPS.map((s, i): CozySeg => ({ clip: `e_pick${i + 1}`, from: 0.3 + i * 1.0, beats: 2, settle: false, badge: { n: i + 1, name: s.name, color: s.color } })),
    // A slower second look at each.
    ...SHOPS.map((s, i): CozySeg => ({ clip: `e_pick${i + 1}`, from: 4.6, beats: 3, badge: { n: i + 1, name: s.name, color: s.color, sub: s.sub } })),
    { beats: 10, grid: { stills: SHOPS.map((_, i) => `stills/pick${i + 1}.jpg`), label: "Comment your number", title: "Which one's yours?" } },
  ],
};

/** 6. Fixing my worst reviews: each real complaint (written by the game's shoppers), then the fix. */
const reviews: CozyReelProps = {
  music: "music/pov.mp3",
  grid: grid("pov", 5.0),
  musicVolume: 0.75,
  gameVolume: 0.85,
  hook: { label: "My shop's reviews", text: "Fixing every complaint" },
  hookBeats: 4,
  endBeats: 4,
  cta: "LINK IN BIO",
  endLine: "Every review is written by the game",
  segments: [
    { clip: "g_bad", from: 0.4, beats: 4, review: { author: "Marco Bennett", stars: 2, text: "not great today. not much choice. no soup again! shelves half empty, looks a bit sad. hope it improves", reviews: 6, when: "2 days ago", photo: "photos/bad-23-0.jpg" } },
    { clip: "g_stocker", from: 1.5, beats: 4, banner: { label: "Fix #1", text: "Hire a stocker" } },
    { clip: "g_bad", from: 3.0, beats: 4, review: { author: "Jack Rossi", stars: 1, text: "Stood in the queue for ages and gave up. Left my basket. Nobody on the tills.", reviews: 3, when: "3 days ago", photo: "photos/bad-3-0.jpg" } },
    { clip: "g_tills", from: 0.6, beats: 4, banner: { label: "Fix #2", text: "Second till, two cashiers" } },
    { clip: "g_bad", from: 5.4, beats: 3, review: { author: "Sam Silva", stars: 1, text: "Could do with a mop. Never again.", reviews: 14, when: "3 days ago", photo: "photos/bad-9-0.jpg" } },
    { clip: "g_mop", from: 1.0, beats: 4, banner: { label: "Fix #3", text: "A cleaner (and a mop)" } },
    { clip: "g_five", from: 0.6, beats: 9, confetti: true, review: { author: "Jack Nguyen", stars: 5, text: "Can't fault it. Spotless inside. Staff are so friendly. Shelves well stocked.", reviews: 12, when: "a day ago" } },
  ],
};

export const COZY_REELS: Record<string, CozyReelProps> = {
  Reel4Day: day,
  Reel5PickYourShop: pick,
  Reel6Reviews: reviews,
};

export const COZY_COVERS: Record<string, CozyCoverProps> = {
  Cover4Day: { still: "stills/day.jpg", label: "POV", text: "A whole day in 20 seconds" },
  Cover5PickYourShop: { still: "stills/pick2.jpg", label: "Pick one", text: "Which shop would you run?", sticker: "1–6?" },
  Cover6Reviews: { still: "stills/reviews.jpg", label: "1★ to 5★", text: "Fixing my worst reviews" },
};

// Every cut has to stay inside its take (a cut running off the end of the footage freezes).
for (const [id, r] of Object.entries(COZY_REELS)) {
  let at = 0;
  const g = r.grid;
  const span = (n: number) => { const i = Math.min(Math.floor(n), g.length - 2); return g[i] + (g[i + 1] - g[i]) * (n - i); };
  for (const s of r.segments) {
    if (s.clip) {
      const secs = (span(at + s.beats) - span(at)) * (s.rate ?? 1);
      const len = TAKES[s.clip]?.seconds ?? 0;
      if ((s.from ?? 0) + secs > len + 0.01) console.warn(`${id}: ${s.clip} cut runs ${((s.from ?? 0) + secs - len).toFixed(2)}s past the take`);
    }
    at += s.beats;
  }
}
