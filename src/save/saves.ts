import type { GameState, Franchise } from '@/sim/types';
import { storeFrame, lotLayout, paintedBays, toWorld, yawToWorld, STREET_BAYS, OFFMAP_SITES } from '@/sim/layout';

import { makeRivals, RIVAL_ECON } from '@/sim/rivals';
import { SAVE_VERSION, emptyComplaints, makeGoals } from '@/sim/newGame';
import { inferGoals } from '@/sim/goals';
import { makeMarket } from '@/sim/market';
import { DEFAULT_RULES, staffLook } from '@/sim/staff';
import { windowsFromSides, stepOnInside, bandsWrittenDown } from '@/sim/build';
import { makeMarketing } from '@/sim/marketing';
import { letOwnerOut } from '@/sim/people';
import { resetGridCache } from '@/sim/state';
import type { StorageBackend } from './storage';

export interface SaveFile { format: 'shelf-made-save'; version: number; savedAt: string; name: string; day: number; cash: number; state: GameState }
export interface SlotInfo { slot: string; name: string; day: number; cash: number; savedAt: string }

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type Slot = typeof SLOTS[number];

/** Ordered migrations: each takes a save at version n and returns version n+1. */
const MIGRATIONS: ((raw: Record<string, unknown>) => Record<string, unknown>)[] = [
  // v0 → v1: the first public format; nothing to do.
  (raw) => ({ ...raw, version: 1 }),
  // v1 → v2: rivals, store scores, notices, demand.
  (raw) => ({
    rivals: makeRivals(), scores: { avgWait: 20, waitSum: 0, waitSamples: 0, last: null }, notices: [], demandBase: 48, eventDemand: 1,
    ...raw, version: 2,
  }),
  // v2 → v3: market, bills, loans, fail state.
  (raw) => ({ market: makeMarket(), bills: [], loans: [], brokeDays: 0, rescueOffered: false, gameOver: false, ...raw, version: 3 }),
  // v3 → v4: staff pool, manager rules, litter.
  (raw) => { const shop = raw.shop as { litter?: unknown[] }; shop.litter ??= []; return { staffPool: [], rules: { ...DEFAULT_RULES }, ...raw, version: 4 }; },
  // v4 → v5: shop size and lot rows.
  (raw) => { const shop = raw.shop as { sizeId?: string; lotRows?: number }; shop.sizeId ??= 'starter'; shop.lotRows ??= 1; return { ...raw, version: 5 }; },
  // v5 → v6: marketing.
  (raw) => ({ marketing: makeMarketing(), ...raw, version: 6 }),
  // v6 → v7: franchises.
  (raw) => ({ franchises: [], ...raw, version: 7 }),
  // v7 → v8: one-room shops with a delivery zone; old shops keep their storeroom strip.
  (raw) => { const shop = raw.shop as { floor: { x0: number; z0: number }; storeroom: { z0: number }; delivery?: unknown }; shop.delivery ??= { x0: shop.floor.x0, z0: shop.storeroom.z0, x1: shop.floor.x0 + 2, z1: shop.storeroom.z0 + 1 }; return { timeScale: 1, ...raw, version: 8 }; },
  // v8 → v9: the crossroads. Plots became corners, rivals took the other corners, franchises moved off the map.
  (raw) => migrateToCrossroads(raw),
  // v9 → v10: shop colour schemes; every older shop keeps today's green.
  (raw) => { const shop = raw.shop as { scheme?: string }; shop.scheme ??= 'green'; return { reactions: [], ...raw, version: 10 }; },
  // v10 → v11: the goal ladder (ticked off from history where it can tell), rival books, complaints, tomorrow's plan.
  (raw) => migrateGoals(raw),
  // v11 → v12: rivals answer the player (no moves yet); shoppers carry why they chose a store (new ones only).
  (raw) => { for (const r of (raw as unknown as GameState).rivals) { r.responses ??= []; r.moveCooldown ??= {}; r.cooldown ??= 0; } return { ...raw, version: 12 }; },
];

