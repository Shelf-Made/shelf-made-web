import { useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { PLOTS } from '@/sim/layout';
import { FRANCHISE_COST, managerCandidates } from '@/sim/franchise';
import { money } from '../useRuntime';

/** Franchises: open branches on the other plots, each run by a manager. Lives in the Build card. */
export function StoresSection({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion;
  const free = PLOTS.filter((p) => p.id !== s.shop.plotId && !s.franchises.some((f) => f.plotId === p.id));
  const managers = managerCandidates(s);
  const [plot, setPlot] = useState(free[0]?.id ?? '');
  const [mgr, setMgr] = useState(managers[0]?.id ?? 0);
  return (
    <>
      <h3>More stores</h3>
      {s.franchises.map((f) => {
        const last = f.history[f.history.length - 1];
        return (
          <div className="item" key={f.id}>
            <div>
              <div className="name">{f.name} <span className="tag">{f.manager.name}, skill {Math.round(f.manager.skill * 100)}%</span></div>
              <div className="sub">{last ? `Yesterday ${last.served}/${last.customers} served, ${last.profit >= 0 ? '+' : ''}${money(last.profit)}` : 'Opens tomorrow'} · stock {Math.round(f.stockLevel * 100)}%{f.alerts.length ? ` · ${f.alerts.join(', ')}` : ''}</div>
            </div>
            <div className="row">
              {managers[0] && <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'replaceManager', franchiseId: f.id, managerId: managers[0]!.id })} title={`Replace with ${managers[0].name}`}>New manager</button>}
              <button className="btn small danger" onClick={() => runtime.dispatch({ type: 'closeFranchise', franchiseId: f.id })}>Close</button>
            </div>
          </div>
        );
      })}
      {free.length > 0 ? (
        <div className="item">
          <div>
            <div className="name">Open a branch · {money(FRANCHISE_COST)}</div>
            <div className="sub">A manager runs it by your rules. Good ones cost more and lose less. Shared reputation, central ordering.</div>
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
              <select value={plot} onChange={(e) => setPlot(e.target.value)} aria-label="Plot">{free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <select value={mgr} onChange={(e) => setMgr(Number(e.target.value))} aria-label="Manager">{managers.length ? managers.map((m) => <option key={m.id} value={m.id}>{m.name} · skill {Math.round(m.skill * 100)}% · {money(m.wage)}/day</option>) : <option value={0}>No manager in today's pool</option>}</select>
            </div>
          </div>
          <button className="btn small" disabled={!managers.length || s.cash < FRANCHISE_COST} onClick={() => runtime.dispatch({ type: 'openFranchise', plotId: plot, managerId: mgr })}>Open</button>
        </div>
      ) : <p className="muted">Every plot in town has one of your stores.</p>}
    </>
  );
}
