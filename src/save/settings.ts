export interface KeyBindings { forward: string; back: string; left: string; right: string; interact: string; scan: string; rotate: string; turnLeft: string; turnRight: string; focus: string; zoomIn: string; zoomOut: string; pause: string; speed1: string; speed2: string; speed4: string }
export interface Settings {
  master: number; music: number; sfx: number;
  quality: 'high' | 'medium' | 'low';
  largeUI: boolean; colorBlind: boolean;
  /** Camera drag speed multiplier. */
  lookSpeed: number;
  invertY: boolean;
  /** Pan the zoomed-out camera by moving the mouse to a screen edge. */
  edgePan: boolean;
  keys: KeyBindings;
  analyticsOptIn: boolean;
}

export const DEFAULT_KEYS: KeyBindings = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', interact: 'KeyF', scan: 'Space', rotate: 'KeyR', turnLeft: 'KeyQ', turnRight: 'KeyE', focus: 'KeyC', zoomIn: 'Equal', zoomOut: 'Minus', pause: 'KeyP', speed1: 'Digit1', speed2: 'Digit2', speed4: 'Digit3' };
export const DEFAULT_SETTINGS: Settings = { master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', largeUI: false, colorBlind: false, lookSpeed: 1, invertY: false, edgePan: false, keys: { ...DEFAULT_KEYS }, analyticsOptIn: false };

const KEY = 'shelf-made:settings';

export function loadSettings(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Keys from older builds (pan and rotate bindings) are dropped: only known actions survive.
    const keys = { ...DEFAULT_KEYS };
    for (const k of Object.keys(DEFAULT_KEYS) as (keyof KeyBindings)[]) { const v = parsed.keys?.[k]; if (typeof v === 'string') keys[k] = v; }
    // E used to mean Use; it turns the camera now. An old default moves to F.
    if (keys.interact === 'KeyE' && parsed.keys?.turnRight === undefined) keys.interact = 'KeyF';
    return { ...DEFAULT_SETTINGS, ...parsed, keys };
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
  if (code === 'Equal') return '+';
  if (code === 'Minus') return '−';
  return code;
}
