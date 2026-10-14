/**
 * All audio is synthesised with WebAudio: no recordings, no downloads. Starts after the
 * first user gesture. Music changes with the time of day.
 */
export type Cue = 'beep' | 'cash' | 'chime' | 'click' | 'pick' | 'stock' | 'truck' | 'boxes' | 'reward' | 'night' | 'open' | 'order' | 'build' | 'bad' | 'engine';

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
  private engineNoise: AudioBufferSourceNode | null = null;

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
    this.ambienceGain.gain.value = this.volumes.sfx * 0.12;
  }

  setMood(mood: AudioEngine['mood']): void { this.mood = mood; }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, when = 0, dest: GainNode = this.sfxGain, slideTo?: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  private noise(dur: number, gain = 0.2, when = 0, filterHz = 2000): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t);
  }

  play(cue: Cue): void {
    if (!this.ctx) return;
    // Rate-limit identical cues so a crowd does not become a wall of chimes.
    const now = performance.now();
    const last = this.lastCue.get(cue) ?? 0;
    const minGap = cue === 'beep' ? 40 : cue === 'chime' ? 350 : 120;
    if (now - last < minGap) return;
    this.lastCue.set(cue, now);
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

  private startAmbience(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      // Pinkish noise.
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.08;
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    src.connect(f); f.connect(this.ambienceGain); src.start();
    this.engineNoise = src;
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
    this.engineNoise?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
