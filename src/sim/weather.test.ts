import { describe, it, expect } from 'vitest';
import { skyFor, forecastFor, weatherAt, lightningAt, STORM_TEXT, type Sky } from './weather';
import { openGame } from './testUtil';
import { applyCommand } from './commands';

const SKIES: Sky[] = ['clear', 'heat', 'fair', 'cloudy', 'showers', 'grey', 'drizzle', 'rain', 'storm'];

describe('weather', () => {
  it('follows the forecast: sun is clear, heavy rain is rain or a storm, nothing forecast is fair-ish', () => {
    const seen = new Set<Sky>();
    for (let day = 1; day < 200; day++) {
      expect(skyFor('Sunshine: a lovely day, more people walking.', 5, day)).toBe('clear');
      expect(skyFor('Heatwave: drinks and ice cream fly.', 5, day)).toBe('heat');
      expect(['rain', 'storm']).toContain(skyFor('Heavy rain: fewer walkers, more drivers.', 5, day));
      expect(['grey', 'drizzle']).toContain(skyFor('Grey and cold: soup weather.', 5, day));
      expect(['fair', 'cloudy', 'showers']).toContain(skyFor(null, 5, day));
      for (const f of [null, 'Heavy rain: fewer walkers, more drivers.', 'Grey and cold: soup weather.']) seen.add(skyFor(f, 5, day));
    }
    // Every variant turns up.
    for (const s of ['fair', 'cloudy', 'showers', 'rain', 'storm', 'grey', 'drizzle'] as Sky[]) expect(seen.has(s), s).toBe(true);
    expect(forecastFor('Heavy rain: fewer walkers, more drivers.', 'storm')).toBe(STORM_TEXT);
    expect(forecastFor('Heavy rain: fewer walkers, more drivers.', 'rain')).toBe('Heavy rain: fewer walkers, more drivers.');
  });

  it('moves through the day within bounds: dry skies stay dry, a storm builds and passes', () => {
    for (const sky of SKIES) for (let day = 1; day < 20; day++) {
      let maxRain = 0, maxStorm = 0;
      for (let t = 0; t <= 1; t += 0.01) {
        const w = weatherAt(sky, 9, day, t);
        for (const v of Object.values(w)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1.0001); }
        maxRain = Math.max(maxRain, w.rain); maxStorm = Math.max(maxStorm, w.storm);
      }
      if (['clear', 'heat', 'fair', 'cloudy', 'grey'].includes(sky)) expect(maxRain, sky).toBe(0);
      if (sky === 'rain' || sky === 'storm') expect(maxRain, sky).toBeGreaterThan(0.5);
      if (sky === 'storm') { expect(maxStorm).toBeGreaterThan(0.9); expect(weatherAt(sky, 9, day, 0).storm).toBeLessThan(0.05); }
      else expect(maxStorm).toBe(0);
    }
  });

  it('strikes lightning only in a storm, every several seconds at its height', () => {
    let n = 0;
    for (let c = 0; c < 600; c += 0.1) { const s = lightningAt(1, c + 0.1, 0.1, 3); if (s) { n++; expect(Math.hypot(s.x, s.z)).toBeGreaterThan(20); } }
    expect(n).toBeGreaterThan(30); expect(n).toBeLessThan(150);
    for (let c = 0; c < 600; c += 0.1) expect(lightningAt(0.1, c + 0.1, 0.1, 3)).toBeNull();
    // A long frame does not skip strikes in its window, nor double them.
    let a = 0, b = 0;
    for (let c = 0; c < 300; c += 0.05) if (lightningAt(1, c + 0.05, 0.05, 4)) a++;
    for (let c = 0; c < 300; c += 0.4) if (lightningAt(1, c + 0.4, 0.4, 4)) b++;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });

  it("is today's sky in the game: set when the day opens from last night's plan", () => {
    const s = openGame({ seed: 31, plotId: 'main', name: 'Skies' });
    expect(s.sky).toBeDefined();
    for (let i = 0; i < 8; i++) {
      s.phase = 'night'; s.tomorrow = null;
      applyCommand(s, { type: 'openTomorrow' });
      expect(s.sky).toBe(skyFor(s.notices.find((n) => n.day === s.day && /^(Sunshine|Heavy rain|Heatwave|Grey|Thunderstorms)/.test(n.text))?.text.replace(/^Thunderstorms.*/, 'Heavy rain').replace(/^Grey, cold and drizzly.*/, 'Grey and cold') ?? null, 31, s.day));
    }
  });
});
