# Decisions made without you

One line each, newest at the bottom.

- Kenney packs downloaded fine, so all art is Kenney CC0 plus generated pieces in the same style.
- Mini Characters chosen over Blocky Characters: they share Mini Market's exact colormap and proportions, and ship rigged walk/idle/pick-up/holding clips.
- World unit = one Mini Market tile; other packs are rescaled to it (see docs/STYLE_GUIDE.md) rather than the other way round, because the store is what the camera frames.
- Starter shop is 5x4 tiles plus a 5x2 storeroom: small enough that one shelf, one fridge and a register do not leave a big empty floor.
- Playwright pins `executablePath` to the preinstalled Chromium with SwiftShader so screenshots and perf run headless in CI containers without a GPU.
- Sim tick is 50 ms of game time; the renderer interpolates, so 4x stays smooth without a variable-step sim.
- Fredoka is bundled as a latin-only woff2 (30 KB) plus the full variable TTF in third_party for the record.
- Three.js samples the atlas with `flipY = false` and generated geometry uses glTF's v-down UV convention, so one texture serves both converted models and generated pieces.
- Quantised GLB attributes are expanded to Float32 at load; merging and transforming interleaved or normalised attributes was the source of the "missing neighbourhood" and "exploded people" bugs.
- Character variety is done by shifting colormap strips per triangle at load (outfit permutations, three skin tones), not by extra textures: 13 meshes become 52 looks for free.
- The shop name lives on a free-standing pylon sign by the sidewalk; a fascia sign over the door only shows when the camera looks at the back of the store, because a front fascia hid the whole front row of the floor from the default camera.
- Nature Kit greens are remapped to the town's grass greens at conversion (Kenney's are mint), so trees match roofs and lawns.
- Screenshot runs disable CSS animations: headless SwiftShader renders so slowly that fades were caught half-way.
- Kenney's cash register, standing fridge and end cap have their pivot on the front face; the renderer centres them in their tile with a per-type offset rather than editing the packs.
- The checkout line bends toward the shop's centre and every slot snaps to a walkable cell, so lines never run through a wall.
- Finance lives inside the Stats card and franchises inside Build, so the top bar keeps exactly the seven buttons the brief lists (plus a small Hint button for "what should I do next?").
- Staff work whole days; morale, raises and quitting carry the "imperfect staff" feeling without a shift scheduler.
- Rivals are a daily state machine (open, sale, drift, expand) issued through the same tick rather than a full agent replaying player commands; the balance harness checks they neither crush nor ignore the player.
- Franchises are a lighter daily roll with reports and alerts; their town buildings are stock shop fronts with a name board.
- Guided-player income of about $75/day in week one is the balance anchor: fixtures cost at most five days of that, the shop needs restocking daily, and rivals cost a third of trade at most.
- Shortages drop a line from an order instead of rejecting the order; the first version rejected whole orders and starved the shop.
- `cheat` commands only work in sandbox or under a test harness (`navigator.webdriver`), never in normal play.
