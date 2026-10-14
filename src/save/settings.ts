export interface KeyBindings { panUp: string; panDown: string; panLeft: string; panRight: string; rotateLeft: string; rotateRight: string; focus: string; scan: string; pause: string; speed1: string; speed2: string; speed4: string }
export interface Settings {
  master: number; music: number; sfx: number;
  quality: 'high' | 'medium' | 'low';
  largeUI: boolean; colorBlind: boolean; edgePan: boolean;
  keys: KeyBindings;
  analyticsOptIn: boolean;
}

export const DEFAULT_KEYS: KeyBindings = { panUp: 'KeyW', panDown: 'KeyS', panLeft: 'KeyA', panRight: 'KeyD', rotateLeft: 'KeyQ', rotateRight: 'KeyE', focus: 'KeyF', scan: 'Space', pause: 'KeyP', speed1: 'Digit1', speed2: 'Digit2', speed4: 'Digit3' };
export const DEFAULT_SETTINGS: Settings = { master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', largeUI: false, colorBlind: false, edgePan: true, keys: { ...DEFAULT_KEYS }, analyticsOptIn: false };

const KEY = 'shelf-made:settings';

export function loadSettings(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, keys: { ...DEFAULT_KEYS, ...(parsed.keys ?? {}) } };
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}
