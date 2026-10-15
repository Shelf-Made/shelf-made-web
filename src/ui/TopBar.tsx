import { useEffect, useRef, useState, type JSX } from 'react';
import { schemeById } from '@/sim/schemes';
import type { GameRuntime, Snapshot, CardId, Speed } from '@/app/GameRuntime';
import { keyLabel } from '@/save/settings';
import { money } from './useRuntime';
import { GoalChip } from './Goals';

type Card = Exclude<CardId, null>;

/** Chunky two-tone glyphs, drawn white on each tile's own colour. */
export const ICONS: Record<Card | 'help', JSX.Element> = {
  build: <svg viewBox="0 0 24 24"><path className="fill" d="M3.5 17.5l9-9 3 3-9 9h-3z" /><path d="M12 5l2.5-2.5 6.5 6.5-2.5 2.5zM3.5 17.5l9-9 3 3-9 9h-3z" /></svg>,
  stock: <svg viewBox="0 0 24 24"><path className="fill" d="M3 7.5l9-4 9 4v9l-9 4-9-4z" /><path d="M3 7.5l9-4 9 4v9l-9 4-9-4zM3 7.5l9 4 9-4M12 11.5v9M7.5 5.5l9 4" /></svg>,
  prices: <svg viewBox="0 0 24 24"><path className="fill" d="M20.5 12.5l-8 8-9-9v-8h8z" /><path d="M20.5 12.5l-8 8-9-9v-8h8z" /><circle cx="8" cy="8" r="1.8" /></svg>,
  staff: <svg viewBox="0 0 24 24"><circle className="fill" cx="9" cy="8" r="3.6" /><path className="fill" d="M2.5 20c0-4 2.9-6.2 6.5-6.2s6.5 2.2 6.5 6.2z" /><circle cx="9" cy="8" r="3.6" /><path d="M2.5 20c0-4 2.9-6.2 6.5-6.2s6.5 2.2 6.5 6.2zM16 4.8a3.2 3.2 0 010 6.4M18 14c2.4.6 3.6 2.7 3.6 6" /></svg>,
  marketing: <svg viewBox="0 0 24 24"><path className="fill" d="M3 9.5v5h3.5l8.5 5V4.5l-8.5 5z" /><path d="M3 9.5v5h3.5l8.5 5V4.5l-8.5 5zM18.5 8.5a4.5 4.5 0 010 7M7 14.5l1.5 5h3" /></svg>,
  stats: <svg viewBox="0 0 24 24"><path className="fill" d="M4 20v-7h4v7zM10 20V5h4v15zM16 20v-10h4v10z" /><path d="M4 20v-7h4v7zM10 20V5h4v15zM16 20v-10h4v10zM2 20.5h20" /></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.2-.8.2-1.3z" /></svg>,
  reviews: <svg viewBox="0 0 24 24"><path d="M4 10.5V20h16v-9.5M3 10l1.6-5.5h14.8L21 10a3 3 0 01-6 0 3 3 0 01-6 0 3 3 0 01-6 0z" /><path className="fill" d="M12 11.6l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" /><path d="M12 11.6l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" /></svg>,
  help: <svg viewBox="0 0 24 24"><path className="fill" d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0012 3z" /><path d="M9 18.5h6M10 21.5h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0012 3z" /></svg>,
};

