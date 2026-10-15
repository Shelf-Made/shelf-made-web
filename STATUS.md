# Shelf Made: status

Build log for the unattended build session (October 14, 2026). Everything below was built from
an empty repository in this session.

## Round: a brighter town, night fixes, reviews and a business profile, more to build (latest)

- [x] **Brighter, happier.** More light (exposure and sky fill up), a cheerful grade after tone
  mapping (vibrance on the duller colours, a touch of warmth, open mid-tones, only a faint vignette),
  lighter asphalt and wall tops (they read near-black from above), and kinder weather: a day with
  nothing forecast is mostly fair or clear, and the first two days are always bright.
- [x] **Normal pace after a fast day.** Ending a day at the fastest speed reset the clock to 1x but
  left the sim's time scale at 4x, so the manager walked at a quarter pace all night (loading a game
  had the same gap). Both now reset together.
- [x] **Building at night.** Clicks and the aim were off at night altogether; the Build tools now work
  before you open tomorrow (nothing else does, the shop is shut).
- [x] **Delivery status.** A wholesale truck shows "On the road" until it has pulled up and is
  unloading; only then "At the back door". Still packing shows minutes or hours.
- [x] **Your business profile.** A storefront button by the speed controls carries a badge with how
  many reviews the shop has (red while some are new) and the rating under it; a toast quotes each new
  review. It opens the shop's listing on a made-up map app, Pinpoint, laid out like the real thing:
  photos across the top, name, stars and count, Open or Closed, Overview (address, hours, website,
  phone, popular times with a live note, the review summary), Reviews (the 5-to-1 histogram, what
  reviews mention, sorting, every review with its author, Local Guide badge, stars, "2 days ago",
  text and photos, likes, and your reply), Photos (filter by food, inside, outside, by owner) and
  Performance (views, searches, directions, calls, and what shoppers notice about how the shop looks).
- [x] **Reviews from the sim.** As shoppers leave, what they noticed is weighed: the wait at the
  till, whether they found their list, prices, the floor, how the shop looks (decor, full shelves,
  room to move, the frontage, extras like a lit sign), who served them, parking, fresh produce, the
  range. A few go home and write about it (the delighted and the cross most), in their own words;
  some attach photos. You can reply (a polite answer to an unhappy one wins a little goodwill), and
  once there are a few reviews the rating pulls on the shop's reputation.
- [x] **Customer photos.** Taken in the town as it stands, at the hour they visited, with a phone's
  look (its own white balance, punchy colour, a vignette, sensor noise, not held level, JPEG): the
  shopfront from across the pavement or the road, the aisles from just inside the door (ceiling
  lights on), a selfie outside holding what they bought, and their shopping on the worktop at home
  next to the shop's bag, with the background out of focus.

- [x] **Night card, plainly.** The money list starts with the day's Profit (or Loss) in large type,
  then sales and each cost below it, then cash. Wordy hints, card notes and card subtitles were cut
  down across the game.
- [x] **More to build, better organised.** The Build card has tabs (Tills, Shelves, Furniture, Decor,
  Walls, Lights, Floors, Shop) with a picture of every piece. New: cushioned benches, café tables,
  a help desk, a trolley bay, litter bins (they keep the floor cleaner), a music speaker, a promo
  screen, a magazine shelf, flower tables, rugs and a doormat (walked over), walls, walls with a
  window, doorways, railings and gates inside the shop, floor lamps, hanging lights, wall lights and
  a neon sign (on an outer wall). Floors: polished concrete, black and white tiles, tiles in your
  colours, wooden boards or white stone. Windows can be put into the side and back walls. Lamps glow
  and pool light on the floor after dark, the neon all the time; interior walls drop to a ledge
  while you are inside, like the shop's own. Everything counts toward how the shop looks, and so
  toward its reviews. Placing never cuts the shop in two: everything must be reachable from the
  front door without going round the outside to the back door.

## Round: day logs, windows, shoppers' hands, lawns, light, weather, town life, rain

