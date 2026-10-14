import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { money } from '../useRuntime';
import { dailyRent, dailyUtilities } from '@/sim/economy';
import { computeScores, playerShare, TYPE_NAMES } from '@/sim/customers';
import type { CustomerType } from '@/sim/types';
import { MoneySection } from './MoneySection';
import { GoalsSection } from '../Goals';

export function StatsCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion; void snap.cash;
  const t = s.today;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <>
      <GoalsSection runtime={runtime} />
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
      <h3>How shoppers rate you</h3>
      {(() => { const sc = computeScores(s); const rows: [string, number][] = [['Prices', sc.price], ['In stock', sc.availability], ['Clean & laid out', sc.layout], ['Short waits', sc.wait], ['Parking', sc.parking], ['Known in town', sc.awareness]]; return rows.map(([k, v]) => (
        <div className="row" key={k}><span style={{ minWidth: 130 }}>{k}</span><div className="bar" style={{ flex: 1 }}><div style={{ width: `${Math.round(v * 100)}%`, background: v < 0.4 ? 'var(--red)' : v < 0.65 ? 'var(--yellow)' : 'var(--green)' }} /></div></div>
      )); })()}
      <h3>Who shops here</h3>
      {(() => { const sh = playerShare(s); return (Object.keys(TYPE_NAMES) as CustomerType[]).map((k) => <div className="stat" key={k}><span>{TYPE_NAMES[k]}</span><b>{Math.round(sh[k] * 100)}% of the town's</b></div>); })()}
      {s.rivals.some((r) => r.open) && <h3>Rivals</h3>}
      {s.rivals.filter((r) => r.open).map((r) => <div className="stat" key={r.id}><span>{r.name}{r.stores > 1 ? ` (${r.stores} stores)` : ''}</span><b>{r.saleDaysLeft > 0 ? <span className="tag bad">On sale</span> : r.priceIndex < 0.95 ? 'cheap' : r.priceIndex > 1.1 ? 'premium' : 'average'}</b></div>)}
      {s.notices.length > 0 && <h3>News</h3>}
      {s.notices.slice(-5).reverse().map((n, i) => <p className="muted" key={i}>Day {n.day}: {n.text}</p>)}
      <MoneySection runtime={runtime} snap={snap} />
      {s.history.length > 0 && <h3>Past days</h3>}
      {s.history.slice().reverse().slice(0, 7).map((d) => (
        <div className="stat" key={d.day}><span>Day {d.day} · {d.served}/{d.customers} served</span><b>{money(d.profit, true)}</b></div>
      ))}
    </>
  );
}
