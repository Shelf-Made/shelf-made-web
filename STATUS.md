# Shelf Made: status

Build log for the unattended build session (October 14, 2026). Everything below was built from
an empty repository in this session.

## Done

### Part 1: the look and the first five minutes (all slices complete)
- [x] S0 Scaffold: Vite 8 + strict TypeScript + React 19 + three.js, ESLint with a sim-isolation rule, Vitest, Playwright on the preinstalled Chromium, GitHub Actions, `vercel.json`.
- [x] S1 Assets: ten Kenney CC0 packs downloaded and kept untouched in `third_party/`; `tools/convert-assets.ts` packs every colormap into one atlas, rescales packs to Mini Market's tile, splits products off shelves, keeps 14 character clips, quantises; `tools/gen-models.ts` writes the game's own pieces; `docs/STYLE_GUIDE.md` measured from the packs; `npm run audit:art` enforces it (332 models, 1.8 MB gzipped).
- [x] S2 World: main road with moving traffic and cross streets, the player's plot with parking, driveway, service lane and back yard, rival storefronts with CLOSED / SALE / name boards, 60+ houses with gardens, fences, trees, street lamps that glow at night, benches, walkers with dogs. Camera: pan, zoom, rotate, tilt, edge pan, pinch, focus key. Time-of-day lighting.
- [x] S3 Store: generated white walls with the green stripe, cut to a ledge on the camera-facing sides, honey plank floor, grey storeroom tiles, pylon sign with the shop's name in chunky letters (fascia sign when viewed from behind), striped awning, Kenney register / shelf / fridge / baskets / plant, product blocks instanced per shape with full / half / empty stock, storeroom boxes, warm night glow.
- [x] S4 People & cars: grid A* with wall-edge blocking and string pulling, arrival tolerance and separation, queues that bend into the shop, 13 character meshes × 4 recolour variants × height, walk / browse / carry / pay clips, cars that park in bays, turn away when the lot is full and leave by the road, delivery trucks to the back door, ambient traffic.
- [x] S5 Core loop: click the register / hold Space to scan with a beep, "+$" popup and cash sound, order stock from three suppliers, truck + boxes in the storeroom, click a shelf and the owner carries stock, set prices and watch who walks, 12-minute days, night card with "Day N done: ±$", rent and power.
- [x] S6 First five minutes: plot picker that pans the camera between three corners with different rents and shopper mixes, shop naming onto the sign, five guided speech-bubble tips with bouncing arrows and $25 rewards, Skip always available.
- [x] S7 UI, audio, saves: slim top bar only (logo, ticking money, day and clock, seven labelled icon buttons with New! badges, Hint, pause/1x/2x/4x), right-docked cards that slide the world aside and close with Esc, lobby with real loading progress, Continue, New game with difficulty, Sandbox, save slots with export/import, Settings (volumes, quality, larger UI, colour-blind markers, key rebinding, edge pan, privacy), feedback link, version and beta notice. Synthesised audio (register beep, ka-ching, door chime, engines, truck, boxes, rewards, UI clicks, street ambience, music that changes with the time of day) starting after the first click. IndexedDB saves with migrations (v7), nightly autosave, three slots.

### Part 2: the deeper systems
- [x] P1 Customers: four types with the design's weights, six store scores (price vs town average, availability, clean & layout, wait, parking, awareness), softmax share against rivals, budgets, patience, abandoned baskets as visible litter, slow reputation. Stats card shows the scores and shares.
- [x] P2 Supply: 48 products across six categories, three suppliers (price, speed, minimums, invoice terms), daily wholesale swings, shortages, spoilage, shelf and storeroom limits, chilled goods need fridges.
- [x] P3 Money: rent, power per fridge, wages + 12% payroll tax, invoices with terms, three loans with interest and one rescue, shoplifting, card fees, finance section (P&L, cash, upcoming bills, loans), fail state with a game-over card.
- [x] P4 Staff: hiring pool refreshed daily, five roles, wage / skill / speed / morale, shifts (all day, mornings, evenings at 55% pay; the owner covers the till when the cashier is off), cashier slips and dropped boxes, raises, quitting, stockers restock, cleaners clear litter, orderers reorder to a point, managers follow rules (reorder point, spend cap, price range, wage cap).
- [x] P5 Build mode: twelve-item catalog, ghost with valid/invalid colour, the reason in words and the price, rotate, move, copy, sell at 60%, undo/redo, placement that never blocks a path, three shop sizes, lot expansion, heat-map / exposure / path overlays. Layout matters: exposure near the door and on end caps, impulse grabs, walking distance and crowding penalties.
- [x] P6 Rivals: discounter, premium grocer and expanding chain open on days 3 / 6 / 10, run sales that visibly pull bargain hunters (SALE board across the road, notices), reputations drift; MegaMart opens more branches.
- [x] P7 Balance harness: `npm run balance -- --check` runs cautious, aggressive, delegator, franchiser, careless-builder and guided-new-player strategies over six seeds and asserts the brief's six rules. Passing.
- [x] P8 Checkout: cashiers take the register, self-checkout kiosks (slower, hiccups, loyalists avoid them), cash / card (1.8% fee) / mobile.
- [x] P9 Parking: a full lot visibly turns drivers away ("Lot full!"); the lot can be doubled.
- [x] P10 Progression: Build on day 2, Staff day 3, Marketing day 5 with New! badges; a Hint button that says what to do next; Relaxed / Standard / Hard; Sandbox.
- [x] P11 Marketing: flyers by area that fade, three billboard sites with daily rent, ad templates (product / discount / shopper type) with a reputation penalty for ads you cannot honour, loss leaders and buy-two deals, Saturdays, festivals, holidays, weather and random events, an outside sign.
- [x] P12 Franchises: open a branch on either free plot with a manager from the pool; a lighter daily simulation driven by manager skill and your rules; shared reputation; nightly reports and alerts; branches appear in town with name boards.
- [x] P13 Packaging: `desktop/` Electron wrapper saving to the user-data folder through the storage interface, optional `steamworks.js` layer the web build never loads, opt-in analytics stub (off by default).

