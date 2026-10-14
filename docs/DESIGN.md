# Shelf Made: design

A single-player grocery tycoon in a cheerful low-poly town. You start with a corner shop
and grow into a chain. This document is the working reference for architecture, numbers
and the art plan. `STATUS.md` tracks what exists; `DECISIONS.md` logs choices made
without a human in the loop.

## 1. Pillars (what every slice is measured against)

1. **A visible economy.** Every decision shows up as people and cars within ten seconds.
2. **Beginner friendly.** Understood in 30 seconds; the only always-on UI is a slim top bar.
3. **Hands-on moments, never chores.** Scan, carry, price by hand early; hand each to staff later.
4. **Real strategy.** Customer types, reputation, rivals, ads, loans, layout, franchises.
5. **No grind walls.** No upgrade costs more than ~5 days of income.
6. **Rock solid.** Deterministic sim, no stuck customers, autosave every night.

## 2. Architecture

```
src/
  sim/      Plain TypeScript. No React, three.js, DOM or storage imports (ESLint-enforced).
            Deterministic: seeded RNG, fixed tick, one command layer.
  render/   three.js world behind a small `WorldRenderer` interface. Reads sim state,
            never mutates it.
  ui/       React. Top bar, cards, lobby, tips. Talks to the sim only through commands.
  audio/    WebAudio synth + decoded CC0 clips. Starts after the first user gesture.
  save/     Versioned saves with migrations, behind a `StorageBackend` interface
            (IndexedDB on the web, files in the desktop wrapper).
  app/      Runtime wiring: game loop, snapshot store for React, input routing.
tools/      Asset conversion, art audit, balance harness, model generators.
desktop/    Electron wrapper (file saves, optional Steam layer).
```

### 2.1 Sim

- **State** is one plain JSON-serialisable object (`GameState`). No classes, no cycles.
- **Tick**: `tick(state, dtSeconds)` advances at a fixed step of 50 ms of game time.
  The runtime runs `speed × realDt / 0.05` ticks per frame. The renderer interpolates
  between the last two ticks for smooth movement at 1x and higher.
- **Commands**: every player, rival-AI and manager action is a `Command` (`{ type, ... }`)
  applied by `applyCommand(state, cmd)`. Commands are recorded with their tick index so a
  save = `{ seed, version, state }` and a replay = `{ seed, commands[] }`.
- **RNG**: `mulberry32` seeded from the game seed; one stream per subsystem (customers,
  traffic, events, staff) so adding a system does not reshuffle another.
- **Pathfinding**: grid A* at 0.5-unit cells over the whole lot, then string-pulled.
  Fixtures mark cells blocked; people reserve queue slots; a stuck watchdog teleports a
  person to the nearest free cell after 8 s and logs it (the balance harness asserts zero).
- **Entities**: `people` (customers, staff, pedestrians), `cars`, `fixtures`, `stock`.

### 2.2 Render

- Plain three.js (`WebGLRenderer`, sRGB output, soft shadow map 2048 from one sun).
- One angled camera (yaw/pitch/zoom) with smooth limits; "focus store" key `F`.
- Static neighbourhood merged by material (one draw per source pack). Fixtures, products,
  trees, cars, lamps are `InstancedMesh`. Characters are skinned meshes with Kenney's own
  clips (`walk`, `idle`, `pick-up`, `holding-both`, `interact-right`).
- Walls facing the camera are swapped to a 0.28-unit ledge each frame (never see-through).
- Product blocks on shelves are instanced per product shape; stock level drives how many
  instances are visible, so full / half / empty shelves read from across the lot.

### 2.3 UI

- Top bar only: logo, money (ticks up), day + clock, Stock / Prices / Build / Staff /
  Marketing / Stats / Settings with labels, speed buttons. Locked systems show "New!" when
  they unlock. Everything else is a card that closes with Esc and never covers the store
  (cards dock to the right third of the screen).
- Tips are speech bubbles anchored to a world object with a bouncing arrow; Skip always.
- Font: Fredoka (OFL), bundled.

### 2.4 Save

- `SaveFile v1 = { version, createdAt, savedAt, seed, name, day, state }`.
- Autosave each night to slot `auto`; three manual slots; export/import JSON.
- Migrations are an ordered array `[fromVersion → toVersion]`, applied on load.

## 3. Numbers

