/** Deterministic PRNG (mulberry32). One stream per subsystem; fork by name. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  /** Current internal state, for saves. */
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, maxInclusive: number): number { return min + Math.floor(this.next() * (maxInclusive - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick from empty array');
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t; }
    return arr;
  }
  /** Gaussian-ish via sum of three uniforms. */
  normal(mean: number, sd: number): number { return mean + sd * (this.next() + this.next() + this.next() - 1.5) * 1.63; }
  fork(name: string): Rng { return new Rng(hashString(name) ^ Math.floor(this.next() * 0xffffffff)); }
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
