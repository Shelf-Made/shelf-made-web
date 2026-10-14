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
});