const LABELS: Record<Card | 'help', string> = { stock: 'Stock', prices: 'Prices', build: 'Build', staff: 'Staff', marketing: 'Marketing', stats: 'Stats', settings: 'Settings', reviews: 'Reviews', help: 'Help' };
export const BLURBS: Record<Card | 'help', string> = {
  build: 'Place counters, shelves and fridges', stock: 'Order boxes from suppliers', prices: 'Set what things cost',
  staff: 'Hire cashiers and stockers', marketing: 'Flyers, deals and signs', stats: 'Money, sales and customers',
  settings: 'Sound, controls, saves', reviews: 'Your Business Profile: reviews and photos', help: 'What should I do next?',
};
const DOCK: Card[] = ['build', 'stock', 'prices', 'staff', 'marketing', 'stats'];
const KEYS: Partial<Record<Card, string>> = { build: 'B', stock: 'Tab' };
export const UNLOCK_DAYS: Partial<Record<Card, number>> = { staff: 3, marketing: 5 };
/** Whether a card can be opened yet (Build opens on day 2, Staff on day 3, Marketing on day 5). */
export function cardUnlocked(snap: Snapshot, c: Card): boolean { return c === 'settings' || c === 'stats' || c === 'stock' || c === 'prices' || c === 'reviews' || !!snap.unlocks[c as keyof Snapshot['unlocks']]; }
/** Open a card, or say which day it opens on. */
export function openOrSayWhen(runtime: GameRuntime, snap: Snapshot, c: Card): void {
  if (cardUnlocked(snap, c)) runtime.openCard(c); else runtime.showToast(`${LABELS[c]} opens on day ${UNLOCK_DAYS[c] ?? 2}.`);
}

