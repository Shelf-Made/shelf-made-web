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
- **Weather** (`weather.ts`): each day has a sky kind (clear, heat, fair, cloudy, showers, grey,
  drizzle, rain, storm) decided with tomorrow's plan from its forecast; a heavy-rain forecast is a
  thunderstorm about half the time, a grey one often drizzle (a hash of seed and day, so no random
  stream moves). How cloud, rain, storm, mist and wind go through the day, and when lightning strikes,
  are pure functions of seed, day and time: only the day's kind is saved.
- **Town life** (`life.ts`, its own random stream): dog walkers stop while the dog squats (most
  owners bag it); after school a group of teenagers hangs about at the bus stop, a rival's door or
  outside your shop, smoking and dropping cans, wrappers and cigarette ends until they leave or the
  manager asks them to move along; now and then a car still rolling bumps a stopped one on Main Road,
  both hold with their hazards on and the drivers argue on the pavement for a few minutes of game
  time (shorter than the eight seconds after which a queue starts to creep). Mess on your frontage
  costs a little cleanliness, makes passing shoppers pull a face (a dog's mess sometimes counts as a
  "messy" complaint) and can be picked up; the town is swept every night.
- **Day logs**: each night's goal progress and forecast are kept with that day's stats, so every
  night card can be read again in Stats.

### 2.2 Render

- Plain three.js (`WebGLRenderer`, sRGB output, PCF shadow map 2048 from one sun, distance fog).
- **Follow camera.** A narrow lens (FOV 30) looking down at the manager from behind and above
  (`FollowCamera`: pitch 52° by default, 35–70° by right-drag; 12 units back by default, 7 to 68 on
  the wheel, + / −, or a pinch). The wheel zooms in proportion to how far it scrolls (a trackpad
  flick is a nudge, a mouse notch about 12%). A left-drag (one finger on a phone) grabs the ground
  and pans; a two-finger twist turns. Walking again (WASD or a click) brings the camera back to the
  manager. Past 30 units it lets go and pans freely (WASD, optional screen-edge pan), drifting toward
  the middle of the crossroads as you pull out, and C brings it back. Q / E turn it in 45° steps. A
  docked card pushes the manager to the middle of the world you can still see, and opening Build
  pulls back until the whole floor fits beside the card. No pointer lock.
- **Moving and using.** WASD walks the manager relative to the camera (a `moveDir` command; the
  manager walks in real time at any clock speed). A click or tap on the floor walks there; on a
  fixture, the pallet or a spill it walks over and uses it (a shelf is reached from whichever free
  side is nearest). Empty-handed, a click on a shelf opens the Stock card at the products that go on
  it; carrying a box, it stocks the shelf. F uses the nearest usable thing within 1.2 in front of the manager, Space scans
  behind a counter. What F or a click would do is outlined on the floor in yellow, with the key and
  the action in a label over it. In Build the ghost sits on the tile under the mouse or the tap.
- **The crossroads.** One intersection on an empty, level plain: Main Road east–west and Elm Street
  north–south, a shop on each corner, zebras on all four arms, a timed light. There is nothing
  beyond the corners: both roads run on into the haze, so the traffic drives in out of nowhere and
  away into nothing. The ground is one flat mesh, mottled lawn over the town fading to even green;
  grass and flowers on the verges are merged into one still mesh. Characters are skinned meshes
  with Kenney's own clips, head and body merged into one draw; nobody casts a shadow-map shadow
  (a soft instanced blob under every person and car instead), and from far off people become
  instanced stand-ins.
- The shop: a concrete slab, Kenney walls standing outside the floor rectangle, the name in
  Fredoka letters on a fascia and a pylon. With the manager inside, the roof comes off and the walls
  between the camera and the manager drop to stubs; from outside and zoomed out the shop wears its
  roof. A rival's building that hides the manager drops to stubs the same way.
- Stock is Kenney Food Kit and Mini Market models, scaled uniformly to fit each slot box measured
  from the fixture, front rows first, so nothing clips into shelves or neighbours. The same models
  are rendered once at load into small pictures for the Stock and Prices cards (and the characters
  into portraits for the manager designer), so a card shows exactly what goes on the shelf.
- **Land.** The ground carries a tileable grass texture (blades, clover, soft patches; drawn on a
  canvas at load) over its mottled greens. Every corner has a garden from one pure function
  (`cornerGarden`): a mix of fifteen tree kinds (round, oak, conifer, tall, darker and autumn ones)
  at different sizes, bushes, flower patches, rocks, and grass tufts all over the lawn in one swaying
  mesh, never on paving, a path, a bay or a prop. Clumps of mixed trees stand round the corners'
  outer edges; past the edge of town only the roads run on. The zebras are painted, all four alike.
