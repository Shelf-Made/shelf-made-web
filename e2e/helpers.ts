import type { Page } from '@playwright/test';

export async function ready(page: Page): Promise<void> {
  await page.goto('/');
  // Headless SwiftShader renders slowly, which stalls CSS animations mid-fade; screenshots want final states.
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.waitForFunction(() => (window as unknown as { __shelf?: { ready: () => boolean } }).__shelf?.ready() === true, null, { timeout: 90_000 });
}

export async function hooks<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(({ fn, args }) => {
    const h = (window as unknown as { __shelf: Record<string, (...a: unknown[]) => unknown> }).__shelf;
    return h[fn]!(...args) as T;
  }, { fn, args });
}

export async function settle(page: Page, ms = 600): Promise<void> {
  await page.waitForTimeout(ms);
}
