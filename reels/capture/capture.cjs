/*
 * Films one take of a web game for a reel: the game in headless Chromium, its own loop
 * switched off, stepped one frame at a time by a director script (see
 * references/director-contract.md), every frame streamed into ffmpeg; then the take's
 * logged sounds rendered offline, in sync. Writes <out>/<name>.mp4 (silent video),
 * <name>.wav (game audio) and <name>.json (shot, sound log, moments, KO time).
 *
 *   NODE_PATH=$(npm root -g) DIRECTOR=path/to/director.js GAME_URL=http://localhost:5173/?dev \
 *     node capture.cjs '<shot json>' [outDir]
 *
 * The game must be served from a production build (vite preview / http-server), not a
 * dev server with hot reload: a reload mid-take kills it.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const shot = JSON.parse(process.argv[2]);
const outDir = path.resolve(process.argv[3] ?? 'reels/out');
const director = path.resolve(process.env.DIRECTOR ?? path.join(process.cwd(), 'reels/capture/director.js'));
const url = process.env.GAME_URL ?? 'http://localhost:5173/';
const W = +(process.env.W ?? 1080);
const H = +(process.env.H ?? 1920);
const FPS = 30;
const port = 5200 + (process.pid % 700);
fs.mkdirSync(outDir, { recursive: true });
const file = (ext) => path.join(outDir, `${shot.name}.${ext}`);

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
  // (WebGL readPixels rows run bottom-up.)
  '-vf', process.env.VFLIP === '0' ? 'null' : 'vflip', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', file('mp4')],
  { stdio: ['pipe', 'inherit', 'inherit'] });

let wav = null;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const done = () => {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
      res.end('ok');
    };
    if (req.url === '/frame') {
      if (body.length !== W * H * 4) console.warn(`[${shot.name}] frame of ${body.length} bytes, expected ${W * H * 4}`);
      if (ff.stdin.write(body)) done();
      else ff.stdin.once('drain', done);
    } else if (req.url === '/wav') {
      wav = body;
      done();
    } else done();
  });
});

(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[${shot.name}] pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && !/GL Driver/.test(m.text()) && console.log(`[${shot.name}] ${m.text()}`));
  // The game's own loop never runs: frames are stepped by hand.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 1;
  });
  await page.addInitScript({ path: director });
  await page.goto(url);
  // (rAF is stubbed, so waitForFunction must poll on a timer, not on animation frames.)
  await page.waitForFunction(() => window.__reel && window.__reel.ready(), null, { timeout: 180000, polling: 500 });
  await page.evaluate((o) => window.__reel.setup(o), shot);

  const t0 = Date.now();
  let st;
  for (;;) {
    st = await page.evaluate(async (port) => {
      const buf = window.__reel.step();
      await fetch(`http://127.0.0.1:${port}/frame`, { method: 'POST', body: buf });
      return window.__reel.state();
    }, port);
    if (st.frame % 30 === 0) console.log(`[${shot.name}] ${st.t.toFixed(1)}s ko=${st.koAt} (${((Date.now() - t0) / st.frame).toFixed(0)} ms/frame)`);
    const over = st.over || (st.koAt >= 0 && st.t >= st.koAt + (shot.tail ?? 3));
    if (over || st.t >= (shot.seconds ?? 30)) break;
  }
  const seconds = st.frame / FPS;
  await page.evaluate(async ({ port, seconds }) => {
    const bytes = await window.__reel.renderAudio(seconds);
    if (bytes) await fetch(`http://127.0.0.1:${port}/wav`, { method: 'POST', body: bytes });
  }, { port, seconds });
  const log = await page.evaluate(() => ({ events: window.__reel.events, marks: window.__reel.marks, koAt: window.__reel.koAt }));
  fs.writeFileSync(file('json'), JSON.stringify({ shot, seconds, fps: FPS, ...log }, null, 1));
  if (wav) fs.writeFileSync(file('wav'), wav);
  await browser.close();
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  server.close();
  console.log(`[${shot.name}] done: ${seconds.toFixed(1)}s, ${log.marks.length} moments, ${log.events.length} sounds, KO at ${log.koAt}`);
})().catch((e) => {
  console.error(`[${shot.name}] ${e.stack ?? e}`);
  process.exit(1);
});
