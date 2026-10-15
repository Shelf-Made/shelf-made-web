import { useEffect, useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { money } from '../useRuntime';
import { dailyRent, dailyUtilities } from '@/sim/economy';
import { computeScores, playerShare, TYPE_NAMES } from '@/sim/customers';
import type { CustomerType } from '@/sim/types';
import { MoneySection } from './MoneySection';
import { GoalsSection } from '../Goals';
import { TypeIcon } from '../Inspect';
import { whoShopsWhere } from '@/sim/inspect';
import { nightReport } from '@/sim/report';
import { DayLog } from '../NightCard';

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
      <WhoShopsWhere runtime={runtime} />
      <h3>Who shops here</h3>
      {(() => { const sh = playerShare(s); return (Object.keys(TYPE_NAMES) as CustomerType[]).map((k) => <div className="stat" key={k}><span>{TYPE_NAMES[k]}</span><b>{Math.round(sh[k] * 100)}% of the town's</b></div>); })()}
      {s.rivals.some((r) => r.open) && <h3>Rivals</h3>}
      {s.rivals.filter((r) => r.open).map((r) => <div className="stat" key={r.id}><span>{r.name}{r.stores > 1 ? ` (${r.stores} stores)` : ''}</span><b>{r.saleDaysLeft > 0 ? <span className="tag bad">On sale</span> : r.priceIndex < 0.95 ? 'cheap' : r.priceIndex > 1.1 ? 'premium' : 'average'}</b></div>)}
      {s.notices.length > 0 && <h3>News</h3>}
      {s.notices.slice(-5).reverse().map((n, i) => <p className="muted" key={i}>Day {n.day}: {n.text}</p>)}
      <MoneySection runtime={runtime} snap={snap} />
      <DayLogs runtime={runtime} snap={snap} />
    </>
  );
}

/** Every closed day's log, newest first: tap a day to read its night card again. */
function DayLogs({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  if (!s.history.length) return null;
  const days = s.history.slice().reverse();
  const shown = all ? days : days.slice(0, 7);
  return (
    <>
      <h3>Day logs</h3>
      <div className="day-logs" role="list" aria-label="Day logs">
        {shown.map((d) => {
          const r = open === d.day ? nightReport(s, d.day) : null;
          return (
            <div role="listitem" key={d.day}>
              <button className="day-row" aria-expanded={open === d.day} onClick={() => setOpen(open === d.day ? null : d.day)}>
                <span><span className="chev" aria-hidden="true">›</span> Day {d.day} · {d.served}/{d.customers} served</span>
                <b className={d.profit >= 0 ? 'up' : 'down'}>{money(d.profit, true)}</b>
              </button>
              {r && <div className="log"><DayLog runtime={runtime} snap={snap} r={r} compact /></div>}
            </div>
          );
        })}
      </div>
      {days.length > 7 && <button className="btn small ghost" onClick={() => setAll(!all)}>{all ? 'Show the last week' : `Show all ${days.length} days`}</button>}
    </>
  );
}

/** Today's shoppers by type at each store; a row marks every shopper of that type in the world for ten seconds. */
function WhoShopsWhere({ runtime }: { runtime: GameRuntime }) {
  const s = runtime.state!;
  const [lit, setLit] = useState<CustomerType | null>(null);
  useEffect(() => { if (!lit) return; const t = setTimeout(() => setLit(null), 10000); return () => clearTimeout(t); }, [lit]);
  const w = whoShopsWhere(s);
  if (w.stores.length < 2) return null;
  return (
    <>
      <h3>Who shops where</h3>
      <table className="who-where" aria-label="Who shops where today">
        <thead><tr><th scope="col">Today</th>{w.stores.map((st) => <th scope="col" key={st.id} className={st.mine ? 'mine' : ''}>{st.name}</th>)}</tr></thead>
        <tbody>
          {w.rows.map((r) => {
            const top = Math.max(...r.counts);
            return (
              <tr key={r.type}>
                <th scope="row"><button className={lit === r.type ? 'lit' : ''} onClick={() => { setLit(r.type); runtime.highlightType(r.type); }} aria-label={`${r.name}: show them in town`}><TypeIcon type={r.type} />{r.name}</button></th>
                {r.counts.map((n, i) => <td key={w.stores[i]!.id} className={`${w.stores[i]!.mine ? 'mine' : ''}${n === top && n > 0 ? ' top' : ''}`}>{n}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">Tap a row to mark those shoppers in town for 10 seconds.</p>
    </>
  );
}
