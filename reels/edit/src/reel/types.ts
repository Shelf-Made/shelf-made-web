/** One cut of a reel: a stretch of captured fight footage, so many beats long. */
export type Segment = {
  /** Footage name (public/footage/<clip>.mp4 + .wav, from reels/capture). */
  clip: string;
  /** Second of the footage shown at the cut. */
  from: number;
  /** Length in beats of the music. */
  beats: number;
  /** Playback speed (0.5 = slow motion). */
  rate?: number;
  /** Big caption; *word* is highlighted. */
  text?: string;
  /** Small label under the caption. */
  sub?: string;
  /** Highlight colour for *words* and the label. */
  accent?: string;
  /** Extra punch-zoom + flash this many beats into the cut (a hit landing mid-cut). */
  hits?: number[];
  /** Game sound level for this cut (default: the reel's). */
  sound?: number;
  /** Push in slowly over the cut (1 = none, 1.15 = 15% closer by the end). */
  push?: number;
};

export type ReelProps = {
  /** The music track (public/music/...), or null for game sound only. */
  music: string | null;
  /** Beat times in the track (s), as measured; the reel starts on the first. */
  grid: number[];
  musicVolume: number;
  gameVolume: number;
  /** A line held across the opening cuts (the hook). */
  hook?: string;
  hookBeats?: number;
  segments: Segment[];
  /** Beats of end card (logo + call to action) over the last cut. */
  endBeats: number;
  /** The game's name on the end card; *part* in the accent colour. */
  title: string;
  cta: string;
};
