import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { money } from './useRuntime';

export function GameOverCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  const best = s.history.reduce((a, d) => Math.max(a, d.revenue), 0);
  return (
    <div className="card night" role="dialog" aria-label="Out of cash" style={{ padding: 18 }}>
      <h2>The bank closed the doors</h2>
      <p>Day {snap.day}: {money(s.cash)} in the till with bills due. {s.shop.name} ran {s.history.length} days; the best day took {money(best)}.</p>
      <p className="muted">Next time: keep two days' rent in cash, order before shelves empty, borrow early.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn big yellow" onClick={() => runtime.startNew({ difficulty: s.difficulty })}>Start again</button>
        <button className="btn ghost" onClick={() => runtime.toLobby()}>Lobby</button>
      </div>
    </div>
  );
}
