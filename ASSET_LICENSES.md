# Asset licences

Every file shipped under `public/assets` and `public/fonts`, with its source and licence.
Only CC0 and OFL content is allowed; `npm run audit:art` checks that audio files are listed
here.

| Path | Source | Licence | Notes |
|---|---|---|---|
| `public/assets/models/market/*.glb` | Kenney Mini Market 1.0, `third_party/kenney/kenney_mini-market.zip` | CC0 1.0 | rescaled, products split off shelves |
| `public/assets/models/people/*.glb` | Kenney Mini Characters 1.0, `third_party/kenney/kenney_mini-characters.zip` | CC0 1.0 | 14 of 32 clips kept |
| `public/assets/models/suburban/*.glb` | Kenney City Kit Suburban 2.0, `third_party/kenney/kenney_city-kit-suburban_20.zip` | CC0 1.0 | scale ×3 |
| `public/assets/models/commercial/*.glb` | Kenney City Kit Commercial 2.1, `third_party/kenney/kenney_city-kit-commercial_2.1.zip` | CC0 1.0 | scale ×3 |
| `public/assets/models/roads/*.glb` | Kenney City Kit Roads 2.2, `third_party/kenney/kenney_city-kit-roads.zip` | CC0 1.0 | scale ×2 |
| `public/assets/models/cars/*.glb` | Kenney Car Kit 3.1, `third_party/kenney/kenney_car-kit.zip` | CC0 1.0 | scale ×0.55 |
| `public/assets/models/food/*.glb` | Kenney Food Kit 2.0, `third_party/kenney/kenney_food-kit.zip` | CC0 1.0 | scale ×0.5 |
| `public/assets/models/nature/*.glb` | Kenney Nature Kit 2.1, `third_party/kenney/kenney_nature-kit.zip` | CC0 1.0 | scale ×1.4, colours baked to palette |
| `public/assets/models/furniture/*.glb` | Kenney Furniture Kit 2.0, `third_party/kenney/kenney_furniture-kit.zip` | CC0 1.0 | scale ×0.8, colours baked to palette |
| `public/assets/models/generated/*.glb` | `tools/gen-models.ts` (this repository) | CC0 1.0 | sign letters, awnings, product blocks |
| `public/assets/textures/atlas.png` | Kenney colormaps from the packs above + brand palette | CC0 1.0 | packed by `tools/convert-assets.ts` |
| `public/assets/textures/palette.json` | generated | CC0 1.0 | |
| `public/assets/audio/*.ogg` | `tools/gen-audio.ts` (this repository) | CC0 1.0 | synthesised, listed below as they are added |
| `public/fonts/Fredoka-latin.woff2` | Google Fonts, Fredoka (variable, latin subset); full TTF and OFL in `third_party/fredoka/` | SIL OFL 1.1 | |
| `public/fonts/fredoka-bold.typeface.json` | Fredoka Bold (`third_party/fredoka/Fredoka-Bold.ttf`) converted by `tools/gen-font.ts` to three.js typeface glyphs for the 3D shop signs | SIL OFL 1.1 | 71 glyphs; the font is unchanged, only re-encoded |
| `public/brand/logo*.svg`, `public/brand/logo-*.png` | Drawn by `tools/gen-logo.ts` (this repository); lettering is Fredoka Bold converted to outlines | CC0 1.0 (Fredoka glyph outlines under SIL OFL 1.1) | the logo: a shop front, transparent background |

The untouched source zips and their `License.txt` files live in `third_party/kenney/`.
