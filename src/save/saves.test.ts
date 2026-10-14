import { openGame } from '@/sim/testUtil';
import { describe, it, expect } from 'vitest';
import { MemoryBackend } from './storage';
import { saveGame, loadGame, listSlots, parse, serialize } from './saves';
import { tick, SAVE_VERSION } from '@/sim/index';

describe('saves', () => {
  it('round-trips a game through the backend and keeps determinism', async () => {
    const b = new MemoryBackend();
    const s = openGame({ seed: 42, plotId: 'main', name: 'Round Trip' });
    for (let i = 0; i < 500; i++) tick(s);
    await saveGame(b, 'slot1', s);
    const loaded = (await loadGame(b, 'slot1'))!;
    expect(loaded.shop.name).toBe('Round Trip');
    for (let i = 0; i < 300; i++) { tick(s); tick(loaded); }
    expect(JSON.stringify(loaded)).toEqual(JSON.stringify(s));
    const slots = await listSlots(b);
    expect(slots[0]!.slot).toBe('slot1');
  });
  it('rejects foreign files and migrates old versions', () => {
    expect(() => parse('{"hello":1}')).toThrow();
    const s = openGame({ seed: 1, plotId: 'elm', name: 'Old' });
    const text = serialize(s).replace(`"version":${SAVE_VERSION}`, '"version":0');
    const f = parse(text);
    expect(f.state.version).toBe(SAVE_VERSION);
    expect(f.state.rivals.length).toBe(3);
  });
  it('moves a valley save onto the crossroads (v8 → v9)', () => {
    const s = openGame({ seed: 8, plotId: 'elm', name: 'Valley' });
    for (let i = 0; i < 400; i++) tick(s);
    const raw = JSON.parse(serialize(s)) as { version: number; state: Record<string, unknown> };
    const st = raw.state as Record<string, unknown> & { shop: Record<string, unknown>; rivals: Record<string, unknown>[]; franchises: unknown[] };
    // What a v8 save looked like: plot ids from the valley, rivals without corners, franchises on town plots.
    st.version = 8; raw.version = 8;
    st.shop.plotId = 'hill'; st.shop.originX = -22; st.shop.originZ = -1.6; delete st.shop.flip;
    for (const r of st.rivals) { delete r.corner; delete r.bays; delete r.branches; r.x = 20; r.z = 8.9; }
    delete st.streetBays; delete st.rivalSpawn;
    st.franchises = [{ id: 1, plotId: 'east', name: 'Valley East End', manager: { id: 2, name: 'Mo', role: 'manager', skill: 0.7, speed: 1, wage: 90, look: { model: 1, variant: 0, height: 1 } }, openedDay: 1, stockLevel: 0.6, reputation: 0.5, cashToday: 0, history: [], alerts: [] }];
    const f = parse(JSON.stringify(raw));
    expect(f.state.version).toBe(SAVE_VERSION);
    expect(f.state.shop.plotId).toBe('elm');
    expect(f.state.shop.originX).toBe(-15.5);
    expect(f.state.franchises[0]!.siteId).toBe('elmheights');
    expect(f.state.streetBays.length).toBe(3);
    expect(new Set(f.state.rivals.map((r) => r.corner))).toEqual(new Set(['ne', 'sw', 'se']));
    // The migrated game keeps running.
    for (let i = 0; i < 600; i++) tick(f.state);
    expect(f.state.stuckRescues).toBe(0);
  });
  it('keeps the shop colour scheme through a save, and gives older shops the green (v9 → v10)', async () => {
    const b = new MemoryBackend();
    const s = openGame({ seed: 5, plotId: 'bus', name: 'Berry Mart', scheme: 'berry' });
    await saveGame(b, 'slot2', s);
    expect((await loadGame(b, 'slot2'))!.shop.scheme).toBe('berry');
    const raw = JSON.parse(serialize(s)) as { version: number; state: { version: number; shop: { scheme?: string } } };
    raw.version = 9; raw.state.version = 9; delete raw.state.shop.scheme;
    expect(parse(JSON.stringify(raw)).state.shop.scheme).toBe('green');
  });
  it('gives older rivals an empty book of moves (v11 → v12)', () => {
    const s = openGame({ seed: 9, plotId: 'main', name: 'Older' });
    const raw = JSON.parse(serialize(s)) as { version: number; state: { version: number; rivals: Record<string, unknown>[] } };
    raw.version = 11; raw.state.version = 11;
    for (const r of raw.state.rivals) { delete r.responses; delete r.moveCooldown; delete r.cooldown; delete r.mods; }
    const st = parse(JSON.stringify(raw)).state;
    expect(st.version).toBe(SAVE_VERSION);
    for (const r of st.rivals) { expect(r.responses).toEqual([]); expect(r.moveCooldown).toEqual({}); expect(r.cooldown).toBe(0); }
    for (let i = 0; i < 300; i++) tick(st);
    expect(st.stuckRescues).toBe(0);
  });
  it('gives older saves the goal ladder, ticking off what their history shows (v10 → v11)', () => {
    const s = openGame({ seed: 6, plotId: 'main', name: 'Old Hand' });
    for (let i = 0; i < 400; i++) tick(s);
    const raw = JSON.parse(serialize(s)) as { version: number; state: Record<string, unknown> & { history: Record<string, unknown>[]; today: Record<string, unknown>; rivals: Record<string, unknown>[]; shop: { reputation: number } } };
    raw.version = 10; raw.state.version = 10;
    // What a v10 save looked like: no goals, no plan for tomorrow, no complaints, rivals without books.
    delete raw.state.goals; delete raw.state.tomorrow; delete raw.state.today.complaints;
    for (const r of raw.state.rivals) delete r.brokeDays;
    raw.state.history = [{ ...raw.state.today, day: 1, served: 34 }, { ...raw.state.today, day: 2, served: 20 }];
    raw.state.shop.reputation = 0.64;
    const st = parse(JSON.stringify(raw)).state;
    expect(st.version).toBe(SAVE_VERSION);
    // Thirty served and 60% reputation are in the history; out-selling Cheapo was never recorded, so that is next.
    expect(st.goals.done.map((d) => d.id)).toEqual(['doors', 'regulars']);
    expect(st.goals.unlocked).toContain('signLit');
    expect(st.goals.index).toBe(2);
    expect(st.tomorrow).toBeNull();
    for (const d of [st.today, ...st.history]) expect(d.complaints).toEqual({ outOfStock: {}, pricey: {}, queue: 0, lotFull: 0, dirty: 0 });
    for (const r of st.rivals) expect(r.brokeDays).toBe(0);
    // It plays on: the evening rolls tomorrow's plan.
    for (let i = 0; i < 20000 && st.phase !== 'night'; i++) tick(st);
    expect(st.tomorrow?.day).toBe(st.day + 1);
  });
});