| Thing | Value | Why |
|---|---|---|
| World unit | 1 store tile = 1 Mini Market floor tile | Kenney pack native scale |
| Day | 12 game hours = 12 real minutes at 1x (1 h = 60 s) | brief |
| Sim tick | 50 ms game time | smooth at 4x, cheap |
| Starter shop | 5 × 4 shop + 5 × 2 storeroom, door front-centre, back door rear | tiny, no empty floor |
| Starting cash | $500 (Standard), $900 (Relaxed), $300 (Hard) | first order + a day of rent |
| Town demand | 48 shoppers/day base × plot traffic × awareness × reputation × events; +75% pool per open rival | balance harness: guided player nets ≈ $75/day in week one |
| Rent | $40 / day, charged at close | ~20% of day-1 revenue |
| Utilities | $6 / day per fridge, $2 per freezer extra | visible cost of chilled goods |
| Wholesale margin | retail ≈ 1.6 × cost at base price | grocers run 25–40% gross |
| Customers/day (day 1) | ≈ 35–45, rising with awareness and reputation | ~1 every 18 s |
| Walking speed | 1.6 units/s | reads natural in the mini scale |
| Car speed | 6 units/s on the road, 2.5 in the lot | |
| Patience | 90–180 s per customer, type-dependent | lines visibly back up |
| Day-1 shelf | 1 shelf (6 facings × 10 units), 1 fridge (4 × 8), 42 units in the storeroom | |
| Fixture prices | shelf $85, produce crate $60, end cap $70, fridge $220, freezer $300, register $280, kiosk $650 | each ≤ 5 days of a guided player's income |
| Shop sizes | 5×4 (start), 7×5 for $900, 9×6 for $2 400; lot doubles for $500 | |
| Staff | cashier ≈ $48/day, stocker $42, cleaner $36, orderer $52, manager $90, +12% payroll tax | |
| Loans | $600 at 1.2%/day over 10 days, $1 800 at 1.0% over 15, $5 000 at 0.9% over 20 | one rescue offered when broke |
| Rivals | Cheapo opens day 3 (prices −14%), Fresh & Fine day 6 (+22%), MegaMart day 10 (expands) | sales every 4–8 days |
| Franchise | $2 800 + a manager from the pool; lighter daily roll | |
| Upgrade cap | any early upgrade ≤ 5 × average daily profit (balance harness asserts) | no grind walls |

### 3.1 Customer scoring (Part 2)

Each customer type weights six store scores (0–1): price vs town average, availability,
clean/layout, wait, parking, awareness. Score → visit probability via softmax across stores.

| Type | price | avail | layout | wait | parking | awareness |
|---|---|---|---|---|---|---|
| Bargain | 0.45 | 0.15 | 0.05 | 0.10 | 0.05 | 0.20 |
| Convenience | 0.10 | 0.20 | 0.10 | 0.30 | 0.20 | 0.10 |
| Loyalist | 0.10 | 0.45 | 0.10 | 0.10 | 0.05 | 0.20 |
| Impulse | 0.15 | 0.15 | 0.35 | 0.10 | 0.05 | 0.20 |

Reputation moves at most ±0.03 per day toward the day's average satisfaction. The player's share of
each type is a softmax (k = 4) over weighted scores against open rivals, who count 0.5 each.

## 4. Art plan

- Source: Kenney CC0 packs (Mini Market, Mini Characters, City Kit Suburban / Commercial /
  Roads, Car Kit, Food Kit, Nature Kit, Furniture Kit). Zips untouched in `third_party/`.
- `tools/convert-assets.ts` extracts the GLBs we use, strips baked products off shelves
  (kept separately as product primitives), applies the per-pack scale from
  `docs/STYLE_GUIDE.md`, quantises, dedups and writes `public/assets/models/*.glb`.
- Own models (same palette, same chunky proportions), generated in `tools/gen-models.ts`:
  sign letters, awnings, product variants, wall ledges, parking paint, lot grass.
- Palette: brand white `#FFFFFF`, fresh green `#3FA87A`, honey wood `#D9A066`, sunny
  yellow `#FFC044`, dark slate `#38383D`, plus the Kenney colormap strips.
- Character variety: 13 base meshes × 4 recoloured colormaps (outfit and hair strips
  permuted; skin strips shuffled) = 52 looks, plus ±8% height.
- `tools/audit-art.ts` checks every shipped GLB: scale within the guide's range, pivot at
  bottom-centre, triangle budget, one material per pack, no missing textures.

## 5. Performance

Budgets: 60 fps starter shop, ≥45 fps busy store at 4x and zoomed-out neighbourhood;
< 250 draw calls; < 15 MB compressed; interactive within 3 s. Means: merged statics,
instancing, one shadow caster set, LOD on characters (static pose when far), no post FX.
