import { useEffect, useRef, useState, type JSX } from 'react';
import type { GameRuntime, Snapshot, CardId, Speed } from '@/app/GameRuntime';
import { money } from './useRuntime';

const ICONS: Record<Exclude<CardId, null>, JSX.Element> = {
  stock: <svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>,
  prices: <svg viewBox="0 0 24 24"><path d="M20 13l-7 7-10-10V3h7z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>,
  build: <svg viewBox="0 0 24 24"><path d="M14 4l6 6-9 9H5v-6z" /><path d="M12 6l6 6" /></svg>,
  staff: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-4 3-6 7-6s7 2 7 6" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14c3 0 6 1.5 6 5" /></svg>,
  marketing: <svg viewBox="0 0 24 24"><path d="M3 10v4h4l8 5V5l-8 5z" /><path d="M18 9a4 4 0 010 6" /></svg>,
  stats: <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.2-.8.2-1.3z" /></svg>,
};
const LABELS: Record<Exclude<CardId, null>, string> = { stock: 'Stock', prices: 'Prices', build: 'Build', staff: 'Staff', marketing: 'Marketing', stats: 'Stats', settings: 'Settings' };
const ORDER: Exclude<CardId, null>[] = ['stock', 'prices', 'build', 'staff', 'marketing', 'stats', 'settings'];

/** Money counter that ticks up toward the real value. */
function useTicking(value: number): number {
  const [shown, setShown] = useState(value);
  const target = useRef(value);
  useEffect(() => { target.current = value; }, [value]);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      setShown((s) => {
        const d = target.current - s;
        if (Math.abs(d) < 0.01) return target.current;
        return s + d * 0.18;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return shown;
}

export function TopBar({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const shown = useTicking(snap.cash);
  const speeds: Speed[] = [0, 1, 2, 4];
  const unlocked = (c: Exclude<CardId, null>) => c === 'settings' || c === 'stats' || c === 'stock' || c === 'prices' || snap.unlocks[c];
  return (
    <div className="topbar" role="toolbar" aria-label="Shop controls">
      <div className="logo"><img className="mark" src="/brand/manager-head-64.png" alt="" width={34} height={34} /><span>Shelf Made</span></div>
      <div className="money" aria-live="polite" aria-label="Cash">{money(shown)}</div>
      <div className="clock">Day {snap.day} · {snap.phase === 'setup' ? 'Setting up' : snap.clock}</div>
      {snap.phase === 'setup' && <button className="btn open-shop" data-card="open" onClick={() => runtime.dispatch({ type: 'openShop' })}>Open shop</button>}
      <div className="spacer" />
      {ORDER.map((c) => (
        <button key={c} className={`iconbtn${snap.card === c ? ' active' : ''}${unlocked(c) ? '' : ' locked'}`} onClick={() => unlocked(c) ? runtime.openCard(c) : runtime.showToast(`${LABELS[c]} opens in a few days.`)} aria-pressed={snap.card === c} data-card={c} title={unlocked(c) ? LABELS[c] : `${LABELS[c]} (locked)`}>
          {ICONS[c]}<span>{LABELS[c]}</span>
          {snap.unlocks.newBadges.includes(c) && <span className="new">New!</span>}
        </button>
      ))}
      <button className="iconbtn" onClick={() => runtime.showHint()} title="What should I do next?" data-card="hint">
        <svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0012 3z" /></svg><span>Hint</span>
      </button>
      <div className="speeds" role="group" aria-label="Game speed">
        {speeds.map((s) => (
          <button key={s} className={snap.speed === s ? 'active' : ''} onClick={() => runtime.setSpeed(s)} aria-pressed={snap.speed === s} aria-label={s === 0 ? 'Pause' : `${s}x speed`}>{s === 0 ? '❚❚' : `${s}x`}</button>
        ))}
      </div>
    </div>
  );
}
