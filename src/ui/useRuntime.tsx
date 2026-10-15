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

/** A product's picture (its shelf model, rendered at load), or a dot in its colour until the pictures exist. */
export function ProductPic({ runtime, id, color }: { runtime: GameRuntime; id: string; color: string }) {
  const src = runtime.renderer?.productThumbs[id];
  return src ? <img className="product-pic" src={src} alt="" aria-hidden="true" /> : <span className="product-pic dot" style={{ background: color }} aria-hidden="true" />;
}
