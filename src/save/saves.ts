import type { GameState } from '@/sim/types';
import { SAVE_VERSION } from '@/sim/newGame';
import { makeRivals } from '@/sim/rivals';
import { makeMarket } from '@/sim/market';
import { DEFAULT_RULES } from '@/sim/staff';
import { makeMarketing } from '@/sim/marketing';
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
];

export function migrate(file: SaveFile): SaveFile {
  let raw = file.state as unknown as Record<string, unknown>;
  let v = typeof raw.version === 'number' ? raw.version : 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no migration from save version ${v}`);
    raw = step(raw); v = raw.version as number;
  }
  if (v > SAVE_VERSION) throw new Error(`save is from a newer version (${v})`);
  return { ...file, version: v, state: raw as unknown as GameState };
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
