import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { money } from '../useRuntime';
import { dailyRent, dailyUtilities } from '@/sim/economy';

export function StatsCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion; void snap.cash;
  const t = s.today;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <>
      <h3>Today</h3>
      <div className="stat"><span>Customers</span><b>{t.customers}</b></div>
      <div className="stat"><span>Served</span><b>{t.served} ({pct(t.served, t.customers)}%)</b></div>
      <div className="stat"><span>Gave up waiting</span><b>{t.walkedOut}</b></div>
      <div className="stat"><span>Lot full</span><b>{t.turnedAway}</b></div>
      <div className="stat"><span>Sales</span><b>{money(t.revenue)}</b></div>
      <div className="stat"><span>Cost of goods sold</span><b>{money(t.cogs)}</b></div>
      <div className="stat"><span>Tonight: rent + power</span><b>{money(dailyRent(s) + dailyUtilities(s))}</b></div>
      <h3>Reputation</h3>
      <div className="bar"><div style={{ width: `${Math.round(s.shop.reputation * 100)}%` }} /></div>
      <div className="muted">Awareness {Math.round(s.shop.awareness * 100)}% · happiness {t.satisfactionN ? Math.round((t.satisfaction / t.satisfactionN) * 100) : '–'}%</div>
      {s.history.length > 0 && <h3>Past days</h3>}
      {s.history.slice().reverse().slice(0, 7).map((d) => (
        <div className="stat" key={d.day}><span>Day {d.day} · {d.served}/{d.customers} served</span><b>{d.profit >= 0 ? '+' : ''}{money(d.profit)}</b></div>
      ))}
    </>
  );
}