/** Old plot ids to the corners that replaced them; old franchise plots to off-map sites. */
export const PLOT_MIGRATION: Record<string, string> = { main: 'main', hill: 'elm', east: 'bus' };
export const FRANCHISE_SITE_MIGRATION: Record<string, string> = { main: 'eastend', hill: 'hillside', east: 'elmheights' };

function migrateToCrossroads(raw: Record<string, unknown>): Record<string, unknown> {
  const s = raw as unknown as GameState;
  const plotId = PLOT_MIGRATION[s.shop.plotId] ?? 'main';
  const fr = storeFrame(plotId);
  const shop = s.shop;
  shop.plotId = plotId; shop.originX = fr.originX; shop.originZ = fr.originZ; shop.flip = fr.flip;
  shop.bays = lotLayout(shop).bays.map((b) => ({ ...toWorld(fr, b.x, b.z), yaw: yawToWorld(fr, b.yaw), carId: null }));
  // Rivals keep their trading state and move onto their corners.
  const fresh = makeRivals(plotId);
  s.rivals = fresh.map((r) => { const old = (s.rivals ?? []).find((o) => o.id === r.id); return old ? { ...r, open: old.open, saleDaysLeft: old.saleDaysLeft, nextSaleDay: old.nextSaleDay, cash: old.cash, reputation: old.reputation, awareness: old.awareness, parking: old.parking, stores: old.stores, branches: OFFMAP_SITES.slice(1, old.stores).map((x) => x.id) } : r; });
  const oldFranchises = (s.franchises ?? []) as (Franchise & { plotId?: string })[];
  s.franchises = oldFranchises.map((f) => { const { plotId: old, ...rest } = f; return { ...rest, siteId: f.siteId ?? FRANCHISE_SITE_MIGRATION[old ?? ''] ?? 'riverside' }; });
  s.streetBays = STREET_BAYS.map((b) => ({ ...b, carId: null }));
  // Flyer areas and billboards moved too: valley plots became neighbourhoods off the map, abstract boards became real ones.
  const area: Record<string, string> = { main: 'eastend', hill: 'hillside', east: 'eastend' };
  const board: Record<string, string> = { highway: 'edge', school: 'roof', station: 'bus' };
  if (s.marketing) {
    for (const c of s.marketing.campaigns ?? []) c.areaId = area[c.areaId] ?? c.areaId;
    s.marketing.billboards = [...new Set((s.marketing.billboards ?? []).map((b) => board[b] ?? b))];
  }
  s.rivalSpawn = 0;
  // Everything in motion was laid out for the old map: cars go, shoppers go, staff and you step back inside.
  s.cars = [];
  for (const o of s.orders ?? []) if (o.state === 'arriving') { o.state = 'pending'; o.eta = 1; }
  s.people = (s.people ?? []).filter((p) => p.kind === 'owner' || p.kind === 'staff');
  for (const [i, p] of s.people.entries()) {
    const w = toWorld(fr, shop.door.x + 0.6 - (i % 3) * 0.6, shop.door.z - 1.4 - Math.floor(i / 3) * 0.6);
    p.x = p.px = w.x; p.z = p.pz = w.z; p.path = []; p.pathIdx = 0; p.state = 'idle'; p.task = null; p.carrying = null; p.moveDir = null;
  }
  for (const f of shop.fixtures) if (f.queue) { f.queue = []; f.serving = null; f.scanned = 0; }
  return { ...raw, version: 9 };
}

function migrateGoals(raw: Record<string, unknown>): Record<string, unknown> {
  const st = raw as unknown as GameState;
  for (const d of [st.today, ...st.history]) d.complaints ??= emptyComplaints();
  for (const r of st.rivals) { r.brokeDays ??= 0; r.cash = Math.min(r.cash, RIVAL_ECON[r.kind].cash); }
  st.tomorrow = null;
  st.goals = makeGoals();
  inferGoals(st);
  return { ...raw, version: 11 };
}

