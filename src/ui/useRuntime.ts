import { useSyncExternalStore } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { formatMoney } from '@/sim/money';

export function useSnapshot(rt: GameRuntime): Snapshot {
  return useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
}

/** Every money string in the UI: the sim's one sign-correct formatter ("-$46.70"; `sign` adds "+" on gains). */
export function money(n: number, sign = false): string {
  return formatMoney(n, { sign });
}