- [x] **Day logs.** The night card has a close button (and Esc); a bar at the top brings it back
  and keeps Open tomorrow to hand. A card opened at night takes the log's place instead of opening
  behind it. A complaint's Staff button says "day 3" until Staff opens. Stats lists every day's log
  (the goal and forecast as they stood that night); tap a day to read it again.
- [x] **Crutches gone** from the first female character (they were in her body mesh).
- [x] **Window sills.** A window wall cut down to a ledge is drawn as a plain wall (its frame and
  pane were squashed into a jumble on the sill), and from inside the windows show (the paint used to
  cover them).
- [x] **Shoppers' hands.** At a shelf they look, then reach once as they take the item; at the till
  they put their things down and stand; they carry a red basket while shopping instead of holding
  nothing in both arms; staff stock with a placing motion and bend once for a box.
- [x] **Grass.** No wind; thick short blades over every lawn round the camera, stopping at every
  path, lot and building (a top-down mask of the scene). Fixed on the way: town chunks with a tree
  in them were not drawn at all.
- [x] **Light.** Neutral tone mapping, a warm sun on a real path (golden low mornings and evenings,
  long shadows), cooler sky fill, soft shadows, a sun disc in the sky, a gentle vignette.
- [x] **Weather.** Each day's sky follows its forecast: clear, fair, cloudy, passing showers, grey,
  drizzle, rain, thunderstorms. Clouds close over; the light dims and softens; rain falls (stopping
  on roofs and awnings, never in the shop) with splashes and bouncing droplets; people put up
  umbrellas; storms bring lightning, a flash and thunder; rain patters and the birds go quiet.
- [x] **Rain on the ground.** Roads, pavements and lots darken and shine, puddles form and mirror the
  sky with ripple rings where the drops land; car roofs and awnings catch the sky; it all dries slowly.
