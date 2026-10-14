# Shelf Made: status

Build log for the unattended build session (October 14, 2026). Everything below was built from
an empty repository in this session.

## Follow camera and the crossroads (latest)

- [x] **Follow camera.** A narrow lens looks down at the manager from behind and above, 12 units
  back by default: the manager, the shelves, the queue and the door in view. The wheel, + and −,
  or a pinch zoom from the shelves (7) out to the whole crossroads (68); one scroll out shows the
  lot and the road. Past 30 the camera pans freely (WASD, optional edge pan) and drifts to the
  middle of the crossroads; C brings it back. Q / E turn it in 45° steps, a right-drag turns and
  tilts it (35–70°). Docked cards and the jobs list push the manager to the middle of what you can
  still see; Build pulls back so the whole floor fits beside the card.
- [x] **Walk, click, tap.** WASD walks relative to the camera; a click or tap on the floor walks
  there; on a shelf, the pallet or a spill it walks over and uses it. F uses whatever is outlined
  in front of you (yellow outline and a key label over it; the crosshair is gone), Space scans.
  The Build ghost follows the mouse or tap; a click places it, a plain right click cancels.
  Building never traps the manager. Use moved from E to F (old key settings migrate).
- [x] **The manager stands out.** A name badge and a clipboard; boxes carried in both arms.
- [x] **The crossroads.** One intersection: the player on the corner they picked, Cheapo, Fresh &
  Fine and MegaMart on the other three with real storefronts, lots and pylons (fenced and "coming
  soon", then scaffolding, before they open). Zebras on all four arms and a timed light that cars
  and walkers obey; three shared bays on Elm Street; a bus stop with rush-hour bursts; rival
  shoppers you can see walking in and driving in, more of them during a sale; a full lot sends
  the next car on to a rival or the street bays. Franchises and MegaMart's branches open in
  off-map neighbourhoods named on the road signs; flyers go to the same places; three physical
  billboards. Save version 9 with a migration from the valley.
- [x] **Nothing beyond the crossroads.** On your note, the backdrop ring (house backs, blocks,
  forest, hills) is gone: the corners sit on an empty level plain and both roads run off into the
  haze, where the traffic appears and vanishes.
- [x] **Lighter.** 79–130 draw calls and 126k–233k triangles from the shelves out to the full
  overview (the valley: 131–217 and 494k–790k). People and cars sit on blob shadows, each
  character is one draw, far-off people are instanced stand-ins.
- [x] **Fixes found on the way.** A car pulling into a street bay could wedge itself beside the
  parked car behind it; parked cars whose drivers went home at closing stayed for ever (one run
  piled up 518 cars); a customer removed at closing stayed at the head of the till's line so nobody
  was served the next day.

Checks on the latest run:

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 52 passed, including the crossroads plan (corner lots never overlap or touch a road, fit the largest shop with the doubled lot, the player's corner holds only their shop, level ground, only roads run on past the town), traffic (no overlaps at rush hour, nobody runs a red, turned-away cars never stuck, a car pulls into a street bay past a parked neighbour, a driverless car drives off), rival shoppers, building never traps the manager, a shelf against a wall is reached from the room, and a till line never waits on someone who has gone |
| `npm run e2e` | 8 passed: the first day with the follow camera (place a counter and a shelf with the mouse, right click to stop placing, order, click the floor to walk to the pallet, F to pick up, click the shelf to stock it, open, click the counter to walk behind it, Space to scan, close up, save and quit); zoom, turn and come back with C; tap to walk and tap a shelf on a phone viewport; the lobby; 21 screenshots; perf |
| `npm run audit:art` | 418 models, passed |
| `npm run balance -- --check` | passed: nobody sensible goes bust, nobody stuck, the fit-out leaves $136; guided ≈ $61/day in week one; rivals take 24% of a guided player's trade over week one (40–50% on days 6–7 once Fresh & Fine opens) |
| Perf (`npm run perf`) | default zoom 79 draw calls / 126k triangles; busy at 4x 104 / 153k; mid zoom 107 / 157k; full overview 130 / 233k (budget 250 / 900k) |

Screenshots in `docs/screens/`: `01-lobby`, `02-plot-picker`, `03-bare-shell`, `04-build-ghost`,
`05-carrying-a-box`, `06-close-shop` (default zoom), `07-mid-zoom` (one scroll out: queue, door,
lot, road), `08-overview` (the full zoom), `09-crossroads-above`, `10-rival-corners`, `11-delivery`,
`12-finance-card`, `13-rival-sale-zebra`, `14-staff-on-floor`, `15-market-hall`,
`16-market-hall-lot`, `17-full-lot-to-rival`, `18-franchise-sign`, `19-night-card`,
`20-phone-play`, `21-lobby-phone`.

Still open from this round:
- **Week-one income is ≈ $61/day, under the ≈ $75 the brief asks for** (the valley build measured
  $57). The guided player is held back by its own capacity (a full lot turns 12–70 drivers away a
  day, and it runs out of stock), not by traffic, so more traffic would not close the gap. The fix is
  a balance number (cheaper extra bays, or a bigger starter lot); see Decisions needing you.
- The camera was driven by tests and screenshots in headless Chromium; zoom speed, follow
  smoothing and the turn steps want a human pass with a real mouse and a phone.
- The rival buildings are plain boxes with window panes; the toy-town art pass is next.

## Rework after the first play

What changed after feedback that the art did not fit Kenney, meshes clipped, the map was open
land and the camera felt wrong:

- [x] **First person.** You are the manager: mouse look (pointer lock, drag fallback), WASD, a
  crosshair that says what E does, Space to scan behind the counter, B for Build, Tab for Stock,
  touch sticks on phones. People are solid around you and never fill the lens.
- [x] **Build it yourself.** A new shop is a bare concrete room with four walls, a roof and a lit
  ceiling. You place the counter, shelves and chillers (ghost on the tile under the crosshair),
  order stock, carry each box from the delivery pallet to a shelf, then press Open shop. Eight
  tips walk through it with a marker over the target.
- [x] **Kenney art that fits.** Kenney walls (outside the floor so nothing clips), a poured
  concrete slab, Kenney fixtures with stock fitted to measured slot boxes, the chest freezer as
  an open lit chiller, Food Kit products, the name in Fredoka letters on a fascia and a pylon.
- [x] **A cohesive valley.** Snow-capped mountains and wooded foothills to the north, a river
  with stone bridges, a riverside path, farmland, a park, Back Lane behind the shops, woods on
  every side; roads run on into the haze.
- [x] **Property lots.** Every house and shop stands on its own lot; nothing touches the shop
  plot; fences run along the lot lines; the shop's driveway and walkway meet the road and sidewalk
  with a dropped kerb and a zebra.
- [x] **Traffic manners.** Cars keep their distance, wait for gaps at junctions, use in and out
  lanes, park nose first and back out; no more pop-in at the town edge.
- [x] **Brand.** The logo is a shop front: the name on the fascia over the shelf bracket, a
  striped awning, a stocked window and a door with an OPEN sign (vector, transparent; a simpler
  version for the favicon and top bar). The lobby shows it as the title over a live demo shop, with
  the awning, a price-tag beta badge, the shelf-label menu, an OPEN sign and an LED ticker.
- [x] **Sweep.** Baskets no longer litter the floor (spills instead); the sign merge bug that hid
  the shop name; stale "click the shelf / storeroom / pan" wording; the chiller's hidden well;
  tips that skipped a key name; cars spinning in their bays; walkers and cars appearing in view.

Checks on the latest run:

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 59 passed, including new town tests (lots never overlap, buildings fit their lots, nothing on the shop plot, fences on lot lines, level valley floor, bridges) and traffic tests (no two cars ever overlap at rush hour, parked cars nose-in) |
| `npm run e2e` | 5 passed: the first day in person with real key presses (B, R, E, Tab, Space), the lobby, 19 screenshots, perf |
| `npm run audit:art` | 367 models, passed |
| `npm run balance -- --check` | passed: the fit-out is paid for (≈ $136 left of $800), guided ≈ $57/day in week one, nobody sensible goes bust, nobody stuck |
| Perf | ≤ 217 draw calls (budget 250), 600k to 790k triangles per frame including shadows (budget 900k) |

Screenshots in `docs/screens/`: `01-lobby`, `02-plot-picker`, `03-bare-shell`, `04-build-ghost`,
`05-carrying-a-box`, `06-behind-the-counter`, `07-shop-floor`, `08-main-street`, `09-valley`,
`10-river-bridge`, `11-delivery`, `12-finance-card`, `13-rival-sale`, `14-staff-on-floor`,
`15-market-hall`, `16-market-hall-lot`, `17-franchise-branch`, `18-night-card`, `19-lobby-phone`.

Still open from this round:
- **Vercel**: creating the project returns 403 ("You don't have permission to create the project")
  for the Startups team; a team owner needs to create it or grant the permission. `vercel.json` is ready.
- First person was tested with headless Chromium and key presses; real mouse feel (sensitivity,
  head bob) wants a human pass. Settings has a mouse-speed slider and invert-Y.
- Customers and staff are drawn to the same scale as you: the walls are 1.4 people tall, so the
  ceiling sits close above your eyes. That is Kenney's proportion.

The sections below are the original build log; the numbers and screenshot names in them are from
before this rework.

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
- (Resolved) Pushing to GitHub works now; the branch is on GitHub.
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
0. **Week-one income.** Guided play makes ≈ $61/day against a ≈ $75 target. Cheaper extra parking
   ($500 now) or a starter lot with more bays would close most of it; say which and the harness will
   hold the line.
1. **Vercel permission.** Project creation is refused (403) for the Startups team; create the project from the repo in the Vercel dashboard or grant the permission.
2. **Prices and pace.** A guided player nets about $75/day in week one and buys a shelf every day or two; say if you want it tighter or looser, and the harness will hold the line.
3. **Fonts and brand.** The wordmark underline is CSS in the lobby and a green bar on the pylon sign; if you have a real logo file it drops into `TopBar.tsx` and `StoreView.ts`.

## Next steps
1. Fix GitHub access, push the branch, watch the CI run (it installs Playwright Chromium and runs everything in this table).
2. Play it on a real GPU for twenty minutes: tune audio levels, the first-day pace, and the camera limits by feel; record `npm run perf` on a laptop.
3. Deepen the two thinnest systems: staff shifts (morning/evening, part-time) and a real second floor for franchises (reuse the store renderer with a lighter tick).
