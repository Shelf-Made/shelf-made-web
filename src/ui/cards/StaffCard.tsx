import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { ROLE_NAMES, ROLE_BLURB, SHIFT_NAMES, wageFor } from '@/sim/staff';
import { money } from '../useRuntime';

export function StaffCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion;
  const team = s.people.filter((p) => p.kind === 'staff');
  const r = s.rules;
  const set = (patch: Partial<typeof r>) => runtime.dispatch({ type: 'setRules', rules: patch });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <h3>Your team ({team.length})</h3>
      {team.length === 0 && <p className="muted">Nobody yet: you do it all.</p>}
      <div className="list">
        {team.map((p) => (
          <div className="item" key={p.id}>
            <div>
              <div className="name">{p.name} <span className="tag">{ROLE_NAMES[p.role ?? 'cashier']}</span></div>
              <div className="sub">{money(wageFor(p))}/day · skill {pct(p.skill ?? 0)} · morale {pct(p.morale ?? 0)}{(p.morale ?? 1) < 0.35 ? ' (about to quit)' : ''}</div>
              <select value={p.shift ?? 'full'} onChange={(e) => runtime.dispatch({ type: 'setShift', staffId: p.id, shift: e.target.value as 'full' | 'morning' | 'evening' })} aria-label={`${p.name} shift`} style={{ marginTop: 4 }}>
                {(Object.keys(SHIFT_NAMES) as (keyof typeof SHIFT_NAMES)[]).map((k) => <option key={k} value={k}>{SHIFT_NAMES[k]}</option>)}
              </select>
            </div>
            <div className="row">
              <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'raise', staffId: p.id })} title="+10% wage, happier">Raise</button>
              <button className="btn small danger" onClick={() => runtime.dispatch({ type: 'fire', staffId: p.id })}>Let go</button>
            </div>
          </div>
        ))}
      </div>
      <h3>Looking for work today</h3>
      <div className="list">
        {s.staffPool.map((c) => (
          <div className="item" key={c.id}>
            <div>
              <div className="name">{c.name} <span className="tag">{ROLE_NAMES[c.role]}</span></div>
              <div className="sub">{money(c.wage)}/day · skill {pct(c.skill)} · speed {pct(c.speed)}</div>
              <div className="sub">{ROLE_BLURB[c.role]}</div>
            </div>
            <button className="btn small" onClick={() => runtime.dispatch({ type: 'hire', candidateId: c.id })}>Hire</button>
          </div>
        ))}
      </div>
      <h3>Rules for orderers and managers</h3>
      <label className="row between"><span>Reorder when below</span><span className="row"><span className="key">{pct(r.reorderPoint)} of shelf</span><button className="btn small ghost" onClick={() => set({ reorderPoint: Math.max(0.3, r.reorderPoint - 0.1) })}>−</button><button className="btn small ghost" onClick={() => set({ reorderPoint: Math.min(2, r.reorderPoint + 0.1) })}>+</button></span></label>
      <label className="row between"><span>Daily spend cap</span><span className="row"><span className="key">{money(r.spendCap)}</span><button className="btn small ghost" onClick={() => set({ spendCap: Math.max(50, r.spendCap - 50) })}>−</button><button className="btn small ghost" onClick={() => set({ spendCap: r.spendCap + 50 })}>+</button></span></label>
      <label className="row between"><span>Price range (vs average)</span><span className="row"><span className="key">{pct(r.priceMin)}–{pct(r.priceMax)}</span><button className="btn small ghost" onClick={() => set({ priceMin: Math.max(0.7, r.priceMin - 0.05), priceMax: Math.max(0.8, r.priceMax - 0.05) })}>−</button><button className="btn small ghost" onClick={() => set({ priceMin: Math.min(1.3, r.priceMin + 0.05), priceMax: Math.min(1.6, r.priceMax + 0.05) })}>+</button></span></label>
      <label className="row between"><span>Wage cap for hires</span><span className="row"><span className="key">{money(r.wageCap)}</span><button className="btn small ghost" onClick={() => set({ wageCap: Math.max(30, r.wageCap - 5) })}>−</button><button className="btn small ghost" onClick={() => set({ wageCap: r.wageCap + 5 })}>+</button></span></label>
      <p className="muted">Paid nightly, plus 12% tax. Half shifts pay 55%. Rushed days and low pay hurt morale.</p>
    </>
  );
}
