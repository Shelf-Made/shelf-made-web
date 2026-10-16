import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSettings, DEFAULT_SETTINGS } from './settings';

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