- **Trees** are our own, generated at load in the same faceted style and palette and standing in for
  Kenney's tree models under their ids (`trees.ts`): a tapered trunk with a root flare and bark in two
  browns, branches out to a crown of overlapping faceted leaf clusters (sunlit faces lighter, the
  undersides darker), egg-shaped round crowns, columns of poplars, a white birch with dark marks, and
  conifers of six jagged tiers. 140–700 triangles each, seeded, the same every load.
- **Traffic feel.** Cars ease toward the speed they want (pulling away at 5 units/s², braking at
  12), and a car turning off the road slows before its bend rather than in it, so turning into a lot
  reads as easing off and rolling in. Coming up to a queue or a red light a car brakes steadily
  (a square-root profile, about 6–10 units/s² from road speed) rather than snapping to a stop at the
  last moment, never passes a stop line that holds it, and on amber goes on through only if it is too
  close to stop. Through traffic (and a turned-away car, which is only for show)
  does not join a queue that already reaches the edge of town, so the busiest day's jam drains.
- **Backing out** is worked out on the rear axle, like a real car: straight back about half a car
  length until the nose clears the cars either side, then steering so the rear swings away from the
  exit, the heading turning only as the car rolls. It eases off the mark, slows to a stop across the
  aisle, takes a moment to change gear and pulls away to finish the turn. A car turning across the
  oncoming lane keeps checking for a gap until its nose is in that lane.
- **Lawn.** Short blades over every lawn round the camera's focus: one instanced draw of a unit
  patch (100 blades, darker at the root) over a 36×36 ring of cells that snaps to whole cells,
  turning and mirroring cell by cell. Where it may grow is a top-down render of the static scene
  (drawn again only when the town, the shop's lot or a rival's corner changes); the same texture holds
  the height of whatever is built, which the rain uses. Off on Low quality.
- **Light.** Khronos Neutral tone mapping; a strong warm sun with soft PCF shadows on a real path
  through the day (about 20° at opening, high after noon, a few degrees at closing), a hemisphere fill
  of sky above and grass below, and a sun disc and halo on the sky dome. No environment map (it doubled
  the cost of a frame); the sky's colours and the sun are shared uniforms for whatever reflects the
  sky. Bloom only crosses the threshold for lights; a soft vignette finishes the frame.
- **Weather you see.** A procedural cloud deck in the sky dome thickens and darkens with the day's
  weather, and the light dims, loses its shadows under a full overcast and hazes over in rain. Rain
  falls as camera-facing streaks round the focus, slanted by the wind, stopping on whatever is built
  (roofs, awnings, benches) and never inside the shop; splashes ring and droplets bounce where it
  lands. Roads, pavements and lots soak: darker and glossier, with puddles (broad smooth noise, never
  the whole road) that mirror the sky with Fresnel and carry procedural ripple rings; they dry slowly.
  People out in it put up umbrellas. A storm brings lightning: a forked bolt that flickers, the whole
  scene flashed blue-white, and thunder later the further away the strike. Rain sounds like a patter
  of drops; birds go quiet.
- **Town life you see**: litter on the pavements, smoke curling up from the teenagers' cigarettes,
  hazard lights blinking on two bumped cars, drivers shaking their heads at each other.
- **Surfaces.** Nothing in the town is flat colour. The world material samples a small tileable
  noise texture in world space along each surface's main axis (no UVs needed, three texture reads a
  pixel) and decides by colour what a surface is: light greys are concrete (grain and slab joints a tile apart), dark greys are asphalt (grain and
  specks of aggregate), mid greys up on the roofline are roofing sheets with seams, everything else a
  soft grain, with broad weathering a few tiles across. People, cars and products keep a clean
  material so they read crisply against it.

### 2.3 UI

- Top bar only: logo, money (ticks up), day + clock, Stock / Prices / Build / Staff /
  Marketing / Stats / Settings with labels, speed buttons. Locked systems show "New!" when
  they unlock. Everything else is a card that closes with Esc and never covers the store
  (cards dock to the right third of the screen).
- Play HUD: the yellow outline and key label on whatever F or a click would act on (no crosshair),
  a small controls card bottom left, and a Use button bottom right that mirrors the label.
