import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { nightReport } from '@/sim/report';
import { money } from './useRuntime';

const CARD_NAMES: Record<string, string> = { stock: 'Stock', staff: 'Staff', prices: 'Prices', build: 'Build', marketing: 'Marketing', stats: 'Stats' };

/**
 * The end of the day: the result in green or red, where the money went, why the day went the way it
 * did (the top complaints, each opening the card that fixes it), the crossroads' shares, the active
 * goal, and what tomorrow brings.
 */
export function NightCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  void snap.stateVersion;
  const r = runtime.state ? nightReport(runtime.state) : null;
  if (!r) return null;
  const good = r.profit >= 0;
  const costs: [string, number][] = [['Goods sold', r.costs.goods], ['Rent and power', r.costs.rentPower], ['Staff', r.costs.staff]];
  if (r.costs.other > 0) costs.push(['Loans and shoplifting', r.costs.other]);
  const top = Math.max(1, ...costs.map((c) => c[1]));
  const biggest = costs.reduce((a, c) => (c[1] > a[1] ? c : a), costs[0]!)[0];
  const pts = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(Math.round(x * 100))}`;
  return (
    <div className={`card night report ${good ? 'profit' : 'loss'}`} role="dialog" aria-label="Day summary">
      <div className="night-body">
        <div className="col">
        <h2><span className="sym" aria-hidden="true">{good ? '▲' : '▼'}</span> Day {r.day} done: {money(r.profit, true)}</h2>
        <p className="muted">{r.served} of {r.customers} customers served{r.walkedOut ? `, ${r.walkedOut} gave up waiting` : ''}{r.turnedAway ? `, ${r.turnedAway} found the lot full` : ''}.</p>

        <section aria-label="Money">
          <div className="stat"><span>Sales</span><b>{money(r.revenue)}</b></div>
          {costs.map(([k, v]) => (
            <div className={`stat cost${k === biggest && v > 0 ? ' biggest' : ''}`} key={k}>
              <span>{k}</span>
              <span className="mini" aria-hidden="true"><i style={{ width: `${Math.round((v / top) * 100)}%` }} /></span>
              <b>{money(-v)}</b>
            </div>
          ))}
          <div className="stat total"><span>Cash now</span><b>{money(r.cash)}</b></div>
        </section>

        {r.complaints.length > 0 && (
          <section aria-label="Why">
            <h3>What shoppers said</h3>
            <ul className="why">
              {r.complaints.map((c) => (
                <li key={c.text}>
                  <span>{c.text} <b>×{c.count}</b></span>
                  <button className="btn small ghost" onClick={() => runtime.openCard(c.card)}>{CARD_NAMES[c.card]}</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        </div>
        <div className="col">
        {r.shares.length > 1 && (
          <section aria-label="The crossroads today">
            <h3>The crossroads today</h3>
            <ul className="shares">
              {r.shares.map((b) => (
                <li key={b.id} className={`${b.closed ? 'closed' : ''}${b.mine ? ' mine' : ''}`}>
                  <span className="who">{b.name}{b.closed ? ' (closed)' : ''}</span>
                  <span className="sbar" aria-hidden="true"><i style={{ width: `${Math.round(b.share * 100)}%`, background: b.closed ? '#B9BCC4' : b.colour }} /></span>
                  <b>{Math.round(b.share * 100)}%</b>
                  <small className={b.change === null ? '' : b.change > 0.005 ? 'up' : b.change < -0.005 ? 'down' : ''}>{b.change === null ? 'new' : `${pts(b.change)} pts`}</small>
                </li>
              ))}
            </ul>
          </section>
        )}

        {r.goal && (
          <section aria-label="Goal">
            <h3>Goal: {r.goal.title}</h3>
            <div className="bar" role="progressbar" aria-valuenow={Math.round(r.goal.frac * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Goal progress"><div style={{ width: `${Math.round(r.goal.frac * 100)}%` }} /></div>
            <div className="muted">{r.goal.text}{Math.abs(r.goal.delta) >= 0.01 ? ` · ${r.goal.delta > 0 ? '+' : '−'}${Math.abs(Math.round(r.goal.delta * 100))}% today` : ''} · reward: {r.goal.reward}</div>
          </section>
        )}

        {r.tomorrow && (
          <section aria-label="Tomorrow">
            <h3>Tomorrow</h3>
            <ul className="tomorrow">
              <li>{r.tomorrow.weather ?? 'Fair weather, nothing special forecast.'}</li>
              {r.tomorrow.festival && <li>{r.tomorrow.festival}</li>}
              {r.tomorrow.rumours.map((t) => <li key={t} className="rumour">{t}</li>)}
            </ul>
          </section>
        )}
        </div>
      </div>
      <div className="row between night-foot">
        <span className="muted">{snap.saving ? 'Saving…' : 'Autosaved.'}</span>
        <button className="btn big yellow" onClick={() => runtime.dispatch({ type: 'openTomorrow' })}>Open tomorrow</button>
      </div>
    </div>
  );
}
