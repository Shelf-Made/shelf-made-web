/** Graphics, from the lightest to Limitless (everything on, at full resolution: for a strong graphics card). */
export type Quality = 'limitless' | 'high' | 'medium' | 'low';
export interface KeyBindings { forward: string; back: string; left: string; right: string; interact: string; scan: string; rotate: string; turnLeft: string; turnRight: string; focus: string; firstPerson: string; stockTool: string; zoomIn: string; zoomOut: string; pause: string; speed1: string; speed2: string; speed4: string }
export interface Settings {
  master: number; music: number; sfx: number;
  quality: Quality;
  largeUI: boolean; colorBlind: boolean;
  /** Camera drag speed multiplier. */
  lookSpeed: number;
  invertY: boolean;
  /** Pan the zoomed-out camera by moving the mouse to a screen edge. */
  edgePan: boolean;
  keys: KeyBindings;
  analyticsOptIn: boolean;
  /** Your manager, as designed in the lobby (null: the shop worker as the game picks). Every game you play uses it. */
  managerLook: ManagerLook | null;
}

/** A designed manager: which character and height, and the colours chosen (each left out for the character's own). */
export interface ManagerLook { model: number; height: number; skin?: string; hair?: string; top?: string; bottom?: string }

export const DEFAULT_KEYS: KeyBindings = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', interact: 'KeyF', scan: 'Space', rotate: 'KeyR', turnLeft: 'KeyQ', turnRight: 'KeyE', focus: 'KeyC', firstPerson: 'KeyV', stockTool: 'KeyT', zoomIn: 'Equal', zoomOut: 'Minus', pause: 'KeyP', speed1: 'Digit1', speed2: 'Digit2', speed4: 'Digit3' };
export const DEFAULT_SETTINGS: Settings = { master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', largeUI: false, colorBlind: false, lookSpeed: 1, invertY: false, edgePan: false, keys: { ...DEFAULT_KEYS }, analyticsOptIn: false, managerLook: null };

const KEY = 'shelf-made:settings';
/** Keys nothing uses by default (nor B, Tab, the arrows and the rest the game keeps for itself), for a new action whose own key is taken. */
const SPARE_KEYS = ['KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'KeyN', 'KeyM', 'KeyO', 'KeyU', 'KeyI'];

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
    // An action new since these settings were saved (first person, the stock tool) never takes a key already chosen
    // for something else: it gets a spare one instead (shown in Settings and wherever its key is named).
    if (parsed.keys) for (const k of Object.keys(DEFAULT_KEYS) as (keyof KeyBindings)[]) {
      if (typeof parsed.keys[k] === 'string') continue;
      const taken = (code: string) => (Object.keys(keys) as (keyof KeyBindings)[]).some((o) => o !== k && keys[o] === code);
      if (taken(keys[k])) keys[k] = SPARE_KEYS.find((c) => !taken(c)) ?? keys[k];
    }
    const quality: Quality = (['limitless', 'high', 'medium', 'low'] as const).find((q) => q === parsed.quality) ?? DEFAULT_SETTINGS.quality;
    return { ...DEFAULT_SETTINGS, ...parsed, quality, keys };
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
