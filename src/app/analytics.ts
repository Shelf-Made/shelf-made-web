/**
 * Analytics stub. Off by default; only when the player opts in (Settings → Privacy) are events
 * queued, and even then they go nowhere in the beta: `flush()` just clears the queue.
 * Keeping the surface tiny means a future provider is a one-file change.
 */
export interface AnalyticsEvent { name: string; props?: Record<string, string | number | boolean>; at: number }

export class Analytics {
  private queue: AnalyticsEvent[] = [];
  enabled = false;
  track(name: string, props?: AnalyticsEvent['props']): void {
    if (!this.enabled) return;
    this.queue.push({ name, props, at: Date.now() });
    if (this.queue.length > 200) this.queue.shift();
  }
  flush(): AnalyticsEvent[] { const out = this.queue; this.queue = []; return out; }
}

export const analytics = new Analytics();
