/*
 * Plays a few in-game days headless and dumps the reviews shoppers wrote (and develops their
 * photos) for the reviews reel: reels/out/reviews.json and reels/out/photo-<id>.jpg.
 *   NODE_PATH=$(npm root -g) GAME_URL=http://127.0.0.1:4173/ node reels/capture/reviews.cjs [seed] [days]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const [seed = '3', days = '5', mode = 'good'] = process.argv.slice(2);
const out = path.resolve('reels/out');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.addInitScript(() => { window.requestAnimationFrame = () => 1; });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.__shelf && window.__shelf.ready() && window.__shelf.runtime.renderer, null, { timeout: 180000, polling: 500 });
  const res = await page.evaluate(({ seed, days, mode }) => {
    const h = window.__shelf;
    h.newGame(+seed, 'main', 'Corner Fresh', { tutorial: false });
    h.setSpeed(0); h.quickSetup(true); h.openRivals(); h.dispatch({ type: 'cheat', cash: 30000 });
    if (mode === 'good') {
      for (const role of ['cashier', 'stocker', 'cleaner']) { const c = h.state().staffPool.find((x) => x.role === role); if (c) h.dispatch({ type: 'hire', candidateId: c.id }); }
      h.playDays(+days);
    } else {
      // A neglected shop: nobody on the till but a slow owner, nothing restocked, nobody mopping.
      const s = h.state();
      for (let d = 0; d < +days; d++) {
        if (s.phase === 'night') { s.tomorrow = null; h.dispatch({ type: 'openTomorrow' }); }
        for (let i = 0; i < 20000 && s.phase !== 'night'; i++) { h.advanceNoScan(0.05); if (i % 90 === 0) h.dispatch({ type: 'scan' }); if (i % 400 === 0) h.crowd(2); }
      }
    }
    const l = h.state().listing;
    const photos = [];
    for (const r of l.reviews) for (const p of r.photos) { const url = h.runtime.renderer.takePhoto(h.state(), p, null); photos.push({ id: p.id, kind: p.kind, url }); }
    return { stars: l.stars, count: l.count, reviews: l.reviews.map((r) => ({ ...r, photos: r.photos.map((p) => ({ id: p.id, kind: p.kind })) })), photos };
  }, { seed, days, mode });
  fs.mkdirSync(out, { recursive: true });
  for (const p of res.photos) if (p.url) fs.writeFileSync(path.join(out, `photo-${mode}-${p.id}.jpg`), Buffer.from(p.url.split(',')[1], 'base64'));
  delete res.photos;
  fs.writeFileSync(path.join(out, `reviews-${mode}.json`), JSON.stringify(res, null, 1));
  console.log(`${res.count} reviews, ${res.stars} stars`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