## Results (this session's final run)

| Check | Result |
|---|---|
| `npm run lint` (ESLint + tsc, sim isolation) | clean |
| `npm test` (Vitest) | 15 passed: determinism, full day with nobody stuck, deliveries, paths through doors, plot pick, saves round-trip + migration, scoring, rivals, budgets, staff, unlocks, franchises, kiosks + fees |
| `npm run e2e` (Playwright, SwiftShader) | 3 passed: gameplay flow (real clicks on the register, a Stock-card order, a pointer-placed shelf, Esc, save & quit), screenshots, perf |
| `npm run audit:art` | 332 models audited, passed |
| `npm run balance -- --check` | passed; guided player ≈ $75/day in week one, no sensible strategy bust, careless builder 2 of 6 bust |
| Perf (`docs/screens/perf.json`) | draw calls 67 starter / 152 busy at 4x / 163 zoomed out (budget 250); triangles 244k / 289k / 316k; bundle 1.6 MB gzipped (three.js 159 KB, app 45 KB) + 1.8 MB models + 93 KB atlas, well under 15 MB |
| FPS | SwiftShader software GL in the container gives 10–42 fps, which says nothing about a laptop GPU; the draw-call and triangle counts are the budget that was checked |

Screenshots in `docs/screens/`: `01-lobby`, `02-plot-picker`, `03-first-tip`, `04-shop-default-zoom`, `05-busy-shop`, `06-neighbourhood`, `07-delivery`, `08-night-card`, `09-stock-card`, `10-prices-card`, `11-build-mode`, `12-finance-card`, `13-rival-sale`, `14-staff-on-floor`, `15-expanded-shop` (market hall with a doubled lot), `16-franchise-branch`.

Visual checklist, as of the last run: store ≈ 45% of the screen at default zoom with every room readable; no see-through walls; shelves show what they hold and empty shelves are bare; the busy shot has eight distinct people in a line; brand colours; only the top bar is always on; text ≥ 14 px; the neighbourhood is lived in. The night card and docked cards slide the world aside so nothing covers the store.

## Missing or broken
- **Push to GitHub is blocked** (403: the Claude GitHub App is not installed on `Shelf-Made/shelf-made-web`). Every commit is on the local branch `claude/shelf-made-game-build-1kjvrp`; the container is ephemeral, so this needs fixing first (see "Decisions needing you").
- Real-GPU frame rate was never measured; SwiftShader only. The 60 / 45 fps targets are plausible from the draw-call counts but unverified.
- Rival AI is a small state machine (sales, expansion, drift), not a full copy of the player's command set.
- Franchise stores are a daily roll, not a second simulated floor; their buildings are stock Kenney shop fronts with a name board.
- Kiosk hiccups and cashier slips are popups only; there is no "mistake" animation.
- A late find: the popup layer was swallowing clicks on the world until the last hour; the gameplay spec now clicks the register, a floor tile and the cards for real so this cannot regress silently.
- Audio is synthesised and was never heard in this session (no speakers): levels may need a pass.
- The Electron wrapper and Steam layer were written but not launched here (no display; `npm install` in `desktop/` not run).
- GitHub Actions workflow is untested on GitHub (nothing pushed).
- Mobile layout works at phone width but was not tested on a touch device; pinch zoom is implemented.
- Colour-blind markers cover the UI (symbols on every coloured tag, striped bars); product blocks in the world differ by shape and accent band but carry no extra marker.
- No localisation; English only.

## Decisions needing you
1. **Repository access.** Install the Claude GitHub App on `Shelf-Made/shelf-made-web` (or reconnect GitHub in claude.ai settings) so the branch can be pushed; nothing here is on GitHub yet.
2. **Prices and pace.** A guided player nets about $75/day in week one and buys a shelf every day or two; say if you want it tighter or looser, and the harness will hold the line.
3. **Fonts and brand.** The wordmark underline is CSS in the lobby and a green bar on the pylon sign; if you have a real logo file it drops into `TopBar.tsx` and `StoreView.ts`.
4. **Vercel.** `vercel.json` is ready; connect the repo to a Vercel project when access is sorted.

## Next steps
1. Fix GitHub access, push the branch, watch the CI run (it installs Playwright Chromium and runs everything in this table).
2. Play it on a real GPU for twenty minutes: tune audio levels, the first-day pace, and the camera limits by feel; record `npm run perf` on a laptop.
3. Deepen the two thinnest systems: staff shifts (morning/evening, part-time) and a real second floor for franchises (reuse the store renderer with a lighter tick).