- [x] **Town life.** Dog walkers stop for the dog (some bag it, some don't); after school teenagers
  hang about (sometimes outside your shop), smoking and dropping litter, until they leave or you ask
  them to move along; now and then a car bumps another on Main Road and the drivers argue for a few
  minutes. Shoppers pull a face at mess outside your door; you can pick it up; the town is swept
  overnight.

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 106 passed; new: day logs kept and read back, the grass patch, weather (forecast to sky, bounds through the day, lightning pace), town life over a week (dogs, teenagers, bumps, the nightly sweep, moving along, picking up) |
| `npm run e2e` | 19 passed (the first-day journey now has 240 s locally; the phone test waits for the manager to stop walking before measuring); new: the day's log (close, reopen, a card in its place, Staff on day 3, Stats), weather and town-life screenshots |
| Perf (`npm run perf`) | default zoom 107 draw calls / 329k triangles (the lawn's blades are about 130k of that, one draw); busy 127 / 350k; selected 139 / 381k; mid 136 / 374k; overview 174 / 469k (budget 250 / 900k) |
| `npm run balance -- --check` | passed in 404 s with town life: nobody stuck or bust; guided about $94/day in week one |
| Frame time (software GL test browser) | about 0.77 s dry, 0.9 s in rain (0.71 s before this round's town life and rain surfaces; the sky environment map, dropped, had taken it to 1.1 s) |

New screenshots: `42-lawn-up-close` to `49-fender-bender`.

## Follow-up: shelves, backing out, trees, moving furniture

- [x] **A box goes on a shelf with room.** Stocking tops up the product's slots and then takes free
  ones; "That one is full" only when it is, otherwise "No room for Soup there: every spot holds
  something else". The prompt over a shelf says how many will go on.
- [x] **Cars back out like cars.** Straight back until the nose clears the neighbours, then the rear
  swings round on an arc (the heading turns only as the car rolls), easing off and to a stop, a
  moment to change gear, then away. Turning across the oncoming lane waits for a longer gap.
- [x] **Detailed trees** in the same style: branches, faceted leaf clusters lit and shaded, egg
  crowns, poplar columns, a birch, jagged conifers.
- [x] **Move furniture by clicking it.** With empty hands a click on any piece opens a small menu at
  it: its use (Stock, Serve here), Move (it follows the pointer; click to put it down, R turns it,
  Esc puts it back) and Turn (a quarter turn where it stands).

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 96 passed; new: stocking a shelf whose slot for the product is full, backing out of every bay without sliding or touching a neighbour, the trees' size, budget and determinism |
| `npm run e2e` | 16 passed; new: click a shelf, Move it somewhere free (its stock goes with it), Turn it, pick it up and Esc puts it back; the counter's menu serves; a tapped shelf's menu opens Stock |
| `npm run audit:art` | passed |
| `npm run balance -- --check` | passed in 356 s: nobody stuck or bust; guided ≈ $97/day in week one |
| Perf (`npm run perf`) | default zoom 97 draw calls / 140k triangles; busy 113 / 171k; selected 121 / 188k; mid 123 / 197k; overview 162 / 281k (budget 250 / 900k) |

New screenshots: `40-furniture-menu`, `41-moving-a-shelf`.

## Feedback round: first day, controls, the town, your manager

- [x] **Product pictures.** The Stock and Prices cards show each product as it stands on the
  shelves (rendered from the shelf models at load), and "not on a shelf" is gone.
- [x] **A shelf opens Stock.** Empty-handed, clicking a shelf opens the Stock card at the products
  that go on it; carrying a box, it still walks over and stocks it.
- [x] **A gentler tutorial.** One step at a time with a short title and one line, progress dots, and
  a bouncing arrow on the tool to press. The goal chip and the controls card wait until it is over.
- [x] **Camera.** The wheel zooms in proportion to the scroll (far less jumpy on a trackpad);
  click-and-drag pans (one finger on a phone, two fingers twist); walking brings the camera back.
- [x] **Cars ease** into and out of their speed and slow before turning into a lot.
- [x] **Feet move while carrying a box.**
- [x] **Signs and props.** The pylon sign stands on the lawn, not the lane; its flickering post
  faces are gone; no prop stands on the lane or in a post.
- [x] **Zebras** are painted alike on all four arms, slimmer and softer.
- [x] **Shoppers stay inside.** A shelf against the wall is browsed from the room side; nobody
  stands in the wall any more, nor in a corner sealed off behind other fixtures. Counters must face
  into the shop.
- [x] **A greener town.** Textured grass with tufts and wild flowers; every corner has a garden of
  mixed trees (fifteen kinds, different sizes, some dark, some autumn), bushes, flowers and rocks;
  clumps of trees round the edge of town.
- [x] **Continue works mid-day.** Autosave every 30 seconds, after picking a plot, and when the
  tab is hidden or closed (it used to save only at night).
- [x] **Design your manager, in the lobby.** A guy or a girl first (six characters each), then
  skin, hair, top, trousers and height, shown live on the shopkeeper out front; worn in every game
  you start or continue.
- [x] **Texture on every surface.** Pavements show slab joints and grain, roads and lots a speckle of
  aggregate, flat roofs their sheet seams, and walls, kerbs and paint a soft grain, with broad
  weathering that keeps long roads from reading as flat colour from afar. People, cars and products
  stay clean.
- [x] **Traffic never gridlocks.** The eased pull-away is brisk enough to keep the lights flowing,
  only a car turning off the road brakes for its turn, and no through traffic joins a queue that
  already reaches the edge of town (a busy day used to pile up hundreds of cars late in a game). Cars
  brake steadily up to a queue or a red light instead of snapping to a stop, and never roll past a red.
- [x] **Deploys.** Every model and texture fetch carries the build id, so Vercel can cache them for
  good while each deploy still loads its own; the page itself is never cached stale. CI gives the
  long screenshot run enough time on its slower runners.

Checks on the latest run:

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 92 passed; new: a shelf against the wall shopped from inside (and a counter facing the wall refused), nobody sent into a corner sealed off behind a fridge, designing the manager (and the look surviving a save), every parked car seen nose-in |
| `npm run e2e` | 15 passed in 7.7 min: the coach's first step, a shelf tapped on a phone opens Stock with pictures, designing a guy in the lobby and finding him again after closing the tab mid-day (Continue), plus all earlier flows |
| `npm run audit:art` | passed |
| `npm run balance -- --check` | passed in 316 s: nobody stuck in any strategy (a forty-day run used to rescue a boxed-in manager 24 times and pile up over 400 cars); rivals take 18% of a guided player's week one; Cheapo price-matches the undercutter on day 6–7, its gap 6–7 → 2 points; guided ≈ $100/day in week one; goal 5 on day 14 on every seed |
| Perf (`npm run perf`) | default zoom 104 draw calls / 158k triangles; busy 118 / 194k; someone selected 129 / 214k; mid zoom 130 / 217k; overview 169 / 303k (budget 250 / 900k). The gardens and grass tufts add about 30k triangles at the default zoom. The surface detail costs three texture reads a pixel. |

New screenshots: `35-tutorial-coach`, `36-stock-pictures`, `37-manager-designer`,
`38-town-trees`, `39-lawn-close`.

## Rivals answer back, and click anyone to see why

- [x] **Rivals react to you.** Each night every rival reads your last three days (prices, which
  shoppers you are winning, reputation) and at most one of them makes a move the next day, with a
  rumour the night before and a notice on the day. Cheapo price-matches ("WE MATCH ANY PRICE!"
  for a week) when you undercut it or bargain hunters drift your way. Fresh & Fine closes two days
  behind scaffolding to renovate when your reputation outshines it (then reopens better for two
  weeks), holds a free tasting day when impulse buyers come to you, and starts a loyalty card when
  loyalists do. MegaMart answers a bigger share than its own with a mega sale, a poster on a free
  billboard (which you then cannot rent) or longer hours. Every move has a cooldown, fades over its
  last three days, and draws only on the rivals' random stream. The full table is in
  `docs/DESIGN.md` §3.3.
- [x] **Click a person.** A yellow outline and a small panel beside them: name, shopper type with
  its icon, mood (face and word), what they are doing, their list with ticks and crosses, basket
  against budget, patience, and "Came here because…" or "Shopped at Cheapo because…" with the two
  reasons that weighed most, in plain words. Staff show role, skill, morale and wage, with a
  shortcut to the Staff card. Follow keeps the camera on them until they leave town; Esc closes it
  all and brings the camera back. On a phone a tap opens it docked above the tool shelf.
- [x] **Each type looks a little different.** Bargain hunters carry a reusable tote, impulse
  buyers a packet of sweets (and are shorter), convenience shoppers walk faster in work clothes,
  loyalists have silver hair.
- [x] **Who shops where.** A table on the Stats card: today's shoppers by type at your shop and
  each rival's. A row puts a marker over every shopper of that type in town for ten seconds.
- [x] **Save version 12** with a migration.
- [x] **Fixes found on the way.** Building can no longer seal the delivery pallet into a pocket
  (a balance run boxed its manager in with it), and cars entering a lot give way to cars leaving.

Checks on the latest run:

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 89 passed; new: Cheapo's price match on undercutting and on bargain drift, then its cooldown; Fresh & Fine's renovation (closed two days, reopens better); MegaMart's moves and its billboard not for rent; at most one move a day and only the rivals stream drawn on; moves fading and dropping off; the two reasons for each type; reasons stored at spawn and worded by the panel; who shops where; the v11 → v12 migration; the pallet pocket |
| `npm run e2e` | 12 passed; new: click a customer, read the panel (name, type, mood, list, two reasons, text ≥ 14 px), Follow until the camera sits on them, Esc closes it and the camera comes back; on a phone a tap opens the panel docked above the tool shelf with thumb-sized buttons; screenshots of a price match, a renovation, a rival shopper's panel and the Who shops where table |
| `npm run audit:art` | passed |
| `npm run balance -- --check` | passed in 272 s: nobody stuck in any strategy; rivals take 18% of a guided player's week one with reactions on (limit: a third); the undercutter makes Cheapo price-match on day 6 on every seed, closing Cheapo's price gap over it from 6–7 points to 2; guided ≈ $100/day in week one; goal 5 by days 14–15 |
| Perf (`npm run perf`) | default zoom 99 draw calls / 129k triangles; busy 113 / 168k; someone selected and followed 87 / 142k (the outline is one draw); mid zoom 120 / 176k; overview 160 / 255k (budget 250 / 900k) |

New screenshots: `31-cheapo-price-match`, `32-fresh-renovation`, `33-inspect-rival-shopper`,
`34-who-shops-where`.

Still open from this round:
- The undercutter's advantage is cut to about a third within the week, not to nothing: Cheapo
  matches 5% and you stay a little cheaper. Say if the match should go all the way.

## Goals, closing rivals and the night card

- [x] **A goal ladder.** Seven goals, one at a time, as a chip under the top bar; a click opens
  the ladder in Stats (done with the day, the active one with its progress, those to come).
  Rewards: cash, lit sign letters, opening-day events, branches out of town, and the Crossroads
  Champion ending (play carries on as a sandbox). Reaching one throws confetti and the reward
  over play without pausing it.
- [x] **Rivals can close.** Daily books (shoppers × basket × margin, less fixed costs); five
  closing nights in the red and the sign comes down, a "For sale" board goes up and the shoppers
  spread over the rest. One closed at a time; ten days unsold and a challenger (sky blue) moves in.
- [x] **Buy the corner.** A closed rival's corner is for sale on the Build card; bought, it trades
  as your branch in your colours and under your name, its shoppers carrying your bags.
- [x] **A better night card.** Green for a profit, red (and ▼) for a loss; goods, rent and power,
  staff, loans and shoplifting with small bars so the biggest cost stands out; the top three
  complaints in plain words ("Out of milk ×12"), each opening the card that fixes it; the
  crossroads' shares in each store's colour with the change since yesterday (closed rivals grey);
  the goal's progress and today's change; tomorrow's weather, festivals and rumours ("Cheapo is
  printing flyers..."), rolled at close and applied in the morning.
- [x] **Money strings.** One sign-correct formatter in the sim ("-$140", never "$-140").
- [x] **Save version 11** with a migration that ticks off goals the history shows.
- [x] **Traffic fix.** Forty-day runs found MegaMart's double lot gridlocking on busy days; a
  last-resort jam breaker keeps it moving.

Checks on the latest run:

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 79 passed; new: every goal's check, a rival closing after five broke nights (one at a time), the corner for sale only once closed and bought as a branch, a challenger after ten days, complaint counts matching the day's misses, walk-outs and turned-away drivers, tomorrow's preview matching the next day over 16 days, the money formatter, the v10 → v11 migration |
| `npm run e2e` | 9 passed; new screenshots of the goal chip, the ladder, a profitable and a loss night card, a corner for sale and a bought corner |
| `npm run audit:art` | passed |
| `npm run balance -- --check` | passed in 244 s (parallel): nobody sensible goes bust, nobody stuck; guided ≈ $94/day in week one; the guided player reaches goal 5 by days 12–24 (every seed by day 25); it closes Cheapo on days 20–24 (Fresh & Fine once, day 37); MegaMart never closes in 40 days; no rival closes before day 12 in any strategy |
| Perf (`npm run perf`) | default zoom 99 draw calls / 129k triangles; busy 119 / 163k; mid zoom 124 / 178k; overview 162 / 256k (budget 250 / 900k) |

New screenshots: `25-goal-chip`, `26-goals-ladder`, `27-night-card-profit`, `28-night-card-loss`,
`29-corner-for-sale`, `30-corner-bought`.

Still open from this round:
- Goal targets 4 and 5 were tuned down from the brief's first pass ($150 → $120; 40% for seven
  days → a third over a week); see DECISIONS.md. Say if you want them harder.
- A bought corner is a branch with a visible building, not a second shop to walk into.

## Toy-town art pass

- [x] **A warm shop.** Cream checker lino, walls banded in the shop's colour with skirting and a
  rail, painted wood shelves, cream counters, pale blue chillers, warm light. The default zoom has
  no large grey surfaces left.
- [x] **Colour schemes.** Six to pick from beside the shop's name (Fresh green, Berry, Tangerine,
  Plum, Teal, Cocoa); the scheme paints the awning, fascia, pylon, inner walls, staff aprons and
  the logo. Rivals keep their own: Cheapo yellow and red, Fresh & Fine deep green and cream,
  MegaMart blue and white, on storefronts, signs, staff and lot paint. Save version 10.
- [x] **Coloured bags.** Everyone leaving a till carries one to three bags in the store's colour at the hand,
  rivals' shoppers too; drivers load them into the boot. From the overview, the bag colours on
  the pavements show who is winning.
- [x] **Light and time of day.** Low warm sun in the morning, orange in the evening; at dusk the
  windows, fascias and lamps glow and spill light onto the pavement. A mild bloom on what glows and
  a tilt-shift at the far zoom (off on Low).
- [x] **Shadows.** Blob contact shadows under people, cars and fixtures.
- [x] **Street dressing.** Benches, bins, recycling, bikes in racks, planters, hydrants, sandwich
  boards, pallets of crates, a trolley shelter, a stray trolley, window posters (sale posters
  during a rival's sale) and bunting on opening days. More of it as the shop grows; none of it on
  a path or a bay.
- [x] **Reactions.** Bubbles over shoppers' heads from what happens in the sim: too pricey, out of
  stock, long queue, great deal, love this place; at most four at once.
- [x] **Street life.** Joggers, parents with a child, drivers loading bags.

Checks on the latest run:

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 65 passed; new: a bag's colour is its store's, player schemes stay clear of rival colours, the scheme survives a save and old saves become Fresh green, props never stand on a path, the paving or a bay on any corner or shop size |
| `npm run e2e` | 8 passed, 24 screenshots |
| `npm run audit:art` | passed, with the new generated pieces (bag, hydrant, recycling, bike rack, sandwich board, pallet, trolley shelter, poster, bunting) |
| `npm run balance -- --check` | passed: nobody sensible goes bust, nobody stuck; guided ≈ $63/day in week one; rivals take 24% of a guided player's trade over week one |
| Perf (`npm run perf`) | default zoom 97 draw calls / 136k triangles; busy at 4x 118 / 170k; mid zoom 122 / 186k; full overview 156 / 254k, post passes included (budget 250 / 900k) |

New screenshots: `22-reactions-queue`, `23-bags-cheapo-sale`, `24-dusk-glow`; `02-plot-picker`
shows the scheme swatches, `06-close-shop` the new shop at default zoom.

Still open from this round:
- The bloom and tilt-shift were tuned in SwiftShader; they want a look on a real GPU.

## Follow camera and the crossroads

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
- The rival buildings are plain boxes with window panes (dressed and coloured in the art pass).

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
- Rival AI is a small state machine (sales, expansion, drift, books, and since Brief 5 one move at a time in answer to the player), not a full copy of the player's command set.
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
0. **Week-one income.** Resolved: the harness's guided player now reorders when the pallet runs low
   and stocks new lines, and makes ≈ $94/day in week one.
1. **Vercel permission.** Project creation is refused (403) for the Startups team; create the project from the repo in the Vercel dashboard or grant the permission.
2. **Prices and pace.** A guided player nets about $75/day in week one and buys a shelf every day or two; say if you want it tighter or looser, and the harness will hold the line.
3. **Fonts and brand.** The wordmark underline is CSS in the lobby and a green bar on the pylon sign; if you have a real logo file it drops into `TopBar.tsx` and `StoreView.ts`.

## Next steps
1. Fix GitHub access, push the branch, watch the CI run (it installs Playwright Chromium and runs everything in this table).
2. Play it on a real GPU for twenty minutes: tune audio levels, the first-day pace, and the camera limits by feel; record `npm run perf` on a laptop.
3. Deepen the two thinnest systems: staff shifts (morning/evening, part-time) and a real second floor for franchises (reuse the store renderer with a lighter tick).
