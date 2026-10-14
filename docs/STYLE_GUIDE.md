# Shelf Made style guide

Measured from the Kenney packs in `third_party/kenney` (see `tools/inspect-glb.mjs`) and
enforced by `npm run audit:art` on everything in `public/assets/models`.

## Scale

**1 world unit = 1 Mini Market floor tile.** Everything else is rescaled at conversion time
so a mini character (0.72 tall) reads right next to every object.

| Pack | Native | Scale | Shipped size (typical) |
|---|---|---|---|
| Mini Market | wall 1 × 1 × 0.6, shelf 0.8 × 0.85 × 0.7, register 0.85 × 0.6 | 1.0 | as native |
| Mini Characters | 0.66–0.78 tall | 1.0 | 0.72 tall (±8% at runtime) |
| City Kit Suburban | house 1.3 × 0.83 × 1.0 | 3.0 | house 3.9 × 2.5 × 3.1, tree 2.3 tall |
| City Kit Commercial | building 0.9 × 1.3 × 0.9 | 3.0 | 2.6 × 3.9 × 2.8 (two to three storeys) |
| City Kit Roads | tile 1 × 1, lamp 0.68 tall | 2.0 | road tile 2 × 2 (one lane per unit), lamp 1.35 tall |
| Car Kit | sedan 1.5 × 1.3 × 2.55 | 0.55 | sedan 0.83 × 0.72 × 1.40 (person-high, toy proportions) |
| Food Kit | apple 0.2, can 0.35 tall | 0.5 | apple 0.1, can 0.18 (fits a 0.25-tall shelf tier) |
| Nature Kit | tree 1.7 tall | 1.4 | tree 2.4 tall |
| Furniture Kit | bench 0.4 × 0.47 | 0.8 | bench 0.32 × 0.38 |

Derived constants (also in `src/render/scale.ts`): storey height 1.2, door width 1.0,
parking bay 1.0 × 1.7, lane width 1.0, sidewalk 0.6, shelf tier 0.25.

## Pivots

Bottom-centre (`min.y = 0`, `|centre.x|, |centre.z| < 0.01`) for every placeable object.
Exceptions, kept as the pack made them: Mini Market walls (pivot on the wall's inside edge,
`min.z = -0.3`), road tiles (pivot at tile centre on the ground), `road-side` (overhangs by
0.31 for the kerb), and commercial awnings (pivot on the wall plane).

## Palette

One atlas, `public/assets/textures/atlas.png` (2048 × 1024), eight 512 px slots:

| Slot | Content |
|---|---|
| 0 | Mini Market + Mini Characters colormap (identical files) |
| 1 | City Kit Suburban |
| 2 | City Kit Commercial |
| 3 | City Kit Roads |
| 4 | Car Kit |
| 5 | Food Kit |
| 6 | Flat palette: brand colours first, then Nature / Furniture material colours (32 px cells) |
| 7 | spare |

Kenney colormaps are vertical gradient strips (64 px wide, light → dark left to right);
the UV's x inside a strip is baked shading. Sample with linear filtering and **no mipmaps**
so strips never bleed into neighbours at a distance.

Brand colours (slot 6, fixed cells): white `#FFFFFF`, fresh green `#3FA87A`, honey wood
`#D9A066`, sunny yellow `#FFC044`, dark slate `#38383D`, cream `#FFF3DC`, tile grey
`#B9BCC4`, red `#E8573F`, blue `#4F8FE0`.

## Materials

Exactly two runtime materials: `atlas` (MeshStandardMaterial, roughness 1, metalness 0,
map = atlas) and `glass` (transparent, 45% alpha). Anything else fails the audit.

## Triangle budgets

| Kind | Budget | Measured |
|---|---|---|
| Fixture (shelf, fridge, register) | ≤ 1 000 | 156–892 |
| Product block | ≤ 150 | 28–132 |
| Character | ≤ 1 000 | 520–876 (14 clips kept) |
| House | ≤ 2 100 | 770–2 062 |
| Shop front | ≤ 5 300 | 1 252–5 246 (shop-j is the outlier; used once) |
| Car | ≤ 3 200 | 2 032–3 124 |
| Road tile | ≤ 200 | 12–116 |
| Tree / plant | ≤ 400 | 32–196 |
| Generated piece (letters, awnings, product variants) | ≤ 300 | |

Whole scene budget: < 250 draw calls, < 600 k triangles on screen zoomed out.

## Proportions for generated models

- Chunky: no feature thinner than 0.03 units; bevel-free, flat-shaded, hard edges.
- Sign letters: 0.42 tall, 0.08 deep, stroke 0.09; cream face, slate sides; rounded corners
  from an 8-segment arc.
- Awnings: 0.4 deep, 0.25 drop, green/white stripes of 0.2.
- Product blocks: box 0.16 × 0.22 × 0.1, bottle 0.1 Ø × 0.26, can 0.1 Ø × 0.16, bag 0.2 × 0.14 × 0.32,
  fruit 0.1 Ø; each product has one body colour and one accent band so it reads at a glance.

## People

Thirteen base meshes (12 Mini Characters + the Mini Market employee). Variety comes from
UV strip swaps on the shared colormap: outfit strips are permuted per person, skin picks
one of three tones, hair follows its strip. Staff always keep the green apron strip.
Heights vary ±8%. Never two identical people in one frame.
