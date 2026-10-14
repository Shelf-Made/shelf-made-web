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

  const label = (main: string, side?: string) => (<><span>{main}</span>{side && <span className="price">{side}</span>}</>);
  return (
    <div className={`lobby${snap.loaded ? ' live' : ''}`}>
      <div className="awning" aria-hidden="true" />
      <div className="brand">
        <div className="hero">
          <img className="head" src="/brand/manager-head-512.png" alt="" width={256} height={256} />
          <div className="bubble" aria-hidden="true">Welcome in!</div>
        </div>
        <h1 className="wordmark">Shelf Made</h1>
        <div className="shelf-bracket" aria-hidden="true"><i /><i /></div>
        <p className="tagline">Four bare walls and a concrete floor. Build it into the valley&apos;s favourite grocer, one shelf at a time.</p>
        <div className="pricetag"><span>Free beta</span><b>until Dec 10, 2026</b></div>
        {!snap.loaded && (
          <div className="loading">
            <div className="progress" role="progressbar" aria-valuenow={Math.round(snap.loadProgress * 100)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.round(snap.loadProgress * 100)}%` }} /></div>
            <div className="muted">{snap.loadLabel}…</div>
          </div>
        )}
      </div>
      <div className="menu">
        <div className="open-sign" aria-hidden="true"><span>OPEN</span></div>
        {view === 'main' && (
          <>
            <button className="tagbtn primary" disabled={!snap.loaded || !latest} onClick={() => latest && void runtime.load(latest.slot as Slot)}>{label('Continue', latest ? `${latest.name} · day ${latest.day}` : undefined)}</button>
            <button className="tagbtn yellow" disabled={!snap.loaded} onClick={() => setView('new')}>{label('New shop', 'from scratch')}</button>
            <button className="tagbtn" disabled={!snap.loaded} onClick={() => runtime.startNew({ sandbox: true, plotId: 'main', name: 'Sandbox', tutorial: false })}>{label('Sandbox', 'no rent')}</button>
            <button className="tagbtn" disabled={!snap.loaded} onClick={() => setView('saves')}>{label('Save slots')}</button>
            <button className="tagbtn" onClick={() => setView('settings')}>{label('Settings')}</button>
            {auto && <div className="muted small">Autosave: {auto.name}, day {auto.day}, {money(auto.cash)}</div>}
          </>
        )}
        {view === 'new' && (
          <>
            <h3>New shop</h3>
            <label className="row between">Difficulty
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                <option value="relaxed">Relaxed</option><option value="standard">Standard</option><option value="hard">Hard</option>
              </select>
            </label>
            <label className="toggle"><span>Show tips</span><input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} /></label>
            <button className="tagbtn yellow" onClick={() => runtime.startNew({ difficulty, tutorial })}>{label('Pick a plot', '→')}</button>
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
          <div className="settings-scroll">
            <h3>Settings</h3>
            <SettingsBody runtime={runtime} snap={snap} inLobby />
            <button className="btn ghost" onClick={() => setView('main')}>Back</button>
          </div>
        )}
        <div className="foot">
          <span>v{runtime.version} · beta</span>
          <a href="https://github.com/Shelf-Made/shelf-made-web/issues/new" target="_blank" rel="noreferrer">Send feedback</a>
        </div>
      </div>
      <div className="ticker" aria-hidden="true">
        <div className="track">
          {[0, 1].map((k) => <span key={k}>FRESH BREAD DAILY ★ BUILD YOUR SHOP FROM BARE CONCRETE ★ STOCK EVERY SHELF YOURSELF ★ RING UP EVERY BASKET ★ HIRE A CASHIER ON DAY 3 ★ OPEN A SECOND BRANCH ★ FREE BETA UNTIL DECEMBER 10, 2026 ★&nbsp;</span>)}
        </div>
      </div>
    </div>
  );
}
