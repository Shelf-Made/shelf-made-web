/**
 * All audio is synthesised with WebAudio: no recordings, no downloads. Starts after the
 * first user gesture. Music changes with the time of day. Instead of a noise bed, the town
 * has birdsong by day and crickets at night, each call a few short tones.
 */
export type Cue = 'beep' | 'cash' | 'chime' | 'click' | 'pick' | 'stock' | 'truck' | 'boxes' | 'reward' | 'night' | 'open' | 'order' | 'build' | 'bad' | 'engine'
  | 'step' | 'place' | 'sell' | 'tick' | 'hire' | 'thud' | 'paper' | 'coin' | 'hover' | 'tap' | 'cardOpen' | 'cardClose' | 'whoosh' | 'spill' | 'grumble' | 'alarm' | 'caught' | 'quack' | 'rotate' | 'speed';

/** Per-play tweaks: loudness 0..1 and stereo position -1..1. */
export interface CueOpts { gain?: number; pan?: number }

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private ambienceGain!: GainNode;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private mood: 'morning' | 'day' | 'evening' | 'night' = 'morning';
  private volumes = { master: 0.8, music: 0.6, sfx: 0.9 };
  private lastCue = new Map<string, number>();
  private ambienceTimer: number | null = null;
  private stepN = 0;

  get started(): boolean { return this.ctx !== null; }

  /** Call from a user gesture. */
  start(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.ambienceGain = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicGain.connect(this.master); this.sfxGain.connect(this.master); this.ambienceGain.connect(this.master);
    this.applyVolumes();
    this.startAmbience();
    this.startMusic();
  }

  setVolumes(v: { master: number; music: number; sfx: number }): void { this.volumes = v; if (this.ctx) this.applyVolumes(); }
  private applyVolumes(): void {
    this.master.gain.value = this.volumes.master;
    this.musicGain.gain.value = this.volumes.music * 0.35;
    this.sfxGain.gain.value = this.volumes.sfx;
    this.ambienceGain.gain.value = this.volumes.sfx * 0.7;
  }

  setMood(mood: AudioEngine['mood']): void { this.mood = mood; }

  /** Scales and pans the cue being played (set by play()). */
  private cueGain = 1;
  private cuePan = 0;

  private out(dest: GainNode, pan: number): AudioNode {
    if (!this.ctx || !pan || !this.ctx.createStereoPanner) return dest;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest);
    return p;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, when = 0, dest: GainNode = this.sfxGain, slideTo?: number, pan?: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const peak = gain * (dest === this.sfxGain ? this.cueGain : 1);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out(dest, pan ?? (dest === this.sfxGain ? this.cuePan : 0))); o.start(t); o.stop(t + dur + 0.05);
  }

  /** A short filtered burst (a tap, a rustle, a scrape); never a continuous bed. */
  private noise(dur: number, gain = 0.2, when = 0, filterHz = 2000, type: BiquadFilterType = 'lowpass', sweepTo?: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const buf = this.ctx.createBuffer(1, Math.max(1, Math.floor(this.ctx.sampleRate * dur)), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(filterHz, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain(); g.gain.value = gain * this.cueGain;
    src.connect(f); f.connect(g); g.connect(this.out(this.sfxGain, this.cuePan)); src.start(t);
  }

  play(cue: Cue, opts: CueOpts = {}): void {
    if (!this.ctx) return;
    // Rate-limit identical cues so a crowd does not become a wall of chimes.
    const now = performance.now();
    const last = this.lastCue.get(cue) ?? 0;
    const minGap = cue === 'beep' ? 40 : cue === 'chime' ? 350 : cue === 'step' ? 150 : cue === 'hover' ? 60 : cue === 'whoosh' ? 250 : 120;
    if (now - last < minGap) return;
    this.lastCue.set(cue, now);
    this.cueGain = opts.gain ?? 1; this.cuePan = opts.pan ?? 0;
    this.cue(cue);
    this.cueGain = 1; this.cuePan = 0;
  }

  private cue(cue: Cue): void {
    switch (cue) {
      case 'beep': this.tone(1180, 0.07, 'square', 0.12); break;
      case 'cash': this.tone(1320, 0.09, 'sine', 0.25); this.tone(1760, 0.14, 'sine', 0.25, 0.08); this.tone(2640, 0.2, 'sine', 0.12, 0.16); this.noise(0.05, 0.08, 0, 6000); break;
      case 'chime': this.tone(659, 0.18, 'sine', 0.18); this.tone(523, 0.28, 'sine', 0.18, 0.14); break;
      case 'click': this.noise(0.03, 0.15, 0, 3000); this.tone(600, 0.04, 'triangle', 0.08); break;
      case 'pick': this.tone(420, 0.08, 'sine', 0.12, 0, this.sfxGain, 260); break;
      case 'stock': this.tone(140, 0.12, 'triangle', 0.25, 0, this.sfxGain, 70); this.noise(0.06, 0.1, 0, 800); break;
      case 'boxes': for (let i = 0; i < 3; i++) { this.tone(120, 0.1, 'triangle', 0.2, i * 0.12, this.sfxGain, 60); this.noise(0.05, 0.08, i * 0.12, 700); } break;
      case 'truck': this.engine(1.8, 70); break;
      case 'engine': this.engine(0.9, 95); break;
      case 'reward': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, i * 0.09)); break;
      case 'night': [784, 659, 523].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.16, i * 0.16)); break;
      case 'open': [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.16, i * 0.1)); this.tone(1047, 0.4, 'triangle', 0.16, 0.3); break;
      case 'order': this.tone(880, 0.06, 'square', 0.08); this.tone(1175, 0.12, 'sine', 0.14, 0.07); break;
      case 'build': this.noise(0.08, 0.3, 0, 1200); this.tone(220, 0.08, 'triangle', 0.2, 0, this.sfxGain, 110); break;
      case 'bad': this.tone(330, 0.12, 'square', 0.1); this.tone(262, 0.2, 'square', 0.1, 0.12); break;
      // Footsteps: a soft heel thud and a scuff, alternating feet.
      case 'step': { const k = this.stepN++ % 2; this.tone(k ? 92 : 104, 0.06, 'sine', 0.16, 0, this.sfxGain, 60); this.noise(0.045, 0.05, 0.005, 900 + k * 200); break; }
      case 'place': this.tone(160, 0.14, 'triangle', 0.26, 0, this.sfxGain, 80); this.noise(0.07, 0.14, 0, 1500); this.tone(660, 0.08, 'sine', 0.08, 0.1); break;
      case 'rotate': this.noise(0.09, 0.1, 0, 600, 'bandpass', 2400); this.tone(520, 0.05, 'triangle', 0.06, 0.06); break;
      case 'sell': this.noise(0.12, 0.12, 0, 2400, 'bandpass', 500); this.tone(880, 0.08, 'sine', 0.12, 0.1); this.tone(1320, 0.12, 'sine', 0.1, 0.17); break;
      case 'tick': this.tone(1500, 0.025, 'triangle', 0.08); break;
      case 'speed': this.tone(700, 0.05, 'triangle', 0.1); this.tone(1050, 0.06, 'triangle', 0.08, 0.05); break;
      case 'hire': [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.13, i * 0.07)); break;
      case 'thud': this.tone(120, 0.2, 'sine', 0.24, 0, this.sfxGain, 55); this.noise(0.06, 0.1, 0, 500); break;
      case 'paper': this.noise(0.18, 0.16, 0, 3500, 'highpass'); this.noise(0.1, 0.1, 0.16, 5000, 'highpass'); break;
      case 'coin': this.tone(1568, 0.07, 'sine', 0.16); this.tone(2093, 0.16, 'sine', 0.14, 0.06); break;
      case 'hover': this.tone(1900, 0.018, 'sine', 0.035); break;
      case 'tap': this.tone(520, 0.06, 'sine', 0.14, 0, this.sfxGain, 900); this.tone(1040, 0.04, 'triangle', 0.05, 0.02); break;
      case 'cardOpen': this.noise(0.16, 0.09, 0, 500, 'bandpass', 3200); this.tone(660, 0.1, 'sine', 0.08, 0.06, this.sfxGain, 990); break;
      case 'cardClose': this.noise(0.14, 0.08, 0, 3000, 'bandpass', 450); this.tone(800, 0.08, 'sine', 0.06, 0.02, this.sfxGain, 520); break;
      case 'whoosh': this.noise(0.9, 0.22, 0, 300, 'bandpass', 1400); this.tone(110, 0.8, 'sawtooth', 0.025, 0, this.sfxGain, 80); break;
      case 'spill': this.noise(0.25, 0.14, 0, 1800, 'lowpass', 300); this.tone(300, 0.12, 'sine', 0.08, 0.02, this.sfxGain, 150); break;
      // A shoplifter bolts: a shop alarm's two-tone whoop. Caught: three rising notes.
      case 'alarm': for (let i = 0; i < 4; i++) this.tone(i % 2 ? 660 : 880, 0.13, 'square', 0.07, i * 0.14); break;
      case 'caught': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.12, i * 0.07)); break;
      case 'grumble': this.tone(180, 0.16, 'sawtooth', 0.05, 0, this.sfxGain, 140); this.tone(150, 0.22, 'sawtooth', 0.05, 0.15, this.sfxGain, 110); break;
      case 'quack': for (let i = 0; i < 2; i++) { this.tone(520, 0.11, 'square', 0.03, i * 0.17, this.ambienceGain, 380); this.tone(1040, 0.08, 'sawtooth', 0.012, i * 0.17, this.ambienceGain, 760); } break;
    }
  }

  private engine(dur: number, hz: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(hz, t); o.frequency.linearRampToValueAtTime(hz * 1.4, t + dur * 0.4); o.frequency.linearRampToValueAtTime(hz * 0.8, t + dur);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.1);
  }

  /** Nature: a bird call every few seconds by day, a cricket chorus after dark. */
  private startAmbience(): void {
    if (!this.ctx) return;
    const loop = () => {
      if (!this.ctx) return;
      const night = this.mood === 'night';
      // Birds and crickets keep quiet in the rain.
      if (this.rain > 0.2) { /* only the rain */ } else if (night) this.crickets(); else if (Math.random() < 0.85) this.bird(); else this.play('quack', { gain: 0.5, pan: Math.random() * 2 - 1 });
      this.ambienceTimer = window.setTimeout(loop, (night ? 1400 : 1800) + Math.random() * (night ? 2200 : 4200));
    };
    this.ambienceTimer = window.setTimeout(loop, 1500);
  }

  // ---- Weather: rain as a patter of drops (never a hiss), and thunder.
  private rain = 0;
  private rainTimer: number | null = null;
  /** How hard it is raining, 0..1: the patter thickens and, in a downpour, a soft roar under it. */
  setRain(level: number): void {
    this.rain = Math.max(0, Math.min(1, level));
    if (!this.ctx || this.rainTimer !== null || this.rain < 0.03) return;
    const loop = () => {
      this.rainTimer = null;
      if (!this.ctx || this.rain < 0.03) return;
      // A handful of drops on leaves, roofs and the road, each a tiny bright click somewhere round you.
      const n = 2 + Math.floor(this.rain * 7);
      for (let i = 0; i < n; i++) this.drop(Math.random() * 0.09);
      if (this.rain > 0.55 && Math.random() < 0.5) this.ambientNoise(0.5, 0.012 * this.rain, 900, 'lowpass');
      this.rainTimer = window.setTimeout(loop, 90);
    };
    loop();
  }
  private drop(when: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when, dur = 0.008 + Math.random() * 0.012;
    const buf = this.ctx.createBuffer(1, Math.max(1, Math.floor(this.ctx.sampleRate * dur)), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500 + Math.random() * 4500; f.Q.value = 1.2;
    const g = this.ctx.createGain(); g.gain.value = (0.02 + Math.random() * 0.035) * (0.5 + this.rain * 0.6);
    src.connect(f); f.connect(g); g.connect(this.out(this.ambienceGain, Math.random() * 1.8 - 0.9)); src.start(t);
  }
  /** A soft noise wash on the ambience bus (the roar under a downpour, the tail of a rumble). */
  private ambientNoise(dur: number, gain: number, hz: number, type: BiquadFilterType, when = 0, attack = 0.15): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const buf = this.ctx.createBuffer(1, Math.max(1, Math.floor(this.ctx.sampleRate * dur)), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 6; }
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.ambienceGain); src.start(t);
  }
  /**
   * Thunder from a strike `distance` units away, heard `delay` seconds after the flash: a sharp crack
   * when it is close, then a long low rumble that rolls and fades (deeper and quieter from further off).
   */
  thunder(distance: number, delay: number, strength = 1): void {
    if (!this.ctx) return;
    const near = Math.max(0, 1 - distance / 60), loud = Math.min(1, strength * (0.35 + 0.65 * Math.max(0, 1 - distance / 140)));
    if (near > 0.3) { this.ambientNoise(0.35, 0.22 * near * loud, 3200, 'highpass', delay, 0.005); this.ambientNoise(0.6, 0.3 * near * loud, 700, 'lowpass', delay, 0.01); }
    const len = 2.5 + Math.random() * 2.5;
    this.ambientNoise(len, 0.32 * loud, 140 + near * 160, 'lowpass', delay + 0.05, 0.25 + (1 - near) * 0.4);
    // A second roll a moment later.
    this.ambientNoise(len * 0.8, 0.2 * loud, 110, 'lowpass', delay + 0.6 + Math.random() * 0.8, 0.4);
  }

  private bird(): void {
    if (!this.ctx) return;
    const pan = Math.random() * 1.6 - 0.8, base = 2400 + Math.random() * 2200;
    const kind = Math.floor(Math.random() * 3);
    const notes = kind === 0 ? 2 + Math.floor(Math.random() * 3) : kind === 1 ? 1 : 5;
    for (let i = 0; i < notes; i++) {
      const f = kind === 1 ? base * 0.8 : base * (1 + (i % 2) * 0.12);
      const len = kind === 2 ? 0.035 : 0.08 + Math.random() * 0.05;
      this.tone(f, len, 'sine', 0.05, i * (kind === 2 ? 0.05 : 0.13), this.ambienceGain, kind === 1 ? f * 1.5 : f * (i % 2 ? 0.82 : 1.18), pan);
    }
  }

  private crickets(): void {
    const pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 6; i++) this.tone(4400 + Math.random() * 120, 0.025, 'sine', 0.022, i * 0.06, this.ambienceGain, undefined, pan);
  }

  /** A gentle sequencer: chords on a triangle pad, plucked bass, a sine lead. */
  private startMusic(): void {
    if (!this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    const tickMusic = () => {
      if (!this.ctx) return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.3) { this.scheduleStep(this.nextNoteTime); this.nextNoteTime += this.stepLength(); this.step++; }
      this.musicTimer = window.setTimeout(tickMusic, 90);
    };
    tickMusic();
  }

  private stepLength(): number { return this.mood === 'night' ? 0.42 : this.mood === 'evening' ? 0.34 : 0.3; }

  private scheduleStep(t: number): void {
    if (!this.ctx) return;
    const progressions: Record<AudioEngine['mood'], number[][]> = {
      morning: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]],
      day: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]],
      evening: [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 10, 14]],
      night: [[0, 4, 7, 11], [5, 9, 12, 16], [9, 12, 16], [7, 11, 14]],
    };
    const base = this.mood === 'evening' ? 220 : this.mood === 'night' ? 196 : 261.6;
    const bar = Math.floor(this.step / 8) % 4;
    const chord = progressions[this.mood][bar]!;
    const freq = (semi: number) => base * Math.pow(2, semi / 12);
    const inBar = this.step % 8;
    const when = t - this.ctx.currentTime;
    if (inBar === 0) {
      for (const n of chord) this.tone(freq(n) / 2, this.stepLength() * 7.5, 'triangle', 0.05, when, this.musicGain);
      this.tone(freq(chord[0]!) / 4, this.stepLength() * 3, 'sine', 0.11, when, this.musicGain);
    }
    if (inBar === 4) this.tone(freq(chord[0]!) / 4, this.stepLength() * 2, 'sine', 0.09, when, this.musicGain);
    if (this.mood !== 'night' && (inBar % 2 === 0)) {
      const melodyNotes = [0, 2, 4, 7, 9, 12, 7, 4];
      const n = melodyNotes[(this.step + bar * 3) % melodyNotes.length]!;
      if ((this.step * 7 + bar) % 3 !== 0) this.tone(freq(n) * 2, this.stepLength() * 1.6, 'sine', 0.06, when, this.musicGain);
    }
  }

  dispose(): void {
    if (this.musicTimer) clearTimeout(this.musicTimer);
    if (this.ambienceTimer) clearTimeout(this.ambienceTimer);
    if (this.rainTimer) clearTimeout(this.rainTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
