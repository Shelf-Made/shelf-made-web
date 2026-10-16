import { useEffect, useRef } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { ICONS } from './TopBar';
import { dollars } from '@/sim/money';

const MOVE = <svg viewBox="0 0 24 24"><path className="fill" d="M9 9h6v6H9z" /><path d="M12 2.5v19M2.5 12h19M12 2.5l-2.5 2.5M12 2.5l2.5 2.5M12 21.5l-2.5-2.5M12 21.5l2.5-2.5M2.5 12l2.5-2.5M2.5 12l2.5 2.5M21.5 12l-2.5-2.5M21.5 12l-2.5 2.5" /></svg>;
const TURN = <svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 3.5v4h-4" /><path className="fill" d="M10 10h4v4h-4z" /></svg>;
const SELL = <svg viewBox="0 0 24 24"><circle className="fill" cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.6.8-2.6 2s1 1.6 2.6 2 2.7.9 2.7 2.1-1.2 2-2.7 2c-1.2 0-2.2-.5-2.7-1.4M12 6.5v1.5M12 16v1.5" /></svg>;
const SERVE = <svg viewBox="0 0 24 24"><path className="fill" d="M3 12h18v8H3z" /><path d="M3 12h18v8H3zM6 12V8h8v4M9 8V5h2M16 15.5h2" /></svg>;
const BELT = <svg viewBox="0 0 24 24"><path className="fill" d="M3 13h18v4H3z" /><path d="M3 13h18v4H3zM6 13v4M10 13v4M14 13v4M18 13v4M7 13V9h4v4M13 13v-3h4v3" /></svg>;
const RIDE = <svg viewBox="0 0 24 24"><path className="fill" d="M3 20.5V16h4.5v-4.5H12V7h4.5V3.5H21v17z" /><path d="M3 20.5V16h4.5v-4.5H12V7h4.5V3.5H21v17z" /></svg>;

/**
 * The menu over a piece of furniture clicked with empty hands: what it is for (Stock, serve at the
 * till, ride the stairs), Move it, Turn it. It stays pinned above the piece as the camera moves; a click anywhere else
 * or Esc closes it.
 */
export function FixtureMenu({ runtime, menu }: { runtime: GameRuntime; menu: NonNullable<Snapshot['fixtureMenu']> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const proj = { x: 0, y: 0, visible: false };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current, r = runtime.renderer, a = runtime.fixtureAnchor(menu.id);
      if (!el || !r || !a) return;
      r.project(a.x, a.y + 0.25, a.z, proj);
      const w = el.offsetWidth, h = el.offsetHeight;
      // Above the piece, kept on screen.
      const x = Math.max(8 + w / 2, Math.min(window.innerWidth - 8 - w / 2, proj.x));
      const y = Math.max(76 + h, Math.min(window.innerHeight - 96, proj.y));
      el.style.left = `${x}px`; el.style.top = `${y}px`;
      el.style.visibility = proj.visible ? '' : 'hidden';
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime, menu.id]);
  const act = (a: 'use' | 'move' | 'turn' | 'sell' | 'upgrade') => (e: React.MouseEvent) => { e.stopPropagation(); runtime.fixtureMenuAction(a); };
  return (
    <div ref={ref} className="fixture-menu" role="menu" aria-label={menu.name} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fm-name">{menu.name}</div>
      {menu.picks && menu.picks.length > 0 && (
        <div className="fm-picks">
          {menu.picks.map((p) => (
            <button key={p.productId} type="button" role="menuitem" className="fm-pick" onClick={(e) => { e.stopPropagation(); runtime.palletPick(p.productId); }}>
              <span>{p.name}</span><b>{p.qty}</b>
            </button>
          ))}
        </div>
      )}
      {!menu.fixed && <div className="fm-actions">
        {menu.use && (
          <button type="button" role="menuitem" className="fm-btn primary" onClick={act('use')}>
            {menu.use === 'Stock' ? ICONS.stock : menu.use === 'Ride' ? RIDE : SERVE}<span>{menu.use}</span>
          </button>
        )}
        <button type="button" role="menuitem" className="fm-btn" onClick={act('move')}>{MOVE}<span>Move</span></button>
        <button type="button" role="menuitem" className="fm-btn" onClick={act('turn')}>{TURN}<span>Turn</span></button>
        {menu.upgrade && <button type="button" role="menuitem" className="fm-btn upgrade" aria-label={`${menu.upgrade.label} for ${dollars(menu.upgrade.price)}`} onClick={act('upgrade')}>{BELT}<span>{menu.upgrade.label} {dollars(menu.upgrade.price)}</span></button>}
        <button type="button" role="menuitem" className="fm-btn" aria-label={`Sell for ${dollars(menu.refund ?? 0)}`} onClick={act('sell')}>{SELL}<span>Sell {dollars(menu.refund ?? 0)}</span></button>
      </div>}
    </div>
  );
}
