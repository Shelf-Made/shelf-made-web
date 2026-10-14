# Shelf Made

A cheerful grocery tycoon: grow a corner shop into the town's favourite grocer. Free web beta
until December 10, 2026, then Steam.

```
npm install
npm run assets      # convert the Kenney packs in third_party/ into public/assets (needs the zips)
npm run dev         # http://127.0.0.1:5173
npm run build       # type-check + production bundle in dist/
npm test            # Vitest unit tests (sim, saves)
npm run lint        # ESLint (sim isolation rule) + tsc
npm run e2e         # Playwright: gameplay, screenshots, perf (preinstalled Chromium)
npm run shots       # screenshots into docs/screens/
npm run perf        # draw-call / triangle budget, docs/screens/perf.json
npm run audit:art   # every shipped GLB against docs/STYLE_GUIDE.md
npm run balance -- --check   # scripted strategies over many seeds
```

- `docs/DESIGN.md` architecture, numbers, art plan · `docs/STYLE_GUIDE.md` measured art rules
- `STATUS.md` what exists, results, what is missing · `DECISIONS.md` choices made unattended
- `CREDITS.md`, `ASSET_LICENSES.md` every source (CC0 / OFL only)
- `desktop/` Electron wrapper (file saves, optional Steam layer)

You play the manager in first person. Click the world to look around with the mouse (Esc frees
it), WASD to walk, E or left click to use what the crosshair points at (pick up a box, stock a
shelf, place a fixture), Space to scan behind the counter, B opens Build, Tab opens Stock, R or the
wheel turns a fixture, right click cancels, 1/2/3 set speed, P pauses. On a phone: drag the left
half to walk, the right half to look, tap to use.

```
npm run gen:logo    # draw the shop-front logo (SVG + PNGs) into public/brand/
npm run gen:font    # Fredoka Bold to three.js glyphs for the 3D signs
```