/** Money counter that ticks up toward the real value. */
function useTicking(value: number): number {
  const [shown, setShown] = useState(value);
  const target = useRef(value);
  useEffect(() => { target.current = value; }, [value]);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      setShown((s) => {
        const d = target.current - s;
        if (Math.abs(d) < 0.01) return target.current;
        return s + d * 0.18;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return shown;
}

const SPEED_ICONS: Record<Speed, JSX.Element> = {
  0: <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>,
  1: <svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg>,
  2: <svg viewBox="0 0 24 24"><path d="M3 5l9 7-9 7zM12 5l9 7-9 7z" /></svg>,
  4: <svg viewBox="0 0 24 24"><path d="M1 5l7.5 7L1 19zM8.5 5l7.5 7-7.5 7zM16 5l7.5 7-7.5 7z" /></svg>,
};
const SPEED_NAMES: Record<Speed, string> = { 0: 'Pause', 1: 'Play', 2: 'Fast', 4: 'Fastest' };

/**
 * The heads-up display: what you have (cash, the day, whether you are open) top left, time
 * controls top right, and every tool as a big labelled tile on a shelf along the bottom.
 */
/** The logo is drawn in the brand's green; turn its hue (and soften it for cocoa) to the shop's colours. */
function logoTint(id: string): string | undefined {
  const sc = schemeById(id);
  if (sc.id === 'green') return undefined;
  const hue = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const sat = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
  return `hue-rotate(${Math.round(hue(sc.primary) - hue('#3FA87A'))}deg) saturate(${(sat(sc.primary) / sat('#3FA87A')).toFixed(2)})`;
}

export function TopBar({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const shown = useTicking(snap.cash);
  const speeds: Speed[] = [0, 1, 2, 4];
  const unlocked = (c: Card) => cardUnlocked(snap, c);
  const status = snap.phase === 'setup' ? 'setup' : snap.phase === 'open' ? 'open' : 'closed';
  const night = snap.phase === 'night' || snap.phase === 'closing';
  return (
    <>
      <div className="hud-status" role="group" aria-label="Your shop">
        <img className="hud-logo" src="/brand/logo-small.svg" alt="Shelf Made" width={48} height={48} style={{ filter: logoTint(snap.scheme) }} />
        <div className="pill cash" aria-live="polite" aria-label="Cash">
          <span className="coin" aria-hidden="true">$</span>
          <span className="money">{money(shown)}</span>
        </div>
        <div className="pill day" aria-label="Day and time">
          <span className={`dial${night ? ' moon' : ''}`} aria-hidden="true" style={{ ['--t' as string]: snap.dayFrac }}><i /></span>
          <span className="clock"><b>Day {snap.day}</b><small>{snap.phase === 'setup' ? 'Setting up' : snap.clock}</small></span>
        </div>
        {status !== 'setup' && <div className={`pill sign ${status}`} aria-label={`Shop is ${status}`}>{status === 'open' ? 'OPEN' : 'CLOSED'}</div>}
      </div>

      {snap.phase !== 'picking' && !snap.jobs && <GoalChip runtime={runtime} snap={snap} />}

      {snap.phase === 'setup' && (
        <button className="btn open-shop" data-card="open" onClick={() => runtime.dispatch({ type: 'openShop' })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l9-2v18zM13 5h5v16M10 12v1.5" /></svg>
          <span>Open shop<small>Let customers in</small></span>
        </button>
      )}

      <div className="hud-time" role="group" aria-label="Time and options">
        <div className="speeds" role="group" aria-label="Game speed">
          {speeds.map((s) => (
            <button key={s} className={snap.speed === s ? 'active' : ''} onClick={() => runtime.setSpeed(s)} aria-pressed={snap.speed === s} aria-label={s === 0 ? 'Pause' : `${s}x speed`} title={`${SPEED_NAMES[s]}${s === 0 ? ` (${keyLabel(snap.settings.keys.pause)})` : ''}`}>{SPEED_ICONS[s]}</button>
          ))}
        </div>
        {snap.phase !== 'picking' && (
          <button className={`roundbtn biz-hud${snap.card === 'reviews' ? ' active' : ''}${snap.reviews.unseen > 0 ? ' fresh' : ''}`} onClick={() => runtime.openCard('reviews')} aria-pressed={snap.card === 'reviews'} data-card="reviews" title={BLURBS.reviews}
            aria-label={`Business Profile: ${snap.reviews.count} review${snap.reviews.count === 1 ? '' : 's'}${snap.reviews.count ? `, rated ${snap.reviews.rating.toFixed(1)}` : ''}${snap.reviews.unseen ? `, ${snap.reviews.unseen} new` : ''}`}>
            {ICONS.reviews}
            <span className="badge" aria-hidden="true">{snap.reviews.count > 999 ? '999+' : snap.reviews.count}</span>
            {snap.reviews.count > 0 && <span className="rating" aria-hidden="true">{snap.reviews.rating.toFixed(1)}★</span>}
          </button>
        )}
        <button className={`roundbtn${snap.card === 'settings' ? ' active' : ''}`} onClick={() => runtime.openCard('settings')} aria-pressed={snap.card === 'settings'} data-card="settings" title={BLURBS.settings} aria-label="Settings">{ICONS.settings}</button>
      </div>

      {snap.phase !== 'picking' && <nav className="dock" aria-label="Tools">
        <div className="dock-shelf">
          {DOCK.map((c) => {
            const open = unlocked(c);
            return (
              <button key={c} className={`tile t-${c}${snap.card === c ? ' active' : ''}${open ? '' : ' locked'}${snap.tip?.anchor === `button:${c}` && snap.card !== c ? ' nudge' : ''}`} onClick={() => openOrSayWhen(runtime, snap, c)} aria-pressed={snap.card === c} data-card={c} title={open ? BLURBS[c] : `${LABELS[c]}: opens on day ${UNLOCK_DAYS[c] ?? 2}`}>
                <span className="face">{ICONS[c]}{!open && <svg className="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></svg>}</span>
                <span className="label">{LABELS[c]}</span>
                {open && KEYS[c] && <kbd className="key-chip">{KEYS[c]}</kbd>}
                {!open && <span className="soon">Day {UNLOCK_DAYS[c]}</span>}
                {snap.unlocks.newBadges.includes(c) && <span className="new">New!</span>}
              </button>
            );
          })}
          <span className="dock-gap" aria-hidden="true" />
          <button className="tile t-help" onClick={() => runtime.showHint()} title={BLURBS.help} data-card="hint">
            <span className="face">{ICONS.help}</span><span className="label">Help</span>
          </button>
        </div>
      </nav>}
    </>
  );
}