export function migrate(file: SaveFile): SaveFile {
  let raw = file.state as unknown as Record<string, unknown>;
  let v = typeof raw.version === 'number' ? raw.version : 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no migration from save version ${v}`);
    raw = step(raw); v = raw.version as number;
  }
  if (v > SAVE_VERSION) throw new Error(`save is from a newer version (${v})`);
  // Elm Street's bays moved apart (same count, same version): seat them where they stand now.
  const st = raw as unknown as GameState;
  if (Array.isArray(st.streetBays)) st.streetBays = STREET_BAYS.map((b, i) => ({ ...b, carId: st.streetBays[i]?.carId ?? null }));
  // A storeroom strip from the oldest saves is floor now (the walls go round the floor's tiles).
  const sr = st.shop.storeroom;
  if (sr && sr.z1 > sr.z0) { st.shop.floor = { ...st.shop.floor, z0: Math.min(st.shop.floor.z0, sr.z0) }; st.shop.storeroom = { x0: st.shop.floor.x0, z0: st.shop.floor.z0, x1: st.shop.floor.x1, z1: st.shop.floor.z0 }; }
  // Whole walls of windows become a Window piece on each tile of them.
  windowsFromSides(st);
  // Painted bands on every wall, said nowhere: written down stretch by stretch, and new walls come plain.
  bandsWrittenDown(st);
  // Bays were painted a row at a time: the same bays, in the same order, as a plan to paint one at a time from.
  if (!st.shop.bayPlan) {
    st.shop.bayPlan = paintedBays(st.shop).bays.map((b) => b.id);
    st.shop.bays = lotLayout(st.shop).bays.map((b, i) => ({ ...toWorld(st.shop, b.x, b.z), yaw: yawToWorld(st.shop, b.yaw), carId: st.shop.bays[i]?.carId ?? null }));
  }
  // Staff all wore the one shop-worker character: each gets a look of their own.
  for (const p of st.people ?? []) if (p.kind === 'staff' && p.look.model >= 12) p.look = staffLook(p.id, { model: p.id % 12, variant: p.look.variant, height: p.look.height });
  // Stairs put facing out through a wall (the first build of floors let that by) are turned to step on from inside.
  stepOnInside(st);
  // The manager walled in, or out past the walking grid (a click refused once still walked them there): back inside.
  resetGridCache();
  letOwnerOut(st);
  return { ...file, version: v, state: st };
}

export function serialize(state: GameState): string {
  const file: SaveFile = { format: 'shelf-made-save', version: state.version, savedAt: new Date().toISOString(), name: state.shop.name, day: state.day, cash: state.cash, state };
  return JSON.stringify(file);
}

export function parse(text: string): SaveFile {
  const file = JSON.parse(text) as SaveFile;
  if (file.format !== 'shelf-made-save' || !file.state) throw new Error('Not a Shelf Made save.');
  return migrate(file);
}

export async function saveGame(backend: StorageBackend, slot: Slot, state: GameState): Promise<void> {
  await backend.set(`save:${slot}`, serialize(state));
}

export async function loadGame(backend: StorageBackend, slot: Slot): Promise<GameState | null> {
  const text = await backend.get(`save:${slot}`);
  if (!text) return null;
  return parse(text).state;
}

export async function deleteSave(backend: StorageBackend, slot: Slot): Promise<void> { await backend.delete(`save:${slot}`); }

export async function listSlots(backend: StorageBackend): Promise<SlotInfo[]> {
  const out: SlotInfo[] = [];
  for (const slot of SLOTS) {
    const text = await backend.get(`save:${slot}`);
    if (!text) continue;
    try {
      const f = JSON.parse(text) as SaveFile;
      out.push({ slot, name: f.name, day: f.day, cash: f.cash, savedAt: f.savedAt });
    } catch { /* corrupt slot: skip */ }
  }
  return out;
}
