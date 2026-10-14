import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { money } from './useRuntime';

export function NightCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const n = snap.night!;
  const good = n.profit >= 0;
  return (
    <div className="card night" role="dialog" aria-label="Day summary" style={{ padding: 18 }}>
      <h2>Day {n.day} done: {good ? '+' : ''}{money(n.profit)}</h2>
      <p className="muted">{n.served} of {n.customers} customers served{n.walkedOut ? `, ${n.walkedOut} gave up waiting` : ''}{n.turnedAway ? `, ${n.turnedAway} found the lot full` : ''}.</p>
      <div style={{ marginTop: 8 }}>
        <div className="stat"><span>Sales</span><b>{money(n.revenue)}</b></div>
        <div className="stat"><span>Cost of goods, rent, power{n.costs > 0 ? '' : ''}</span><b>-{money(n.costs)}</b></div>
        <div className="stat total"><span>Cash now</span><b>{money(n.cash)}</b></div>
      </div>
      <div className="row between" style={{ marginTop: 12 }}>
        <span className="muted">{snap.saving ? 'Saving…' : 'Autosaved.'}</span>
        <button className="btn big yellow" onClick={() => runtime.dispatch({ type: 'openTomorrow' })}>Open tomorrow</button>
      </div>
    </div>
  );
}
