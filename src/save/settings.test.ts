import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSettings, DEFAULT_SETTINGS, DEFAULT_KEYS } from './settings';

describe('graphics quality in the saved settings', () => {
  const store = new Map<string, string>();
  const was = (globalThis as { localStorage?: unknown }).localStorage;
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  });
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = was; });

  it('keeps Limitless, and falls back to the default for anything it does not know', () => {
    store.set('shelf-made:settings', JSON.stringify({ quality: 'limitless' }));
    expect(loadSettings().quality).toBe('limitless');
    store.set('shelf-made:settings', JSON.stringify({ quality: 'ultra' }));
    expect(loadSettings().quality).toBe(DEFAULT_SETTINGS.quality);
    store.set('shelf-made:settings', JSON.stringify({ quality: 'low' }));
    expect(loadSettings().quality).toBe('low');
  });
});

describe('keys in older saved settings', () => {
  const store = new Map<string, string>();
  const was = (globalThis as { localStorage?: unknown }).localStorage;
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  });
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = was; });

  it('gives an action added since a spare key when its own is already taken, and leaves the rest as they were', () => {
    // Saved before first person and the stock tool: Pause on T, walking forward on V.
    const old: Partial<typeof DEFAULT_KEYS> = { ...DEFAULT_KEYS, pause: 'KeyT', forward: 'KeyV' };
    delete old.firstPerson; delete old.stockTool;
    store.set('shelf-made:settings', JSON.stringify({ keys: old }));
    const keys = loadSettings().keys;
    expect([keys.pause, keys.forward]).toEqual(['KeyT', 'KeyV']);
    expect([keys.firstPerson, keys.stockTool]).toEqual(['KeyG', 'KeyH']);
    expect(new Set(Object.values(keys)).size).toBe(Object.keys(keys).length);
    // With nothing in their way, they get their own keys.
    store.set('shelf-made:settings', JSON.stringify({ keys: { ...DEFAULT_KEYS, firstPerson: undefined, stockTool: undefined } }));
    expect([loadSettings().keys.firstPerson, loadSettings().keys.stockTool]).toEqual(['KeyV', 'KeyT']);
    // A clash the player chose themselves is theirs to keep.
    store.set('shelf-made:settings', JSON.stringify({ keys: { ...DEFAULT_KEYS, pause: 'KeyT' } }));
    expect([loadSettings().keys.pause, loadSettings().keys.stockTool]).toEqual(['KeyT', 'KeyT']);
  });
});
