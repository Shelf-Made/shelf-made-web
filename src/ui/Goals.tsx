import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { GOALS, goalProgress } from '@/sim/goals';
import { money } from './useRuntime';

const FLAG = <svg viewBox="0 0 24 24" aria-hidden="true"><path className="fill" d="M6 4h11l-2.5 4L17 12H6z" /><path d="M6 21V3.5M6 4h11l-2.5 4L17 12H6" /></svg>;

/** The active goal as a slim chip under the top bar; a click opens the whole ladder (Stats). */
export function GoalChip({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const g = snap.goal;
  if (!g) return null;
  const pct = Math.round(g.frac * 100);
  return (
    <button className="goal-chip" onClick={() => runtime.openCard('stats')} title={`${g.target}. Reward: ${g.reward}. ${g.text}`}
      aria-label={`Goal ${g.step} of ${g.total}: ${g.title}. ${g.target}. ${g.text}. ${pct}% done. Open the goals.`}>
      <span className="g-flag">{FLAG}</span>
      <span className="g-text"><b>{g.title}</b><small>{g.target}</small></span>
      <span className="g-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      <span className="g-pct" aria-hidden="true">{pct}%</span>
    </button>
  );
}

/** The ladder: every goal, done (with the day), the active one with its progress, and those still to come. */
export function GoalsSection({ runtime }: { runtime: GameRuntime }) {
  const s = runtime.state!;
  const gs = s.goals;
  return (
    <>
      <h3>Goals</h3>
      <ol className="goal-ladder">
        {GOALS.map((g, i) => {
          const done = gs.done.find((d) => d.id === g.id);
          const now = i === gs.index;
          const p = now ? goalProgress(s, g) : null;
          const cls = done ? 'done' : now ? 'now' : 'later';
          return (
            <li key={g.id} className={cls}>
              <span className="mark" aria-hidden="true">{done ? '✓' : now ? '▶' : i + 1}</span>
              <div className="g-body">
                <div className="name">{g.title} <span className={`tag${done ? ' ok' : ''}`}>{done ? `Done, day ${done.day}` : now ? 'Now' : 'Later'}</span></div>
                <div className="sub">{g.target}</div>
                {p && <><div className="bar" role="progressbar" aria-valuenow={Math.round(p.frac * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.title} progress`}><div style={{ width: `${Math.round(p.frac * 100)}%` }} /></div><div className="muted">{p.text}</div></>}
                <div className="reward">Reward: {g.rewardText}</div>
              </div>
            </li>
          );
        })}
      </ol>
      {gs.index >= GOALS.length && <p className="muted">Every goal reached. The crossroads is yours: play on as long as you like.</p>}
    </>
  );
}

/** A goal reached: a burst of confetti and the reward, over play (nothing pauses). */
export function Celebration({ snap }: { snap: Snapshot }) {
  const c = snap.celebrate;
  if (!c) return null;
  return (
    <div className="celebrate" key={c.key} role="status" aria-live="polite">
      <div className="confetti" aria-hidden="true">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}</div>
      <div className="banner">
        <small>Goal reached</small>
        <b>{c.title}</b>
        <span>Reward: {c.reward}</span>
        {c.next && <span className="next">Next up: {c.next}</span>}
      </div>
    </div>
  );
}

/** The ending: the crossroads is yours. Play carries on as a sandbox. */
export function ChampionCard({ runtime }: { runtime: GameRuntime }) {
  const s = runtime.state!;
  const corners = s.rivals.filter((r) => r.boughtDay !== undefined).length + 1;
  const best = s.history.reduce((a, d) => Math.max(a, d.profit), 0);
  return (
    <div className="card night champion profit" role="dialog" aria-label="Crossroads Champion" style={{ padding: 18 }}>
      <svg className="trophy" viewBox="0 0 64 64" aria-hidden="true"><path d="M20 8h24v14a12 12 0 01-24 0z" fill="#FFC044" stroke="#38383D" strokeWidth="3" /><path d="M20 12h-8a8 8 0 008 10M44 12h8a8 8 0 01-8 10" fill="none" stroke="#38383D" strokeWidth="3" /><path d="M28 34h8v8h-8zM22 42h20v8H22z" fill="#D99A2B" stroke="#38383D" strokeWidth="3" /></svg>
      <h2>Crossroads Champion</h2>
      <p>Day {s.day}: {s.shop.name} trades from {corners} of the four corners. Your best day netted {money(best, true)}, and {s.goals.done.length} goals are behind you.</p>
      <p className="muted">From here it is a sandbox: no more bank worries. Keep building, buy another corner, or open branches out of town.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn big yellow" onClick={() => runtime.dispatch({ type: 'ackChampion' })}>Keep playing</button>
      </div>
    </div>
  );
}
