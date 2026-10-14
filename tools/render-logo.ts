/**
 * Brand mark: renders the manager's head with three.js in headless Chromium and writes
 * transparent PNGs to public/brand/. Run with `npm run gen:logo`.
 */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = join(process.cwd(), 'public', 'brand');
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH === undefined ? '/opt/pw-browsers/chromium' : (process.env.CHROMIUM_PATH || undefined),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const q = process.argv[2] ?? '';
  await page.goto(`http://localhost:5199/tools/logo/index.html${q}`);
  await page.waitForFunction(() => window.__logo || window.__logoError, null, { timeout: 120_000 });
  const err = await page.evaluate(() => window.__logoError);
  if (err) throw new Error(err);
  const logo = await page.evaluate(() => window.__logo!);
  for (const [size, url] of Object.entries(logo)) {
    writeFileSync(join(out, `manager-head-${size}.png`), Buffer.from(url.split(',')[1]!, 'base64'));
  }
  console.log(`wrote ${Object.keys(logo).length} PNGs to public/brand/`);
} finally {
  await browser.close();
  await server.close();
}
