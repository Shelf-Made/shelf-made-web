import { useEffect, useRef } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { ICONS } from './TopBar';

const MOVE = <svg viewBox="0 0 24 24"><path className="fill" d="M9 9h6v6H9z" /><path d="M12 2.5v19M2.5 12h19M12 2.5l-2.5 2.5M12 2.5l2.5 2.5M12 21.5l-2.5-2.5M12 21.5l2.5-2.5M2.5 12l2.5-2.5M2.5 12l2.5 2.5M21.5 12l-2.5-2.5M21.5 12l-2.5 2.5" /></svg>;
const TURN = <svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 3.5v4h-4" /><path className="fill" d="M10 10h4v4h-4z" /></svg>;
const SERVE = <svg viewBox="0 0 24 24"><path className="fill" d="M3 12h18v8H3z" /><path d="M3 12h18v8H3zM6 12V8h8v4M9 8V5h2M16 15.5h2" /></svg>;

/**
 * The menu over a piece of furniture clicked with empty hands: what it is for (Stock, serve at the
 * till), Move it, Turn it. It stays pinned above the piece as the camera moves; a click anywhere else
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
  const act = (a: 'use' | 'move' | 'turn') => (e: React.MouseEvent) => { e.stopPropagation(); runtime.fixtureMenuAction(a); };
  return (
    <div ref={ref} className="fixture-menu" role="menu" aria-label={menu.name} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fm-name">{menu.name}</div>
      <div className="fm-actions">
        {menu.use && (
          <button type="button" role="menuitem" className="fm-btn primary" onClick={act('use')}>
            {menu.use === 'Stock' ? ICONS.stock : SERVE}<span>{menu.use}</span>
          </button>
        )}
        <button type="button" role="menuitem" className="fm-btn" onClick={act('move')}>{MOVE}<span>Move</span></button>
        <button type="button" role="menuitem" className="fm-btn" onClick={act('turn')}>{TURN}<span>Turn</span></button>
      </div>
    </div>
  );
}
