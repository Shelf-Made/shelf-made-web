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
    const s = openGame({ seed: 1, plotId: 'hill', name: 'Old' });
    const text = serialize(s).replace(`"version":${SAVE_VERSION}`, '"version":0');
    const f = parse(text);
    expect(f.state.version).toBe(SAVE_VERSION);
    expect(f.state.rivals.length).toBe(3);
  });
});
