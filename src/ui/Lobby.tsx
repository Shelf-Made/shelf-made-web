import { useEffect, useRef, useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { listSlots, deleteSave, loadGame, parse, serialize, type SlotInfo, type Slot } from '@/save/saves';
import type { Difficulty } from '@/sim/types';
import { money } from './useRuntime';
import { SettingsBody } from './cards/SettingsCard';

export function Lobby({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const [view, setView] = useState<'main' | 'new' | 'saves' | 'settings'>('main');
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [tutorial, setTutorial] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => { void listSlots(runtime.storage).then(setSlots); };
  useEffect(refresh, [runtime, view]);
  const auto = slots.find((s) => s.slot === 'auto');
  const latest = slots.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];

  const exportSlot = async (slot: Slot) => {
    const s = await loadGame(runtime.storage, slot);
    if (!s) return;
    const blob = new Blob([serialize(s)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `shelf-made-${s.shop.name.replace(/\W+/g, '-').toLowerCase()}-day${s.day}.json`; a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const f = parse(text);
      runtime.loadState(f.state);
    } catch (e) { runtime.showToast(e instanceof Error ? e.message : 'Could not import that file.'); }
  };

  return (
    <div className="lobby">
      <div className="panel">
        <div className="brand">
          <div className="wordmark">Shelf Made</div>
          <div className="tagline">Grow a corner shop into the town's favourite grocer.</div>
          <div><span className="beta">Free beta until December 10, 2026</span></div>
          {!snap.loaded && (
            <div>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(snap.loadProgress * 100)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.round(snap.loadProgress * 100)}%` }} /></div>
              <div className="muted" style={{ marginTop: 6 }}>{snap.loadLabel}…</div>
            </div>
          )}
          <div className="foot">
            <span>v{runtime.version} · beta</span>
            <a href="https://github.com/Shelf-Made/shelf-made-web/issues/new" target="_blank" rel="noreferrer">Send feedback</a>
          </div>
        </div>
        <div className="menu">
          {view === 'main' && (
            <>
              <button className="btn big" disabled={!snap.loaded || !latest} onClick={() => latest && void runtime.load(latest.slot as Slot)}>Continue{latest ? ` · ${latest.name}, day ${latest.day}` : ''}</button>
              <button className="btn big yellow" disabled={!snap.loaded} onClick={() => setView('new')}>New game</button>
              <button className="btn ghost" disabled={!snap.loaded} onClick={() => runtime.startNew({ sandbox: true, plotId: 'main', name: 'Sandbox', tutorial: false })}>Sandbox</button>
              <button className="btn ghost" disabled={!snap.loaded} onClick={() => setView('saves')}>Save slots</button>
              <button className="btn ghost" onClick={() => setView('settings')}>Settings</button>
              {auto && <div className="muted">Autosave: {auto.name}, day {auto.day}, {money(auto.cash)}</div>}
            </>
          )}
          {view === 'new' && (
            <>
              <h3>New game</h3>
              <label className="row between">Difficulty
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value="relaxed">Relaxed</option><option value="standard">Standard</option><option value="hard">Hard</option>
                </select>
              </label>
              <label className="toggle"><span>Show tips</span><input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} /></label>
              <button className="btn big" onClick={() => runtime.startNew({ difficulty, tutorial })}>Start</button>
              <button className="btn ghost" onClick={() => setView('main')}>Back</button>
            </>
          )}
          {view === 'saves' && (
            <>
              <h3>Save slots</h3>
              {slots.length === 0 && <p className="muted">No saves yet.</p>}
              {slots.map((s) => (
                <div className="slot" key={s.slot}>
                  <div><b>{s.name}</b><div className="sub muted">Day {s.day} · {money(s.cash)} · {s.slot === 'auto' ? 'autosave' : s.slot}</div></div>
                  <button className="btn small" onClick={() => void runtime.load(s.slot as Slot)}>Load</button>
                  <button className="btn small ghost" onClick={() => void exportSlot(s.slot as Slot)}>Export</button>
                  <button className="btn small danger" onClick={() => { void deleteSave(runtime.storage, s.slot as Slot).then(refresh); }}>Delete</button>
                </div>
              ))}
              <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>Import a save file</button>
              <button className="btn ghost" onClick={() => setView('main')}>Back</button>
            </>
          )}
          {view === 'settings' && (
            <>
              <h3>Settings</h3>
              <SettingsBody runtime={runtime} snap={snap} inLobby />
              <button className="btn ghost" onClick={() => setView('main')}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
