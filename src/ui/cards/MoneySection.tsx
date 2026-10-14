import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { money } from '../useRuntime';
import { LOAN_OFFERS, upcoming } from '@/sim/money';
import { dailyRent, dailyUtilities, dailyWages } from '@/sim/economy';

/** Profit and loss, cash, upcoming bills, loans. Lives inside the Stats card. */
export function MoneySection({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion;
  const t = s.today;
  const due = upcoming(s);
  const tonight = dailyRent(s) + dailyUtilities(s) + dailyWages(s) * 1.12;
  const last = s.history[s.history.length - 1];
  return (
    <>
      <h3>Money</h3>
      <div className="stat"><span>Cash</span><b>{money(s.cash)}</b></div>
      <div className="stat"><span>Sales so far today</span><b>{money(t.revenue)}</b></div>
      <div className="stat"><span>Tonight: rent, power, wages</span><b>-{money(tonight)}</b></div>
      {due.slice(0, 4).map((d, i) => <div className="stat" key={i}><span>Day {d.day}: {d.name}</span><b>-{money(d.amount)}</b></div>)}
      {last && <div className="stat"><span>Yesterday's profit</span><b>{money(last.profit, true)}</b></div>}
      {last && (last.theft > 0 || last.loans > 0 || last.bills > 0) && <p className="muted">Yesterday also: {last.theft > 0 ? `${money(last.theft)} shoplifted` : ''}{last.loans > 0 ? ` · ${money(last.loans)} loan instalment` : ''}{last.bills > 0 ? ` · ${money(last.bills)} invoices` : ''}</p>}
      <h3>Loans</h3>
      {s.loans.map((l) => (
        <div className="item" key={l.id}>
          <div><div className="name">{l.name}</div><div className="sub">{money(l.balance)} left · {l.daysLeft} days · {(l.dailyRate * 100).toFixed(1)}%/day</div></div>
          <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'repayLoan', loanId: l.id, amount: Math.min(l.balance, Math.max(50, Math.floor(s.cash * 0.5))) })}>Repay some</button>
        </div>
      ))}
      {LOAN_OFFERS.filter((o) => !s.loans.some((l) => l.offerId === o.id)).map((o) => (
        <div className="item" key={o.id}>
          <div><div className="name">{o.name} · {money(o.amount)}</div><div className="sub">{o.days} days · {(o.dailyRate * 100).toFixed(1)}% a day{s.cash < 0 ? ' · available as a rescue' : ''}</div></div>
          <button className="btn small" disabled={s.loans.length >= 2} onClick={() => runtime.dispatch({ type: 'takeLoan', offerId: o.id })}>Take</button>
        </div>
      ))}
      <p className="muted">Run out of cash with bills due two nights running and the bank closes you down.</p>
    </>
  );
}
