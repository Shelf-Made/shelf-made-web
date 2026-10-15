/**
 * The sky over the crossroads. Each day has a kind of weather, decided with the rest of tomorrow's
 * plan from its forecast (so the night card's "Heavy rain" is the rain you get), and within the day
 * the weather moves: fronts come over, showers pass, a thunderstorm builds, peaks and rolls away.
 *
 * Pure functions of the seed, the day and the time of day: nothing to save beyond the day's kind,
 * and the sim's random streams are untouched (the variants come from a hash of the seed and day).
 */
export type Sky = 'clear' | 'heat' | 'fair' | 'cloudy' | 'showers' | 'grey' | 'drizzle' | 'rain' | 'storm';

/** What the weather is doing at one moment, each 0..1: cloud cover, rain, how fierce the storm is, mist, wind. */
export interface WeatherNow { cloud: number; rain: number; storm: number; fog: number; wind: number }

/** A repeatable 0..1 hash of a few numbers. */
export function weatherHash(a: number, b: number, c = 0): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** The forecast lines (marketing's WEATHER table) and what they mean for the sky. */
const SUNNY = /^Sunshine/, RAIN = /^Heavy rain/, HEAT = /^Heatwave/, GREY = /^Grey and cold/;
export const STORM_TEXT = 'Thunderstorms: heavy rain and lightning, fewer walkers, more drivers.';
export const DRIZZLE_TEXT = 'Grey, cold and drizzly: soup weather.';

/**
 * The day's sky from its forecast. A forecast of heavy rain is a thunderstorm about half the time;
 * grey days often drizzle; a day with nothing forecast is fair, cloudy, or has a passing shower.
 */
export function skyFor(forecast: string | null, seed: number, day: number): Sky {
  const h = weatherHash(seed, day, 3);
  if (!forecast) return h < 0.16 ? 'showers' : h < 0.42 ? 'cloudy' : 'fair';
  if (SUNNY.test(forecast)) return 'clear';
  if (HEAT.test(forecast)) return 'heat';
  if (RAIN.test(forecast)) return h < 0.5 ? 'storm' : 'rain';
  if (GREY.test(forecast)) return h < 0.45 ? 'drizzle' : 'grey';
  return 'fair';
}

/** The forecast line for a sky (a storm or drizzle says so; the rest keep marketing's words). */
export function forecastFor(forecast: string | null, sky: Sky): string | null {
  if (sky === 'storm') return STORM_TEXT;
  if (sky === 'drizzle') return DRIZZLE_TEXT;
  return forecast;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** 0 outside [a, b], rising and falling smoothly over `edge` at each end. */
function window01(t: number, a: number, b: number, edge: number): number {
  const s = (x: number) => x * x * (3 - 2 * x);
  return s(clamp((t - a) / edge)) * s(clamp((b - t) / edge));
}
/** Slow waves: rain comes and goes in bands. */
function waves(t: number, seed: number, day: number): number {
  const p1 = weatherHash(seed, day, 11) * 6.28, p2 = weatherHash(seed, day, 12) * 6.28;
  return 0.5 + 0.3 * Math.sin(t * 17 + p1) + 0.2 * Math.sin(t * 41 + p2);
}

/** The weather at time t of day (0 at opening, 1 at closing; the night keeps the evening's). */
export function weatherAt(sky: Sky, seed: number, day: number, t: number): WeatherNow {
  const tt = clamp(t);
  const drift = 0.5 + 0.5 * Math.sin(tt * 9 + weatherHash(seed, day, 5) * 6.28);
  const wind = 0.15 + 0.25 * weatherHash(seed, day, 6) + 0.1 * Math.sin(tt * 23);
  switch (sky) {
    case 'clear': return { cloud: 0.04 + 0.08 * drift, rain: 0, storm: 0, fog: 0, wind };
    case 'heat': return { cloud: 0.02 + 0.04 * drift, rain: 0, storm: 0, fog: 0.18, wind: wind * 0.5 };
    case 'fair': return { cloud: 0.2 + 0.18 * drift, rain: 0, storm: 0, fog: 0, wind };
    case 'cloudy': return { cloud: 0.5 + 0.25 * drift, rain: 0, storm: 0, fog: 0.05, wind: wind + 0.1 };
    case 'showers': {
      // One or two showers pass over, each an hour or so: the sky darkens, it pours, it brightens again.
      const a = 0.12 + 0.3 * weatherHash(seed, day, 7), b = 0.55 + 0.3 * weatherHash(seed, day, 8);
      const s = Math.max(window01(tt, a, a + 0.12, 0.04), weatherHash(seed, day, 9) < 0.6 ? window01(tt, b, b + 0.1, 0.04) : 0);
      return { cloud: 0.3 + 0.6 * s + 0.1 * drift, rain: 0.65 * s * waves(tt, seed, day), storm: 0, fog: 0.1 * s, wind: wind + 0.25 * s };
    }
    case 'grey': return { cloud: 0.86 + 0.08 * drift, rain: 0, storm: 0, fog: 0.22, wind };
    case 'drizzle': return { cloud: 0.9 + 0.06 * drift, rain: 0.12 + 0.18 * waves(tt, seed, day), storm: 0, fog: 0.28, wind };
    case 'rain': return { cloud: 0.93 + 0.05 * drift, rain: clamp(0.45 + 0.45 * waves(tt, seed, day)), storm: 0, fog: 0.3, wind: wind + 0.15 };
    case 'storm': {
      // It builds through the day: rain from the start, the storm itself for a few hours somewhere after noon.
      const a = 0.25 + 0.3 * weatherHash(seed, day, 10), len = 0.25 + 0.15 * weatherHash(seed, day, 13);
      const s = window01(tt, a, a + len, 0.07);
      return { cloud: clamp(0.85 + 0.15 * s + 0.05 * drift), rain: clamp(0.4 + 0.3 * waves(tt, seed, day) + 0.4 * s), storm: s, fog: 0.3 + 0.1 * s, wind: clamp(wind + 0.2 + 0.35 * s) };
    }
  }
}

/**
 * Lightning during a storm: whether a strike starts in the `dt`-second window ending at `clock`
 * (seconds of real time, so strikes come at the same pace at any game speed), and where. Pure: a hash
 * of the strike's slot, so a given moment always does the same thing.
 */
export function lightningAt(storm: number, clock: number, dt: number, seed: number): { x: number; z: number; strength: number } | null {
  if (storm < 0.15) return null;
  // Strike slots every 0.8 s; each fires with a chance that rises with the storm (about every 5-15 s at its height).
  const slot = 0.8;
  const from = Math.floor((clock - dt) / slot), to = Math.floor(clock / slot);
  for (let k = from + 1; k <= to; k++) {
    if (weatherHash(seed, k, 21) < storm * 0.11) {
      const ang = weatherHash(seed, k, 22) * Math.PI * 2, r = 25 + weatherHash(seed, k, 23) * 70;
      return { x: Math.cos(ang) * r, z: Math.sin(ang) * r, strength: 0.6 + 0.4 * weatherHash(seed, k, 24) };
    }
  }
  return null;
}