- **Tutorial as a coach.** One step at a time: "Step 3 of 8", a short title and one line of what to
  do, dots for progress, and the tool it means pulses on the shelf with a bouncing arrow. While it
  runs the goal chip and the controls card stay hidden, so the first screen has one thing to read.
  Skip always.
- **Design your manager** (in the lobby, "Your manager"): a guy or a girl, one of six characters
  each from portraits, then skin, hair, top and trousers from swatches (every colour from the baked palette; "Own" keeps
  the character's), and a height. The demo shop's shopkeeper steps out front and the camera comes in
  close; every click shows at once. The design is kept with your settings and worn in every game,
  new or continued.
- Lobby: a shop front (striped awning, the manager's head as the logo, the name with the shelf
  bracket, a price-tag beta badge, menu items as shelf-edge labels under a swinging OPEN sign, an
  LED ticker) over a live demo shop at golden hour.
- **Furniture menu.** Click or tap a piece of furniture with empty hands and a small menu pops up
  above it: what it is for (Stock on shelves and fridges, Serve here at a counter), Move and Turn.
  Move picks it up: a ghost follows the pointer, a click puts it down (stock and all), R turns it
  and Esc puts it back. Turn gives it a quarter turn where it stands. Carrying a box, a click on a
  shelf still stocks it, and F in front of a piece still does its job directly.
- Inspect: click or tap anyone but the manager and a small panel opens beside them (docked at the
  bottom on a phone) with a yellow outline round them: name, type icon, mood face and word, what
  they are doing, their list with ticks and crosses, basket against budget, patience, and "Came
  here because…" / "Shopped at Cheapo because…" with two reasons. Staff show role, skill, morale
  and wage, with a shortcut to the Staff card. Follow keeps the camera on them until they leave
  the world, Esc or the focus key. Icons differ in shape as well as colour (tag, clock, heart,
  star; smile, straight mouth, frown). Nothing is computed while nobody is selected.
- Stats card, "Who shops where": today's shoppers so far by type at each store (yours counted as
  they set out, the rivals' modelled day scaled by the hour). A row marks every shopper of that
  type in town for ten seconds.
- **Build card**: tabs Tills / Shelves / Furniture / Decor / Walls / Lights / Floors / Shop, each a
  grid of pictures (rendered at load from the pieces' own models) with name and price; the tooltip
  says what a piece is for. Undo, redo and the view overlays sit in one row above. Floors and Shop
  are lists (a swatch per floor finish; sizes, the car park, windows per wall, the sign, corners).
- **Business profile** (the storefront button by the speed controls, badge = review count, red
  while some are unread; the rating under it). The shop's listing on a made-up map app, Pinpoint,
  in that app's own look (white, Roboto/Arial, teal accents, yellow stars), docked like a card:
  photos, the title block, tabs Overview / Reviews / Photos / Performance, a photo lightbox.
  Owners reply to reviews from suggested answers or their own words. No real company's name or
  marks anywhere.
- **Customer photos** are rendered from the live scene by the renderer between frames (one a frame
  while the profile is open, otherwise one every few seconds), finished in 2D like a phone photo
  and kept as JPEG data URLs in memory, never in saves: a loaded game retakes them from the town as
  it is. The profile's own two pictures are retaken each day and after a refit.
- Font: Fredoka (OFL), bundled.

### 2.4 Save

- `SaveFile v1 = { version, createdAt, savedAt, seed, name, day, state }`.
- Autosave to slot `auto` every night, every 30 seconds of play, after picking a plot, and whenever
  the page is hidden or closed, so Continue always picks up where you left off; three manual slots;
  export/import JSON.
- Migrations are an ordered array `[fromVersion → toVersion]`, applied on load.

## 3. Numbers

| Thing | Value | Why |
|---|---|---|
| World unit | 1 store tile = 1 Mini Market floor tile | Kenney pack native scale |
| Day | 12 game hours = 12 real minutes at 1x (1 h = 60 s) | brief |
| Sim tick | 50 ms game time | smooth at 4x, cheap |
| Starter shop | a bare 5 × 6 room, door front-centre, back door rear, a 2 × 1 delivery pallet inside it | the player furnishes it |
| Starting cash | $800 (Standard), $1 200 (Relaxed), $600 (Hard) | a counter, two shelves, a chiller and a first order, with ≈ $136 left |
| Town demand | 48 shoppers/day base × plot traffic × awareness × reputation × events; +75% pool per open rival; +5% a day as the town grows (up to 2.2×) | balance harness: guided player nets ≈ $94/day in week one |
| Rent | $40 / day, charged at close | ~20% of day-1 revenue |
| Utilities | $6 / day per fridge, $2 per freezer extra | visible cost of chilled goods |
| Wholesale margin | retail ≈ 1.6 × cost at base price | grocers run 25–40% gross |
| Customers/day (day 1) | ≈ 35–45, rising with awareness and reputation | ~1 every 18 s |
| Walking speed | 1.6 units/s | reads natural in the mini scale |
| Car speed | 6 units/s on the road, 2.5 in the lot | |
| Patience | 90–180 s per customer, type-dependent | lines visibly back up |
| Day-1 fit-out | counter $180, two shelves (4 slots × 8), a chiller $200 (4 × 6), first order ≈ $120 | balance harness pays for it |
| Fixture prices | shelf $85, produce stand $60, end cap $70, chiller $200, tall fridge $300, counter $180, kiosk $650 | each ≤ 5 days of a guided player's income |
| Shop sizes | 5×6 (start), 7×7 for $900, 9×8 for $2 400; lot doubles for $500 | |
| Town | one crossroads: Main Road on z = 2.5, Elm Street on x = 0, a 20.6 × 14.15 lot on each corner (fits the largest shop with the doubled lot), south corners turned half round; nothing beyond the corners | tests assert lots never overlap or touch a road, and only roads run on past the town |
| Traffic | spawns and leaves at ±90 down both roads, in the haze; a 36 s light with an all-walk phase; keeps a 2-unit gap, backs out of lot bays, pulls in and out of three Elm Street bays 3.4 apart; a parked car whose driver has gone drives off | tests: no overlaps at rush hour, nobody runs a red, turned-away cars never stuck |
| Staff | cashier ≈ $48/day, stocker $42, cleaner $36, orderer $52, manager $90, +12% payroll tax | |
| Loans | $600 at 1.2%/day over 10 days, $1 800 at 1.0% over 15, $5 000 at 0.9% over 20 | one rescue offered when broke |
| Rivals | Cheapo opens day 3 (prices −14%), Fresh & Fine day 6 (+22%), MegaMart day 10 (expands) | sales every 4–8 days |
| Franchise | $2 800 + a manager from the pool; lighter daily roll; unlocked by the Market hall goal | |
| Rival books | daily: shoppers × basket × margin − fixed costs × town growth (+$40 a day per MegaMart branch off the map); a sale halves the margin. Cheapo $3.60 × 22% − $45, Fresh & Fine $5.40 × 32% − $80, MegaMart $4.60 × 26% − $95; starting cash $600 / $900 / $2 500 | balance harness: a guided player closes Cheapo in weeks 3–4, MegaMart never in 40 days, nobody before day 12 |
| Closing | five closing nights in a row in the red; one rival closed at a time; the corner sells for $4 500 (Cheapo's), $5 500 (Fresh & Fine's), $9 000 (MegaMart's) plus a manager; ten days unsold and a challenger moves in | |
| Upgrade cap | any early upgrade ≤ 5 × average daily profit (balance harness asserts) | no grind walls |

### 3.1 Goals

One goal is active at a time; the chip under the top bar shows it, the Stats card shows the ladder.
Goals that can happen mid-day are checked every second; the rest at close. The balance harness's
guided player follows them for 40 days and must reach goal 5 by day 25 on every seed (it does by
days 12–24).

| # | Goal | Target | Reward |
|---|---|---|---|
| 1 | Open your doors | Serve 30 customers in one day | $100 |
| 2 | Regulars | Reputation 60% | Lit sign letters |
| 3 | Beat the discounter | Out-sell Cheapo 3 closing nights running (a closed Cheapo counts as beaten) | $250 |
| 4 | Neighbourhood grocer | The 7×7 shop and a $120 night | Opening-day events (bunting and a crowd, $120) |
| 5 | Busiest corner | A third of the crossroads' shoppers over the last week (seven closes with at least two rivals trading) | $500 |
| 6 | Market hall | The 9×8 hall with the doubled lot | Branches out of town |
| 7 | Own the crossroads | Buy a closed rival's corner | Crossroads Champion ending; play carries on as a sandbox |

The crossroads share counts every store's shoppers on one scale: the player's arrivals (less
drivers turned away from a full lot) against each rival's modelled shoppers (the town pool by
customer type, the corner's traffic and mix, the same softmax share, awareness and reputation,
and the same arrivals-per-expected factor the player's spawner runs at).

### 3.2 Customer scoring (Part 2)

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

### 3.3 Rivals answer the player

Each night every open rival reads the player's last three closes (price index, share of each
customer type, reputation; kept on the day as `mine`) and the crossroads' shoppers. A rival whose
trigger holds and whose cooldowns have run out is ready; of the ready rivals at most one moves per
day, picked on the `rivals` stream. A rumour goes out the night before, a notice and a popup on
the day, and the move shows on the corner: a banner on two poles facing the road, scaffolding, or
MegaMart's poster on a billboard. Effects are added to the rival's scores (the scoring weights and
the softmax are unchanged) at full strength, then fade over the move's last three days.

| Rival | Trigger (last 3 closes) | Move | Lasts | Effect on its scores | Same move again after |
|---|---|---|---|---|---|
| Cheapo | your average price index more than 1 point under Cheapo's, or bargain hunters' share of you up 4 points | Price match: "WE MATCH ANY PRICE!" | 7 days | prices 5% lower, sales 4 points deeper, awareness +0.04 | 10 days |
| Fresh & Fine | your reputation 5 points above its own | Renovation: closed behind scaffolding, "CLOSED FOR A REFIT" | 2 days, then 14 days renovated | renovated: quality +0.08, service +0.06 | 24 days |
| Fresh & Fine | impulse buyers' share of you up 3 points | Tasting day: "FREE TASTING TODAY" | 1 day | awareness +0.2 | 7 days |
| Fresh & Fine | loyalists' share of you up 3 points | Loyalty card: "LOYALTY CARDS HERE" | 10 days | availability +0.08 | 14 days |
| MegaMart | your share of the crossroads above MegaMart's | Mega sale (if not on sale): "MEGA SALE" | 2 days | sale 7 points deeper, awareness +0.1 | 10 days |
| MegaMart | the same | Billboard (a free site; you cannot rent it while it holds it) | 10 days | awareness +0.08 | 14 days |
| MegaMart | the same | Long hours: "OPEN LATE" | 10 days | service +0.1 | 14 days |

Any rival rests 4 days between two of its own moves. The balance harness's undercutter (the
guided player with every price 20% under the town's from day 4) sees Cheapo price-match on day 6
on every seed, closing Cheapo's price gap over it from 6–7 points to 2 within the week.

### 3.4 Why a shopper chose a store

When a shopper sets out (for the player's shop or a rival's), the sim stores the top two of
weight × score for their type and the store they picked (ties go in column order: price,
availability, layout, wait, parking, awareness). The inspect panel turns them into words:
"Cheapest milk in town", "Always has my brands", "In and out fast", "Easy to park" (or "Close to
home" on foot), "Saw their ads everywhere". Each type has a look as well as an icon: bargain
hunters carry a reusable bag, impulse buyers a snack and are a little shorter, convenience
shoppers walk 12% faster in work clothes, loyalists' hair is silver.

### 3.5 Reviews

A shopper leaving (served, walked out, or gave up) is judged on their own stream (`reviews`), each
topic -1..1: wait at the till, stock (found the list), price (price index, more for bargain
hunters), clean floor, looks, the frontage, who served them, parking (drivers), fresh produce, the
range. Overall = 0.54 + 0.16 wait + 0.15 stock + 0.15 looks + 0.09 price + 0.07 clean + 0.06
outside + 0.04 staff + 0.04 range + 0.03 parking + 0.03 fresh + noise (sd 0.07); stars at 0.8 /
0.67 / 0.53 / 0.38. Chance to write: 4.5% served (+5% at five stars, +8% at two or fewer), 10% if
they left unhappy. Posted 20–200 game minutes later (the rest at night).

Looks (0..1) = 0.3 decor (plants, signs, benches, baskets) + 0.16 tidy + 0.18 full shelves + 0.1
room to move (a fifth to a half of the floor used) + 0.14 frontage + 0.12 extras (lit sign, bigger
shop, bigger lot, produce stand). A full, clean shop with no decor rates about 3.8, a little decor
4.1–4.3, a messy bare one under 3.

With five or more reviews, the nightly reputation drift aims at 0.75 satisfaction + 0.25 rating
(as 0..1). Replying to a review of three stars or fewer adds 0.004 reputation, once.

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
< 250 draw calls and < 900k triangles; < 15 MB compressed; interactive within 3 s. Means: merged
statics, instancing, shadow-map shadows only for buildings and fixtures (blob shadows for people and
cars), one draw per character, instanced stand-ins for far people, people out of view skipped, no
post FX. Measured (`npm run perf`): 79–107 draw calls and 126k–157k triangles from the shelves out
to mid zoom, 130 and 233k at the full overview (the valley map before it: 131–217 and 494k–790k).
