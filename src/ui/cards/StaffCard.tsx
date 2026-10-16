import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { ROLE_NAMES, ROLE_BLURB, SHIFT_NAMES, wageFor, staffLevel, levelProgress, MAX_LEVEL } from '@/sim/staff';
import { needOf } from '@/sim/people';
import { INSTANT_MUL } from '@/sim/economy';
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
          <div className={`item staff-item${p.onBreak ? ' on-break' : ''}`} key={p.id}>
            <div className="staff-main">
              <div className="name">{p.name} <span className="tag">{ROLE_NAMES[p.role ?? 'cashier']}</span>
                <span className="lvl" title={`Level ${staffLevel(p)} of ${MAX_LEVEL}: +${(staffLevel(p) - 1) * 20}% quicker`}>Lv {staffLevel(p)}</span>
                {p.onBreak && <span className="tag break">On a break</span>}
              </div>
              <div className="xp" aria-label={`Experience: ${Math.round(levelProgress(p) * 100)}% to the next level`}><i style={{ width: `${Math.round(levelProgress(p) * 100)}%` }} /></div>
              <div className="sub">{money(wageFor(p))}/day · skill {pct(p.skill ?? 0)} · morale {pct(p.morale ?? 0)}{(p.morale ?? 1) < 0.35 ? ' (about to quit)' : ''}</div>
              {needOf(s, p) && <div className="sub need">{needOf(s, p)}</div>}
              <div className="row staff-controls">
                <select value={p.shift ?? 'full'} onChange={(e) => runtime.dispatch({ type: 'setShift', staffId: p.id, shift: e.target.value as 'full' | 'morning' | 'evening' })} aria-label={`${p.name} shift`}>
                  {(Object.keys(SHIFT_NAMES) as (keyof typeof SHIFT_NAMES)[]).map((k) => <option key={k} value={k}>{SHIFT_NAMES[k]}</option>)}
                </select>
                <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'setBreak', staffId: p.id, on: !p.onBreak })} title={p.onBreak ? 'Back on the floor at full pay' : 'Off the floor at half pay; they keep what they have learned'}>{p.onBreak ? 'Back to work' : 'Break'}</button>
                <button className="btn small ghost dice" onClick={() => runtime.dispatch({ type: 'restyleStaff', staffId: p.id })} title="A new name and a new look" aria-label={`New name and look for ${p.name}`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="9" cy="9" r="1.3" /><circle cx="15" cy="15" r="1.3" /><circle cx="15" cy="9" r="1.3" /><circle cx="9" cy="15" r="1.3" /></svg>
                </button>
              </div>
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
      <label className="row between"><span>Stock up to</span><span className="row"><input type="range" min={50} max={200} step={10} value={Math.round((r.stockTarget ?? 1.5) * 100)} onChange={(e) => set({ stockTarget: Number(e.target.value) / 100 })} aria-label="Stock up to, percent of what the shelves hold" /><span className="key">{pct(r.stockTarget ?? 1.5)} of shelf</span></span></label>
      <label className="row between"><span>Instant delivery (+{Math.round((INSTANT_MUL - 1) * 100)}%)</span><input type="checkbox" checked={!!r.instant} onChange={(e) => set({ instant: e.target.checked })} aria-label="Reorders come by instant delivery" /></label>
      <label className="row between"><span>Wage cap for hires</span><span className="row"><span className="key">{money(r.wageCap)}</span><button className="btn small ghost" onClick={() => set({ wageCap: Math.max(30, r.wageCap - 5) })}>−</button><button className="btn small ghost" onClick={() => set({ wageCap: r.wageCap + 5 })}>+</button></span></label>
      <p className="muted">Paid nightly, plus 12% tax. Half shifts pay 55%, a break half. Rushed days and low pay hurt morale. Everyone levels up by doing the job: +20% quicker a level, up to level 5.</p>
    </>
  );
}
