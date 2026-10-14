import { useSyncExternalStore } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';

export function useSnapshot(rt: GameRuntime): Snapshot {
  return useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
}

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
