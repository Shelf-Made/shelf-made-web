import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { StockCard } from './StockCard';
import { PricesCard } from './PricesCard';
import { StatsCard } from './StatsCard';
import { SettingsCard } from './SettingsCard';
import { LockedCard } from './LockedCard';

export function Card({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="card" role="dialog" aria-label={title}>
      <header><span>{title}</span><button className="close" onClick={onClose} aria-label="Close">✕</button></header>
      <div className="body">{children}</div>
    </div>
  );
}

export function Cards({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const close = () => runtime.closeCard();
  switch (snap.card) {
    case 'stock': return <Card title="Stock" onClose={close}><StockCard runtime={runtime} snap={snap} /></Card>;
    case 'prices': return <Card title="Prices" onClose={close}><PricesCard runtime={runtime} snap={snap} /></Card>;
    case 'stats': return <Card title="Stats" onClose={close}><StatsCard runtime={runtime} snap={snap} /></Card>;
    case 'settings': return <Card title="Settings" onClose={close}><SettingsCard runtime={runtime} snap={snap} /></Card>;
    case 'build': return <Card title="Build" onClose={close}><LockedCard what="Build mode" blurb="Shelves, fridges, registers and more land. Opens on day 3." /></Card>;
    case 'staff': return <Card title="Staff" onClose={close}><LockedCard what="Staff" blurb="Hire a cashier and let them ring people up. Opens on day 4." /></Card>;
    case 'marketing': return <Card title="Marketing" onClose={close}><LockedCard what="Marketing" blurb="Flyers, billboards and deals. Opens on day 6." /></Card>;
    default: return null;
  }
}
