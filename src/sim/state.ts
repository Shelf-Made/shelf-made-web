/** Helpers over GameState: RNG streams, ids, popups, sound cues, grid cache. */
import { Rng, hashString } from './rng';
import type { GameState, Popup, Vec2, ReactionKind } from './types';
import { buildGrid, type Grid } from './grid';

export function withRng<T>(state: GameState, stream: string, fn: (r: Rng) => T): T {
  const r = new Rng(state.rng[stream] ?? ((state.seed ^ hashString(stream)) >>> 0));
  const out = fn(r);
  state.rng[stream] = r.state;
  return out;
}

export function nextId(state: GameState): number { return state.nextId++; }

export function popup(state: GameState, at: Vec2, text: string, kind: Popup['kind'] = 'info', y = 1.0): void {
  state.popups.push({ id: nextId(state), x: at.x, z: at.z, y, text, kind, tick: state.tick });
  if (state.popups.length > 40) state.popups.splice(0, state.popups.length - 40);
}

/**
 * A shopper's reaction, for the renderer's bubbles. One per person every few seconds, and the cheerful
 * ones ("great deal", "love this place") at most every few seconds across the shop, so the floor never
 * fills with icons.
 */
export function react(state: GameState, personId: number, kind: ReactionKind): void {
  const recent = (s: number) => state.tick - s * 20;
  if (state.reactions.some((r) => r.personId === personId && r.tick > recent(6))) return;
  if ((kind === 'deal' || kind === 'love') && state.reactions.some((r) => r.kind === kind && r.tick > recent(5))) return;
  state.reactions.push({ id: nextId(state), personId, kind, tick: state.tick });
  if (state.reactions.length > 16) state.reactions.splice(0, state.reactions.length - 16);
}

export function cue(state: GameState, sound: string): void {
  if (state.sounds.length < 32) state.sounds.push(sound);
}

let gridCache: { key: string; version: number; grid: Grid } | null = null;

/** Cached pathfinding grid; rebuilt when the shop layout version changes. */
export function gridFor(state: GameState): Grid {
  const shop = state.shop;
  const key = `${state.seed}:${shop.plotId}`;
  if (!gridCache || gridCache.key !== key || gridCache.version !== shop.layoutVersion) {
    gridCache = { key, version: shop.layoutVersion, grid: buildGrid(shop, shop.layoutVersion) };
  }
  return gridCache.grid;
}

export function resetGridCache(): void { gridCache = null; }

export function clockLabel(time: number): string {
  const totalMin = 8 * 60 + Math.floor(time / 60) * 60 + Math.floor((time % 60));
  const h24 = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

export function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.z - b.z); }
