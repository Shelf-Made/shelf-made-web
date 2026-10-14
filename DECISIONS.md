# Decisions made without you

One line each, newest at the bottom.

- Kenney packs downloaded fine, so all art is Kenney CC0 plus generated pieces in the same style.
- Mini Characters chosen over Blocky Characters: they share Mini Market's exact colormap and proportions, and ship rigged walk/idle/pick-up/holding clips.
- World unit = one Mini Market tile; other packs are rescaled to it (see docs/STYLE_GUIDE.md) rather than the other way round, because the store is what the camera frames.
- Starter shop is 5x4 tiles plus a 5x2 storeroom: small enough that one shelf, one fridge and a register do not leave a big empty floor.
- Playwright pins `executablePath` to the preinstalled Chromium with SwiftShader so screenshots and perf run headless in CI containers without a GPU.
- Sim tick is 50 ms of game time; the renderer interpolates, so 4x stays smooth without a variable-step sim.
- Fredoka is bundled as a latin-only woff2 (30 KB) plus the full variable TTF in third_party for the record.
