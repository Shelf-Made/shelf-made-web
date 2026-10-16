import { useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { DEFAULT_KEYS, keyLabel, type KeyBindings } from '@/save/settings';

export function SettingsBody({ runtime, snap, inLobby }: { runtime: GameRuntime; snap: Snapshot; inLobby?: boolean }) {
  const st = snap.settings;
  const [rebinding, setRebinding] = useState<keyof KeyBindings | null>(null);
  const slider = (label: string, key: 'master' | 'music' | 'sfx') => (
    <label className="row between" key={key}><span style={{ minWidth: 70 }}>{label}</span><input type="range" min={0} max={1} step={0.05} value={st[key]} onChange={(e) => runtime.updateSettings({ [key]: Number(e.target.value) })} aria-label={`${label} volume`} /></label>
  );
  const keys: [keyof KeyBindings, string][] = [['forward', 'Walk forward'], ['back', 'Walk back'], ['left', 'Walk left'], ['right', 'Walk right'], ['interact', 'Use / pick up / stock'], ['scan', 'Scan item'], ['rotate', 'Turn fixture'], ['turnLeft', 'Turn camera left'], ['turnRight', 'Turn camera right'], ['focus', 'Camera back to you'], ['firstPerson', 'First person'], ['zoomIn', 'Zoom in'], ['zoomOut', 'Zoom out'], ['pause', 'Pause'], ['speed1', '1x'], ['speed2', '2x'], ['speed4', '4x']];
  return (
    <>
      <h3>Sound</h3>
      {slider('Master', 'master')}{slider('Music', 'music')}{slider('Effects', 'sfx')}
      <h3>Display</h3>
      <label className="row between"><span>Quality</span>
        <select value={st.quality} onChange={(e) => runtime.updateSettings({ quality: e.target.value as 'high' | 'medium' | 'low' })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low (no shadows)</option></select>
      </label>
      <label className="toggle"><span>Larger UI</span><input type="checkbox" checked={st.largeUI} onChange={(e) => runtime.updateSettings({ largeUI: e.target.checked })} /></label>
      <label className="toggle"><span>Colour-blind markers</span><input type="checkbox" checked={st.colorBlind} onChange={(e) => runtime.updateSettings({ colorBlind: e.target.checked })} /></label>
      <h3>Camera</h3>
      <label className="row between"><span style={{ minWidth: 70 }}>Turn speed</span><input type="range" min={0.3} max={2.5} step={0.05} value={st.lookSpeed} onChange={(e) => runtime.updateSettings({ lookSpeed: Number(e.target.value) })} aria-label="Camera turn speed" /></label>
      <label className="toggle"><span>Invert tilt when dragging</span><input type="checkbox" checked={st.invertY} onChange={(e) => runtime.updateSettings({ invertY: e.target.checked })} /></label>
      <label className="toggle"><span>Pan at the screen edges when zoomed out</span><input type="checkbox" checked={st.edgePan} onChange={(e) => runtime.updateSettings({ edgePan: e.target.checked })} /></label>
      <h3>Keys</h3>
      {keys.map(([k, label]) => (
        <div className="keyrow" key={k}><span>{label}</span>
          <button className="key" onClick={() => setRebinding(k)} onKeyDown={(e) => { if (rebinding === k) { e.preventDefault(); runtime.updateSettings({ keys: { ...st.keys, [k]: e.code } }); setRebinding(null); } }} aria-label={`${label} key, currently ${keyLabel(st.keys[k])}`}>{rebinding === k ? 'press a key' : keyLabel(st.keys[k])}</button>
        </div>
      ))}
      <button className="btn small ghost" onClick={() => runtime.updateSettings({ keys: { ...DEFAULT_KEYS } })}>Reset keys</button>
      <h3>Privacy</h3>
      <label className="toggle"><span>Share anonymous play stats (off by default)</span><input type="checkbox" checked={st.analyticsOptIn} onChange={(e) => runtime.updateSettings({ analyticsOptIn: e.target.checked })} /></label>
      <div className="foot"><span>Shelf Made v{runtime.version}</span><a href="https://github.com/Shelf-Made/shelf-made-web/issues/new" target="_blank" rel="noreferrer">Send feedback</a></div>
      {!inLobby && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => void runtime.save('slot1').then(() => runtime.showToast('Saved to slot 1.'))}>Save to slot 1</button>
          <button className="btn ghost" onClick={() => void runtime.save('auto').then(() => runtime.toLobby())}>Save & quit</button>
        </div>
      )}
    </>
  );
}

export function SettingsCard(props: { runtime: GameRuntime; snap: Snapshot }) { return <SettingsBody {...props} />; }
