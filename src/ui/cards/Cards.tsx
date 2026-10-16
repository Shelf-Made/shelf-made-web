import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { StockCard } from './StockCard';
import { PricesCard } from './PricesCard';
import { StatsCard } from './StatsCard';
import { SettingsCard } from './SettingsCard';
import { StaffCard } from './StaffCard';
import { BuildCard } from './BuildCard';
import { MarketingCard } from './MarketingCard';
import { BusinessCard } from './BusinessCard';
import { ICONS } from '../TopBar';

export function Card({ title, sub, modal, onClose, children }: { title: string; sub?: string; modal?: boolean; onClose: () => void; children: React.ReactNode }) {
  const id = title.toLowerCase() as keyof typeof ICONS;
  const card = (
    <div className={`card t-${id}${modal ? ' modal' : ''}`} role="dialog" aria-label={title} aria-modal={modal || undefined}>
      <header>
        <span className="head-icon" aria-hidden="true">{ICONS[id]}</span>
        <span className="head-text">{title}{sub && <small>{sub}</small>}</span>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <div className="body">{children}</div>
    </div>
  );
  if (!modal) return card;
  // Full screen: the world dims behind it, and nothing clicked here reaches it (a click outside shuts it).
  return <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>{card}</div>;
}

export function Cards({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const close = () => runtime.closeCard();
  switch (snap.card) {
    case 'stock': return <Card title="Stock" sub="The clock waits while you shop" modal onClose={close}><StockCard runtime={runtime} snap={snap} /></Card>;
    case 'prices': return <Card title="Prices" onClose={close}><PricesCard runtime={runtime} snap={snap} /></Card>;
    case 'stats': return <Card title="Stats" onClose={close}><StatsCard runtime={runtime} snap={snap} /></Card>;
    case 'settings': return <Card title="Settings" onClose={close}><SettingsCard runtime={runtime} snap={snap} /></Card>;
    case 'build': return <Card title="Build" onClose={close}><BuildCard runtime={runtime} snap={snap} /></Card>;
    case 'staff': return <Card title="Staff" onClose={close}><StaffCard runtime={runtime} snap={snap} /></Card>;
    case 'marketing': return <Card title="Marketing" onClose={close}><MarketingCard runtime={runtime} snap={snap} /></Card>;
    case 'reviews': return <BusinessCard runtime={runtime} snap={snap} />;
    default: return null;
  }
}
