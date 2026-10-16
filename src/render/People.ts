import type { AnimationAction, BufferGeometry, Vector3, Frustum } from 'three';
import { Group, Mesh, AnimationMixer, AnimationClip, LoopRepeat, LoopOnce, Object3D, Float32BufferAttribute, Sphere, Vector3 as V3, InstancedMesh, Color, SkinnedMesh, MeshBasicMaterial, BackSide, ConeGeometry } from 'three';
import { BlobShadows } from './blobs';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLibrary } from './assets';
import type { GameState, Person, Anim as SimAnim, CustomerType, Look } from '@/sim/types';
import { box, merge, paint } from './geometry';
import { rectToWorld } from '@/sim/layout';
import { staffLevel } from '@/sim/staff';
import { bagsGeometry, basketGeometry, BAG_HEIGHT, rideBikeGeometry } from './props';
import { shoppingBags, storeScheme, shopScheme } from '@/sim/schemes';
import { paintStrips, stripOf } from './recolor';
import { poseOf } from './levels';

/**
 * Where each character keeps its skin and its hair in the colour map (row:strip), measured from the
 * models: the face is the head's one big block of skin (the hands share it), the hair its other big
 * strip. The eyes are a few dark triangles on the front of the face, kept when the hair shares their strip.
 * Clothes are row 2 (above the waist a top, below it trousers), but the shop worker wears them in 3:4.
 */
const SKIN_STRIP: Record<string, string> = {
  'people/female-a': '3:6', 'people/male-a': '3:6', 'people/female-b': '3:7', 'people/male-b': '3:7', 'people/female-c': '3:5', 'people/male-c': '3:7',
  'people/female-d': '3:7', 'people/male-d': '3:7', 'people/female-e': '3:7', 'people/male-e': '3:7', 'people/female-f': '3:7', 'people/male-f': '3:5', 'market/character-employee': '3:5',
};
const HAIR_STRIP: Record<string, string> = {
  'people/female-a': '3:0', 'people/male-a': '3:0', 'people/female-b': '3:5', 'people/male-b': '3:5', 'people/female-c': '3:1', 'people/male-c': '3:5',
  'people/female-d': '3:5', 'people/male-d': '3:5', 'people/female-e': '3:0', 'people/male-e': '3:6', 'people/female-f': '3:6', 'people/male-f': '3:0', 'market/character-employee': '3:0',
};
/** The manager's own colours, if designed (null when it is the character's own look). */
type Custom = { skin?: string; hair?: string; top?: string; bottom?: string } | null;
const customOf = (p: Person, shirt?: string): Custom => {
  // Staff: their own skin, hair and trousers, in a shirt of the shop's colour.
  if (p.kind === 'staff' && p.look.model < 12) return { skin: p.look.skin, hair: p.look.hair, top: shirt ?? p.look.top, bottom: p.look.bottom };
  return (p.kind === 'owner' && (p.look.skin || p.look.hair || p.look.top || p.look.bottom)) ? { skin: p.look.skin, hair: p.look.hair, top: p.look.top, bottom: p.look.bottom } : null;
};
const customKey = (c: Custom) => c ? `${c.skin ?? ''}${c.hair ?? ''}${c.top ?? ''}${c.bottom ?? ''}` : '';

export const PEOPLE_MODELS = ['people/female-a', 'people/male-a', 'people/female-b', 'people/male-b', 'people/female-c', 'people/male-c', 'people/female-d', 'people/male-d', 'people/female-e', 'people/male-e', 'people/female-f', 'people/male-f', 'market/character-employee'];

/**
 * The poses a figure plays. The sim says what someone is doing ("browse" at a shelf, "pay" at a till);
 * the renderer turns that into what their hands do: a look and then one reach for each item taken,
 * steady placing while stocking, one bend for a box or a bit of litter, one reach to put things down
 * at the till (and one per item at a self-checkout). Plus a wave, and walking with a box (the walk's
 * legs, the carry's arms).
 */
type Anim = Exclude<SimAnim, 'browse' | 'pay'> | 'greet' | 'carryWalk' | 'reach' | 'stock' | 'bend' | 'argue';
const CLIP_FOR: Record<Exclude<Anim, 'carryWalk' | 'stock'>, string> = { idle: 'idle', walk: 'walk', carry: 'holding-both', sit: 'sit', greet: 'emote-yes', reach: 'interact-left', bend: 'pick-up', argue: 'emote-no' };
/** Gestures played once and held, then back to standing: never looped (a looped reach read as a twitch). */
const ONCE: ReadonlySet<Anim> = new Set<Anim>(['reach', 'bend']);
/** A shopper starts reaching for an item this long (game seconds) before it is in their hand. */
const REACH_LEAD = 0.6;

/** A shopper type's colour and the look it gets (no new meshes: recolours and a prop in the free hand). */
export const TYPE_COLOURS: Record<CustomerType, string> = { bargain: '#FFC044', convenience: '#4F8FE0', loyalist: '#E8573F', impulse: '#7E57C2' };
type Style = '' | 'senior' | 'work';
const styleOf = (p: Person): Style => (p.kind === 'customer' || p.rivalId) ? (p.ctype === 'loyalist' ? 'senior' : p.ctype === 'convenience' ? 'work' : '') : '';
/** Outfit strip permutations (row 2 of the colormap). Green (strip 1) stays put so aprons stay green. */
const OUTFIT_PERMS: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [4, 1, 7, 5, 0, 2, 3, 6],
  [6, 1, 3, 7, 2, 0, 5, 4],
  [3, 1, 5, 0, 6, 7, 4, 2],
];

/** Frame colours for the bikes shoppers ride in on. */
export const BIKE_COLOURS = ['#E8573F', '#4F8FE0', '#3FA87A', '#FFC044', '#38383D', '#9B6FD0'];
/** How high a rider sits (the 'sit' pose on the saddle). */
const RIDE_SEAT = 0.17;
/** A guard's scooter: how high its deck lifts them, and the navy guards wear. */
const SCOOTER_DECK = 0.07;
const GUARD_NAVY = '#2C3E66';
/** A two-wheeled scooter: a deck between two wheels, a stem up to handlebars (in the rider's frame, facing +z). */
function scooterGeometry(pal: AssetLibrary['palette']): BufferGeometry {
  const wheel = (z: number) => box(pal, '#222226', 0.06, 0.07, 0.07, 0, 0, z);
  return merge([wheel(0.13), wheel(-0.13), box(pal, '#38383D', 0.16, 0.025, 0.3, 0, 0.045, 0), box(pal, '#F2F2F0', 0.17, 0.012, 0.31, 0, 0.07, 0),
    box(pal, '#9AA0A8', 0.025, 0.42, 0.025, 0, 0.07, 0.13), box(pal, '#222226', 0.3, 0.025, 0.035, 0, 0.48, 0.13)]);
}

interface Instance {
  root: Group;
  model: string;
  variant: number;
  mixer: AnimationMixer;
  actions: Partial<Record<Anim, AnimationAction>>;
  current: Anim | null;
  /** The one-off gesture last started (which item reached for, which scan), so each plays once. */
  gestureKey: string;
  dog: Mesh | null;
  seen: number;
  /** What they hold: a box in both arms, or shopping bags in one hand. */
  box: Mesh | null;
  /** The bags hang from a pivot beside the right hip that swings with the arm. */
  bags: Group | null;
  bagKey: string;
  arm: Object3D | null;
  /** The other hand: a reusable bag (bargain hunters) or a snack (impulse buyers). */
  prop: Group | null;
  /** Up over their head when it rains and they are out in it. */
  umbrella: Mesh | null;
  /** Under them while they ride to or from the shop. */
  bike?: Mesh | null;
  /** A guard's scooter (from level 3). */
  scooter?: Mesh | null;
  armL: Object3D | null;
  /** Regulars wave at the staff once as they pass. */
  greetUntil: number;
  greeted: number;
  /** The manager's look when the figure was built (a redesign rebuilds it). */
  lookKey: string;
}
const lookKey = (p: Person) => `${p.look.model}|${p.look.height}|${customKey(customOf(p))}`;

/** The staff's model: its green apron takes the shop's colour. */
const UNIFORM_MODEL = 'market/character-employee';
const SHIRTS = ['#E8573F', '#3570BC', '#FFC044', '#3FA87A', '#9B6FE0', '#F27CC1', '#38383D', '#FFFFFF', '#D9A066', '#4FA3C7'];
const SKINS = ['#F2C9A0', '#D9A066', '#A87B45', '#7A5236', '#F5D7B8'];


/**
 * Skinned character pool. One mesh per person (Kenney's head and body share a skeleton, so they are
 * merged into one), geometry shared per model + variant. Nobody casts a shadow-map shadow: a soft
 * blob under everyone, one instanced draw for the whole crowd, reads better and costs nothing.
 */
export class PeopleView {
  /** Debug: stop updating mixers (test hook). */
  static freeze = false;
  readonly group = new Group();
  private readonly live = new Map<number, Instance>();
  private readonly variantGeo = new Map<string, BufferGeometry>();
  private readonly mergedGeo = new Map<string, BufferGeometry>();
  private dogGeo: BufferGeometry | null = null;
  private frame = 0;
  // Above the tallest paving (the sidewalks top out at 0.048), so the blob never hides under a slab.
  private readonly blobs = new BlobShadows(this.group, 192, 0.42, 0.05);
  private readonly sphere = new Sphere(new V3(), 0.9);
  /** Seen from far off, people are drawn as stand-ins in a few instanced draws (a body in their shirt colour, a head, their bags), half again life size so they read from the overview. */
  static readonly FAR = 40;
  private pawnBody: InstancedMesh | null = null;
  private pawnHead: InstancedMesh | null = null;
  private pawnBags: InstancedMesh | null = null;
  private pawnBagN = 0;
  private pawnN = 0;
  private readonly pd = new Object3D();
  private readonly tint = new Color();
  constructor(private readonly assets: AssetLibrary) {}

  private pawns(): void {
    if (this.pawnBody) return;
    const pal = this.assets.palette;
    const body = merge([box(pal, '#FFFFFF', 0.3, 0.26, 0.2, 0, 0.2, 0), box(pal, '#55555E', 0.24, 0.2, 0.16, 0, 0, 0)]);
    const head = box(pal, '#FFFFFF', 0.22, 0.22, 0.2, 0, 0.46, 0);
    // Bags beside the stand-in, a little bigger than life so the store's colour reads from the overview.
    const bag = box(pal, '#FFFFFF', 0.24, 0.26, 0.12, 0.27, 0.02, 0);
    this.pawnBody = new InstancedMesh(body, this.assets.plainMaterial, 192);
    this.pawnHead = new InstancedMesh(head, this.assets.plainMaterial, 192);
    this.pawnBags = new InstancedMesh(bag, this.assets.plainMaterial, 192);
    for (const m of [this.pawnBody, this.pawnHead, this.pawnBags]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
  }
  private pawn(state: GameState, p: Person, x: number, z: number, moving: boolean, y = 0): void {
    this.pawns();
    const b = this.pawnBody!, h = this.pawnHead!;
    if (this.pawnN >= b.instanceMatrix.count) return;
    const d = this.pd;
    d.position.set(x, y + (moving ? Math.abs(Math.sin(this.frame * 0.4 + p.id)) * 0.04 : 0), z); d.rotation.set(0, p.yaw, 0); d.scale.setScalar(1.5 * p.look.height); d.updateMatrix();
    b.setMatrixAt(this.pawnN, d.matrix); h.setMatrixAt(this.pawnN, d.matrix);
    b.setColorAt(this.pawnN, this.tint.set(SHIRTS[(p.look.model * 3 + p.look.variant) % SHIRTS.length]!));
    h.setColorAt(this.pawnN, this.tint.set(SKINS[(p.look.model + p.look.variant * 2) % SKINS.length]!));
    this.pawnN++;
    const bags = shoppingBags(p);
    if (bags && this.pawnBagN < this.pawnBags!.instanceMatrix.count) {
      this.pawnBags!.setMatrixAt(this.pawnBagN, d.matrix);
      this.pawnBags!.setColorAt(this.pawnBagN, this.tint.set(storeScheme(state, bags.store).primary));
      this.pawnBagN++;
    }
  }

  private readonly uniformGeo = new Map<string, BufferGeometry>();
  private uniform(geo: BufferGeometry, key: string, hex: string): BufferGeometry {
    const k = `${key}|${hex}`;
    let g = this.uniformGeo.get(k);
    if (!g) { g = paintStrips(geo, this.assets.palette, { '2:1': hex }); this.uniformGeo.set(k, g); }
    return g;
  }

  /** Head and body as one geometry (same skeleton, same bind pose): one draw call per person. */
  private mergedGeometry(key: string, parts: SkinnedMesh[]): BufferGeometry | null {
    const cached = this.mergedGeo.get(key);
    if (cached) return cached;
    const geos = parts.map((m) => {
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
      return g;
    });
    const out = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (out) this.mergedGeo.set(key, out);
    return out;
  }

  private variantGeometry(model: string, variant: number, geo: BufferGeometry, meshName: string, style: Style = '', custom: Custom = null): BufferGeometry {
    const key = `${model}|${variant}|${meshName}|${style}|${customKey(custom)}`;
    const cached = this.variantGeo.get(key);
    if (cached) return cached;
    if (custom) { const g = this.customGeometry(model, geo, meshName, custom); this.variantGeo.set(key, g); return g; }
    const out = geo.clone();
    if (variant !== 0 || style) {
      // Kenney's colormap strips are gradients and a face's darkest vertex sits exactly on the
      // strip's right edge, so decide the strip per triangle (UV centroid) and shift all three
      // vertices by the same amount. Shared vertices always belong to faces of one colour.
      // Attributes may be interleaved, so read through the accessor, never the raw array.
      const uv = out.getAttribute('uv');
      const n = uv.count;
      const src = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { src[i * 2] = uv.getX(i); src[i * 2 + 1] = uv.getY(i); }
      const arr = new Float32Array(src);
      const perm = OUTFIT_PERMS[variant % OUTFIT_PERMS.length]!;
      const pos = out.getAttribute('position');
      const skinPick = (model.length * 7 + variant * 3) % 3;
      const index = out.getIndex();
      const triCount = index ? index.count / 3 : uv.count / 3;
      const vid = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
      for (let t = 0; t < triCount; t++) {
        const a = vid(t, 0), b = vid(t, 1), c = vid(t, 2);
        const uc = (src[a * 2]! + src[b * 2]! + src[c * 2]!) / 3;
        const vc = (src[a * 2 + 1]! + src[b * 2 + 1]! + src[c * 2 + 1]!) / 3;
        const ul = uc * 4, vDown = vc * 2; // slot 0 of the 4x2 atlas (glTF v runs down)
        if (ul >= 1 || vDown >= 1) continue;
        const strip = Math.floor(ul * 8), row = Math.floor(vDown * 4);
        let ns = strip;
        if (row === 2) ns = perm[strip] ?? strip;
        else if (row === 3 && strip >= 4) ns = 4 + skinPick;
        // Regulars are older: dark hair goes silver. Convenience shoppers wear work clothes: a hi-vis top, navy trousers.
        if (style === 'senior' && meshName.includes('head') && row === 3 && strip === 0) ns = 3;
        if (style === 'work' && meshName.includes('body') && row === 2) { const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3; ns = y >= 0.18 ? 3 : 5; }
        if (ns === strip) continue;
        const shift = (ns - strip) / 8 / 4;
        for (const v of [a, b, c]) arr[v * 2] = src[v * 2]! + shift;
      }
      out.setAttribute('uv', new Float32BufferAttribute(arr, 2));
    }
    this.variantGeo.set(key, out);
    return out;
  }

  /** The designed manager: the chosen skin, hair, top and trousers painted over the character's own colours. */
  private customGeometry(model: string, geo: BufferGeometry, meshName: string, c: NonNullable<Custom>): BufferGeometry {
    const out = geo.index ? geo.toNonIndexed() : geo.clone();
    const uv = out.getAttribute('uv'), pos = out.getAttribute('position');
    if (!uv) return out;
    const pal = this.assets.palette;
    const dst = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { dst[i * 2] = uv.getX(i); dst[i * 2 + 1] = uv.getY(i); }
    const head = meshName.includes('head'), worker = model === UNIFORM_MODEL;
    const skin = SKIN_STRIP[model], hair = HAIR_STRIP[model];
    for (let t = 0; t < uv.count / 3; t++) {
      const st = stripOf((dst[t * 6]! + dst[t * 6 + 2]! + dst[t * 6 + 4]!) / 3, (dst[t * 6 + 1]! + dst[t * 6 + 3]! + dst[t * 6 + 5]!) / 3);
      if (!st) continue;
      const k = `${st.row}:${st.strip}`;
      const y = (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3, z = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3;
      let hex: string | undefined;
      if (k === skin) hex = c.skin;
      else if (head && k === hair && !(z > 0.14 && y > 0.38 && y < 0.52)) hex = c.hair;
      else if (!head && (worker ? k === '3:4' : st.row === 2)) hex = y >= 0.18 ? c.top : c.bottom;
      if (!hex) continue;
      const [u, v] = pal.uv(hex);
      for (let i = 0; i < 3; i++) { dst[(t * 3 + i) * 2] = u; dst[(t * 3 + i) * 2 + 1] = v; }
    }
    out.setAttribute('uv', new Float32BufferAttribute(dst, 2));
    return out;
  }

  private makeDog(): Mesh {
    if (!this.dogGeo) {
      const pal = this.assets.palette;
      const B = '#8B5A3C', D = '#5A3A28';
      this.dogGeo = merge([
        box(pal, B, 0.12, 0.11, 0.26, 0, 0.1, 0), box(pal, B, 0.12, 0.11, 0.11, 0, 0.17, 0.16), box(pal, D, 0.04, 0.06, 0.03, -0.04, 0.26, 0.16), box(pal, D, 0.04, 0.06, 0.03, 0.04, 0.26, 0.16),
        box(pal, D, 0.035, 0.1, 0.035, -0.04, 0, 0.09), box(pal, D, 0.035, 0.1, 0.035, 0.04, 0, 0.09), box(pal, D, 0.035, 0.1, 0.035, -0.04, 0, -0.09), box(pal, D, 0.035, 0.1, 0.035, 0.04, 0, -0.09),
        box(pal, D, 0.03, 0.03, 0.1, 0, 0.17, -0.16), box(pal, '#222226', 0.05, 0.03, 0.03, 0, 0.17, 0.22),
      ]);
    }
    return new Mesh(this.dogGeo, this.assets.plainMaterial);
  }

  /**
   * A shopper on their own, posed, for the photos customers post with their reviews: their look (the
   * same recolours as on the street), standing with their arms out holding their shopping, or waving.
   * The geometry is shared with the crowd's caches: drop the figure, never dispose it.
   */
  figure(look: Look, ctype: CustomerType | undefined, pose: 'carry' | 'idle' | 'greet' = 'carry'): Group {
    const p = { id: -1, kind: 'customer', look, ctype, state: 'idle' } as unknown as Person;
    const model = PEOPLE_MODELS[Math.min(look.model, PEOPLE_MODELS.length - 2)]!;
    const asset = this.assets.character(model);
    const root = skeletonClone(asset.scene) as Group;
    root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh) { m.geometry = this.variantGeometry(model, look.variant, m.geometry, m.name, styleOf(p), null); m.material = this.assets.plainMaterial; m.frustumCulled = false; m.castShadow = true; }
      else if ((o as Mesh).isMesh) (o as Mesh).material = this.assets.plainMaterial;
    });
    root.scale.setScalar(look.height);
    const clip = asset.clips.find((c) => c.name === CLIP_FOR[pose]) ?? asset.clips.find((c) => c.name === 'idle');
    if (clip) { const mx = new AnimationMixer(root); mx.clipAction(clip).play(); mx.update(0.45); }
    if (pose !== 'carry') { const pg = this.propFor(p); if (pg) root.add(pg); }
    root.updateMatrixWorld(true);
    return root;
  }

  private spawn(state: GameState, p: Person): Instance {
    const model = PEOPLE_MODELS[Math.min(p.look.model, PEOPLE_MODELS.length - 1)]!;
    const asset = this.assets.character(model);
    const root = skeletonClone(asset.scene) as Group;
    const skinned: SkinnedMesh[] = [];
    // Staff wear the shop's colour; a guard, security navy.
    const shirt = p.kind === 'staff' ? (p.role === 'guard' ? GUARD_NAVY : shopScheme(state).primary) : undefined;
    root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh) {
        skinned.push(m);
        m.geometry = this.variantGeometry(model, p.look.variant, m.geometry, m.name, styleOf(p), customOf(p, shirt));
        // The shop's staff (and you) wear its colour: Kenney's green apron, repainted.
        if ((p.kind === 'staff' || p.kind === 'owner') && model === UNIFORM_MODEL) m.geometry = this.uniform(m.geometry, `${model}|${p.look.variant}|${m.name}`, shopScheme(state).primary);
        m.material = this.assets.plainMaterial;
        m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
      } else if ((o as Mesh).isMesh) { (o as Mesh).material = this.assets.plainMaterial; (o as Mesh).castShadow = false; }
    });
    const first = skinned[0];
    if (first && skinned.length > 1 && skinned.every((m) => m.skeleton.bones.every((b, i) => b === first.skeleton.bones[i]))) {
      const uniformed = (p.kind === 'staff' || p.kind === 'owner') && model === UNIFORM_MODEL;
      const merged = this.mergedGeometry(`${model}|${p.look.variant}|${uniformed ? shopScheme(state).primary : ''}|${styleOf(p)}|${customKey(customOf(p, shirt))}`, skinned);
      if (merged) { first.geometry = merged; for (const m of skinned.slice(1)) m.removeFromParent(); }
    }
    const scale = p.look.height;
    root.scale.setScalar(scale);
    const mixer = new AnimationMixer(root);
    const actions: Partial<Record<Anim, AnimationAction>> = {};
    for (const [anim, clipName] of Object.entries(CLIP_FOR) as [Anim, string][]) {
      const clip = asset.clips.find((c) => c.name === clipName) ?? asset.clips.find((c) => c.name === 'idle');
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      if (ONCE.has(anim)) { a.setLoop(LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(LoopRepeat, Infinity);
      actions[anim] = a;
    }
    const derived = this.derivedClips(asset.clips);
    if (derived.carryWalk) { const a = mixer.clipAction(derived.carryWalk); a.setLoop(LoopRepeat, Infinity); actions.carryWalk = a; }
    if (derived.stock) { const a = mixer.clipAction(derived.stock); a.setLoop(LoopRepeat, Infinity); actions.stock = a; }
    const inst: Instance = { lookKey: p.kind === 'owner' || p.kind === 'staff' ? lookKey(p) : '', root, model, variant: p.look.variant, mixer, actions, current: null, gestureKey: '', dog: null, seen: this.frame, box: null, bags: null, bagKey: '', arm: root.getObjectByName('arm-right') ?? null, prop: null, umbrella: null, armL: root.getObjectByName('arm-left') ?? null, greetUntil: 0, greeted: -1 };
    const pg = this.propFor(p);
    if (pg) { inst.prop = pg; root.add(pg); }
    if (p.kind === 'owner') root.add(this.badge());
    else if (p.kind === 'staff') root.add(this.nameBadge());
    if (p.look.dog) { inst.dog = this.makeDog(); this.group.add(inst.dog); }
    // Randomise the phase so a crowd does not march in step.
    mixer.setTime((p.id % 13) * 0.17);
    this.group.add(root);
    return inst;
  }

  /**
   * Clips made from Kenney's (one set per clip set): walking with a box in both arms (the walk clip's
   * legs, body and head, the carry clip's arms), and stocking (the reach, looped: its own clip so the
   * one-off reach keeps playing once).
   */
  private derived = new Map<AnimationClip[], { carryWalk: AnimationClip | null; stock: AnimationClip | null }>();
  private derivedClips(clips: AnimationClip[]): { carryWalk: AnimationClip | null; stock: AnimationClip | null } {
    let c = this.derived.get(clips);
    if (!c) {
      const walk = clips.find((x) => x.name === 'walk'), hold = clips.find((x) => x.name === 'holding-both'), reach = clips.find((x) => x.name === 'interact-right');
      c = {
        carryWalk: walk && hold ? new AnimationClip('carry-walk', walk.duration, [...walk.tracks.filter((t) => !t.name.startsWith('arm-')), ...hold.tracks.filter((t) => t.name.startsWith('arm-'))]) : null,
        stock: reach ? new AnimationClip('stock', reach.duration, reach.tracks) : null,
      };
      this.derived.set(clips, c);
    }
    return c;
  }

  /**
   * What someone standing at something does with their hands. A shopper looks the shelf over and
   * reaches for the item as they take it (timed to the sim, at any game speed); staff place stock
   * steadily, and bend once for a box or a bit of litter; at the till a shopper reaches once to put
   * their things down (and once per item at a self-checkout), then stands; loading the car is one reach.
   */
  private hands(state: GameState, p: Person, inst: Instance): { anim: Anim; rate: number } {
    const sim = Math.max(1, state.timeScale || 1);
    let once: { anim: Anim; key: string; rate: number } | null = null;
    if (p.anim === 'browse') {
      if (p.kind !== 'customer' && p.task && p.state === 'stocking') return { anim: 'stock', rate: 0.8 * sim };
      if (p.kind !== 'customer') once = { anim: 'bend', key: `bend:${p.state}:${p.task?.fixtureId ?? -1}:${Math.round(p.x * 10)},${Math.round(p.z * 10)}`, rate: 0.6 * sim };
      else if (p.timer > 0 && p.timer <= REACH_LEAD) once = { anim: 'reach', key: `reach:${p.targetFixture}:${p.listIdx}`, rate: ((inst.actions.reach?.getClip().duration ?? REACH_LEAD) / REACH_LEAD) * sim };
    } else if (p.anim === 'pay') {
      if (p.state === 'loading') once = { anim: 'reach', key: `load:${p.id}`, rate: sim };
      else {
        const reg = state.shop.fixtures.find((f) => f.serving === p.id);
        once = { anim: 'reach', key: `till:${reg?.id ?? -1}:${reg?.type === 'kiosk' ? reg.scanned ?? 0 : 0}`, rate: sim };
      }
    }
    if (!once) return { anim: 'idle', rate: 1 };
    if (once.key !== inst.gestureKey) { inst.gestureKey = once.key; if (inst.current === once.anim) inst.current = null; return once; }
    // Played through: back to standing.
    const a = inst.actions[once.anim];
    if (a && inst.current === once.anim && a.time >= a.getClip().duration - 1e-3) return { anim: 'idle', rate: 1 };
    return once;
  }

  /** A teenager hanging about: standing, a drag on the cigarette every few seconds, a flick of the hand when something is dropped. */
  private teenHands(state: GameState, p: Person, inst: Instance): { anim: Anim; rate: number } {
    let key = '';
    if (p.throwTick !== undefined && state.tick - p.throwTick < 20) key = `throw:${p.throwTick}`;
    else if (p.smoking) { const k = Math.floor((this.frame + p.id * 37) / 380); if ((this.frame + p.id * 37) % 380 < 50) key = `drag:${k}`; }
    if (!key) return { anim: 'idle', rate: 1 };
    if (key !== inst.gestureKey) { inst.gestureKey = key; if (inst.current === 'reach') inst.current = null; return { anim: 'reach', rate: key.startsWith('throw') ? 1.6 : 0.8 }; }
    const a = inst.actions.reach;
    if (a && inst.current === 'reach' && a.time >= a.getClip().duration - 1e-3) return { anim: 'idle', rate: 1 };
    return { anim: 'reach', rate: key.startsWith('throw') ? 1.6 : 0.8 };
  }

  private play(inst: Instance, anim: Anim, speed: number): void {
    const action = inst.actions[anim] ?? inst.actions.idle;
    if (!action) return;
    action.timeScale = anim === 'walk' || anim === 'carryWalk' || anim === 'stock' || anim === 'argue' || ONCE.has(anim) ? speed : 1;
    if (inst.current === anim) return;
    const prev = inst.current ? inst.actions[inst.current] : undefined;
    action.reset().setEffectiveWeight(1).play();
    if (prev && prev !== action) prev.crossFadeTo(action, 0.18, false);
    inst.current = anim;
  }


  /** How hard it is raining (0..1, set each frame): above a shower, people out in it put their umbrellas up. */
  rain = 0;
  private umbrellaGeo = new Map<string, BufferGeometry>();
  /** An umbrella held up over the head: a ribbed eight-panel canopy in a colour, a dark tip and a pole down to the hand. */
  private umbrellaMesh(id: number): Mesh {
    const hex = ['#E8573F', '#4F8FE0', '#FFC044', '#3FA87A', '#38383D', '#9B6FE0', '#F27CC1', '#1F6FB2'][id % 8]!;
    let g = this.umbrellaGeo.get(hex);
    if (!g) {
      const pal = this.assets.palette;
      const canopy = paint(new ConeGeometry(0.36, 0.13, 8, 1, true), pal, hex);
      canopy.translate(0, 1.13, 0);
      const under = paint(new ConeGeometry(0.355, 0.125, 8, 1, true), pal, '#2B2B30');
      under.rotateX(Math.PI); under.translate(0, 1.13, 0);
      g = merge([canopy, under, box(pal, '#38383D', 0.016, 0.62, 0.016, 0, 0.56, 0), box(pal, '#38383D', 0.03, 0.04, 0.03, 0, 1.19, 0)]);
      this.umbrellaGeo.set(hex, g);
    }
    const m = new Mesh(g, this.assets.plainMaterial);
    m.position.set(-0.12, 0, 0.06);
    return m;
  }

  /** The manager's name badge and clipboard, so you can always tell which one is you. */
  private badge(): Group {
    const pal = this.assets.palette;
    const g = new Group();
    const badge = new Mesh(merge([box(pal, '#FFC044', 0.07, 0.05, 0.012, 0.07, 0.42, 0.1), box(pal, '#38383D', 0.05, 0.01, 0.014, 0.07, 0.445, 0.1)]), this.assets.plainMaterial);
    const board = new Mesh(merge([box(pal, '#D9A066', 0.1, 0.13, 0.012, 0, 0, 0), box(pal, '#FFFFFF', 0.08, 0.1, 0.014, 0, 0.012, 0), box(pal, '#9AA0A8', 0.04, 0.015, 0.016, 0, 0.12, 0)]), this.assets.plainMaterial);
    board.position.set(-0.16, 0.22, 0.02); board.rotation.set(0, 0.3, 0.15);
    g.add(badge, board);
    g.name = 'badge';
    return g;
  }

  /** Staff wear a white name badge on the chest (the manager's is gold, with a clipboard). */
  private nameBadgeGeo: BufferGeometry | null = null;
  private nameBadge(): Mesh {
    const pal = this.assets.palette;
    this.nameBadgeGeo ??= merge([box(pal, '#FFFFFF', 0.075, 0.045, 0.012, 0.07, 0.42, 0.1), box(pal, '#38383D', 0.05, 0.008, 0.014, 0.07, 0.437, 0.1), box(pal, '#9AA0A8', 0.04, 0.006, 0.014, 0.07, 0.427, 0.1)]);
    const m = new Mesh(this.nameBadgeGeo, this.assets.plainMaterial);
    m.name = 'badge';
    return m;
  }

  private boxMesh(): Mesh {
    const pal = this.assets.palette;
    const m = new Mesh(merge([box(pal, '#C99A62', 0.24, 0.17, 0.19, 0, 0, 0), box(pal, '#A87B45', 0.242, 0.03, 0.06, 0, 0.16, 0), box(pal, '#FFF3DC', 0.09, 0.05, 0.004, 0.05, 0.07, 0.096)]), this.assets.plainMaterial);
    m.position.set(0, 0.24, 0.17);
    return m;
  }

  /** The free hand: a reusable bag for bargain hunters, a snack for impulse buyers (kids and teens). */
  private propGeo: Partial<Record<CustomerType, BufferGeometry>> = {};
  private propFor(p: Person): Group | null {
    const pal = this.assets.palette;
    if (p.smoking) {
      // A cigarette between the fingers, its tip glowing.
      this.cigGeo ??= merge([box(pal, '#F4F1EA', 0.006, 0.006, 0.034, 0, -0.01, 0.02), box(pal, '#E8903F', 0.0065, 0.0065, 0.008, 0, -0.01, 0.04)]);
      const grp = new Group(); grp.add(new Mesh(this.cigGeo, this.assets.plainMaterial)); return grp;
    }
    if (!(p.kind === 'customer' || p.rivalId) || (p.ctype !== 'bargain' && p.ctype !== 'impulse')) return null;
    let g = this.propGeo[p.ctype];
    if (!g) {
      g = p.ctype === 'bargain'
        // A green canvas tote, folded flat, and a coupon tucked in the top.
        ? merge([box(pal, '#7CC26B', 0.1, 0.09, 0.025, 0, -0.11, 0), box(pal, '#2E8560', 0.008, 0.03, 0.008, -0.03, -0.03, 0), box(pal, '#2E8560', 0.008, 0.03, 0.008, 0.03, -0.03, 0), box(pal, '#FFFFFF', 0.05, 0.035, 0.004, 0.02, -0.035, 0.012)])
        // A bright packet of sweets in the hand.
        : merge([box(pal, '#E8573F', 0.05, 0.07, 0.025, 0, -0.06, 0.02), box(pal, '#FFC044', 0.052, 0.015, 0.027, 0, -0.03, 0.02)]);
      this.propGeo[p.ctype] = g;
    }
    const grp = new Group();
    grp.add(new Mesh(g, this.assets.plainMaterial));
    return grp;
  }
  private cigGeo: BufferGeometry | null = null;
  private holdProp(inst: Instance): void {
    if (!inst.prop) return;
    if (!inst.armL) { inst.prop.position.set(0.28, 0.14, 0); return; }
    inst.armL.updateWorldMatrix(true, false);
    const h = inst.armL.localToWorld(this.hand.set(0.25, -0.01, 0));
    inst.root.worldToLocal(h);
    inst.prop.position.set(h.x, Math.max(h.y, 0.13), h.z);
  }

  // ---- Selection: an outline round the person you clicked, nothing at all otherwise.
  private outline: SkinnedMesh | null = null;
  private selectedId: number | null = null;
  private static outlineMat: MeshBasicMaterial | null = null;
  select(id: number | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    if (this.outline) { this.outline.removeFromParent(); this.outline = null; }
  }
  private attachOutline(inst: Instance): void {
    if (this.outline) return;
    let sk: SkinnedMesh | null = null;
    inst.root.traverse((o) => { if (!sk && (o as SkinnedMesh).isSkinnedMesh) sk = o as SkinnedMesh; });
    if (!sk) return;
    const src = sk as SkinnedMesh;
    if (!PeopleView.outlineMat) {
      // An inverted hull: the skinned mesh again, pushed out along its normals, back faces only, in the highlight yellow.
      const m = new MeshBasicMaterial({ color: '#FFC044', side: BackSide });
      m.onBeforeCompile = (shader) => { shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  transformed += normalize( objectNormal ) * 0.022;'); };
      PeopleView.outlineMat = m;
    }
    const o = new SkinnedMesh(src.geometry, PeopleView.outlineMat);
    o.bind(src.skeleton, src.bindMatrix);
    o.frustumCulled = false; o.name = 'selected-outline';
    src.parent!.add(o);
    this.outline = o;
  }

  // ---- "Who shops where": a marker over every shopper of one type, for a few seconds.
  private marks: InstancedMesh | null = null;
  private markN = 0;
  private highlight: { type: CustomerType; until: number } | null = null;
  highlightType(type: CustomerType | null, seconds = 10): void { this.highlight = type ? { type, until: performance.now() + seconds * 1000 } : null; }
  /** Grows with distance so the markers still read from the overview. */
  private mark(x: number, y: number, z: number, hex: string, eye: Vector3 | null): void {
    if (!this.marks) {
      this.marks = new InstancedMesh(new ConeGeometry(0.09, 0.18, 4).rotateX(Math.PI), new MeshBasicMaterial({ color: '#FFFFFF' }), 192);
      this.marks.frustumCulled = false; this.marks.count = 0; this.marks.renderOrder = 4;
      this.group.add(this.marks);
    }
    if (this.markN >= this.marks.instanceMatrix.count) return;
    const d = this.pd;
    const k = eye ? Math.max(1, Math.hypot(x - eye.x, y - eye.y, z - eye.z) / 9) : 1;
    d.position.set(x, y + (0.2 + Math.sin(this.frame * 0.12) * 0.03) * k, z); d.rotation.set(0, this.frame * 0.04, 0); d.scale.setScalar(k); d.updateMatrix();
    this.marks.setMatrixAt(this.markN, d.matrix); this.marks.setColorAt(this.markN, this.tint.set(hex));
    this.markN++;
  }

  /**
   * Put the bags at the right hand. Kenney's arms point sideways in the bind pose and the clips only lower them
   * 30-45 degrees, so the hand is found along the bone (not below it), and the bags stay upright and above the ground.
   */
  private readonly hand = new V3();
  private hangBags(inst: Instance): void {
    if (!inst.bags) return;
    if (!inst.arm) { inst.bags.position.set(-0.28, BAG_HEIGHT + 0.01, 0); return; }
    inst.arm.updateWorldMatrix(true, false);
    const h = inst.arm.localToWorld(this.hand.set(-0.25, -0.01, 0));
    inst.root.worldToLocal(h);
    inst.bags.position.set(h.x, Math.max(h.y, BAG_HEIGHT + 0.01), h.z);
  }

  /** Bags in one hand, in the colour of the store they came from; the geometry is shared per colour and count. */
  private bagGeo = new Map<string, BufferGeometry>();
  /** A bike to ride, in one of a few colours (by who rides it). */
  private bikeGeo = new Map<string, BufferGeometry>();
  private scooterGeo: BufferGeometry | null = null;
  bikeMesh(id: number): Mesh {
    const hex = BIKE_COLOURS[id % BIKE_COLOURS.length]!;
    let g = this.bikeGeo.get(hex);
    if (!g) { g = rideBikeGeometry(this.assets.palette, hex); this.bikeGeo.set(hex, g); }
    return new Mesh(g, this.assets.plainMaterial);
  }

  private bagMesh(hex: string, n: number): Mesh {
    const k = `${hex}:${n}`;
    let g = this.bagGeo.get(k);
    if (!g) { g = bagsGeometry(this.assets.palette, hex, n); this.bagGeo.set(k, g); }
    return new Mesh(g, this.assets.plainMaterial);
  }

  /** The shop basket in one hand, with one to three goods showing (shared per count and mix). */
  private basketMesh(n: number, id: number): Mesh {
    const k = `basket:${n}:${id % 3}`;
    let g = this.bagGeo.get(k);
    if (!g) { g = basketGeometry(this.assets.palette, n, id % 3); this.bagGeo.set(k, g); }
    return new Mesh(g, this.assets.plainMaterial);
  }

  /** The floor in view (people on the floors above it are hidden), or null for every floor (from outside). */
  viewLevel: number | null = null;

  /** far: people beyond this distance from the focus are not drawn; nor is anyone outside the camera's view. */
  /** Someone in the air (the manager jumping): how high, and how stretched (squashed under 1 on landing). */
  hop = { id: -1, y: 0, stretch: 1 };
  update(state: GameState, alpha: number, dt: number, focus: Vector3, hideId = -1, nearHide = 0, far = 48, view: Frustum | null = null, eye: Vector3 | null = null): void {
    this.frame++;
    // A different game (new, loaded, or the lobby's demo): ids start again, so nothing carries over.
    if (state !== this.lastState) { this.clear(); this.lastState = state; }
    this.blobs.begin();
    this.pawnN = 0; this.pawnBagN = 0; this.markN = 0;
    const hl = this.highlight && performance.now() < this.highlight.until ? this.highlight.type : null;
    const sf = rectToWorld(state.shop, state.shop.floor), shelter = { x0: sf.x0 - 0.3, z0: sf.z0 - 0.3, x1: sf.x1 + 0.3, z1: sf.z1 + 0.3 };
    if (this.highlight && !hl) this.highlight = null;
    for (const p of state.people) {
      let inst = this.live.get(p.id);
      // The manager can be redesigned at any time: a new look is a new figure.
      if (inst && (p.kind === 'owner' || p.kind === 'staff') && inst.lookKey !== lookKey(p)) { this.despawn(inst); this.live.delete(p.id); inst = undefined; }
      if (!inst) { inst = this.spawn(state, p); this.live.set(p.id, inst); }
      inst.seen = this.frame;
      const pose = poseOf(state, p, alpha);
      const x = pose.x, z = pose.z, y = pose.y;
      // Upstairs above the floor in view is out of sight (the camera looks in under it).
      const hidden = p.state === 'driving' || p.state === 'inRival' || p.id === hideId || (this.viewLevel !== null && pose.level > this.viewLevel);
      inst.root.visible = !hidden;
      if (hidden) { if (inst.dog) inst.dog.visible = false; continue; }
      // Riding: sat up on the saddle, the bike under them.
      const riding = !!p.riding && p.kind === 'customer';
      const hop = p.id === this.hop.id ? this.hop : null;
      inst.root.position.set(x, y + (riding ? RIDE_SEAT : 0) + (hop?.y ?? 0), z);
      inst.root.rotation.y = p.yaw;
      // Stretched in the air, squashed landing (a toy's jump); everyone else as they are.
      { const h = p.look.height, k = hop?.stretch ?? 1, w = h / Math.sqrt(k); inst.root.scale.set(w, h * k, w); }
      if (riding && !inst.bike) { inst.bike = this.bikeMesh(p.id); inst.root.add(inst.bike); }
      if (inst.bike) { inst.bike.visible = riding; inst.bike.scale.setScalar(1 / p.look.height); inst.bike.position.set(0, -RIDE_SEAT / p.look.height, 0); }
      // A guard from level 3 stands on a scooter, a hand's height up.
      const scoot = p.kind === 'staff' && p.role === 'guard' && staffLevel(p) >= 3 && !p.onBreak;
      if (scoot && !inst.scooter) { inst.scooter = new Mesh(this.scooterGeo ??= scooterGeometry(this.assets.palette), this.assets.plainMaterial); inst.root.add(inst.scooter); }
      if (inst.scooter) { inst.scooter.visible = scoot; inst.scooter.scale.setScalar(1 / p.look.height); inst.scooter.position.set(0, -SCOOTER_DECK / p.look.height, 0); if (scoot) inst.root.position.y += SCOOTER_DECK; }
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d > far || d < nearHide) { inst.root.visible = false; if (inst.dog) inst.dog.visible = false; continue; }
      if (view) { this.sphere.center.set(x, y + 0.5, z); if (!view.intersectsSphere(this.sphere)) { inst.root.visible = false; if (inst.dog) inst.dog.visible = false; continue; } }
      if (!y) this.blobs.add(x, z, 0.62 * p.look.height * (1 - Math.min(0.5, (hop?.y ?? 0) * 1.4)));
      if (hl && p.ctype === hl && (p.kind === 'customer' || p.rivalId)) this.mark(x, y + 0.95 * p.look.height + 0.16, z, TYPE_COLOURS[hl], eye);
      if (eye && Math.hypot(x - eye.x, eye.y - y, z - eye.z) > PeopleView.FAR) {
        inst.root.visible = false; if (inst.dog) inst.dog.visible = false;
        this.pawn(state, p, x, z, Math.hypot(p.x - p.px, p.z - p.pz) > 1e-4, y);
        continue;
      }
      // In their arms: a box (the manager and stockers), or bags in the colour of the shop they came from.
      const carryBox = !!p.carrying;
      if (carryBox && !inst.box) { inst.box = this.boxMesh(); inst.root.add(inst.box); }
      if (inst.box) inst.box.visible = carryBox;
      // In the right hand: bags once paid for, or the shop's basket with what they have picked so far
      // (reaches are made with the left hand).
      const bagged = shoppingBags(p);
      const picked = !bagged && p.kind === 'customer' && !p.paid ? (p.basket ?? []).reduce((a, b) => a + b.qty, 0) : 0;
      const bags = bagged ?? (picked > 0 ? { store: 'basket', n: Math.min(3, picked) } : null);
      const bk = bags ? `${bags.store}:${bags.n}` : '';
      if (bk !== inst.bagKey) {
        if (inst.bags) { inst.bags.removeFromParent(); inst.bags = null; }
        if (bags) {
          // Hung from the right hand (placed each frame below), upright whatever the arm is doing.
          inst.bags = new Group();
          inst.bags.add(bags.store === 'basket' ? this.basketMesh(bags.n, p.id) : this.bagMesh(storeScheme(state, bags.store).primary, bags.n));
          inst.root.add(inst.bags);
        }
        inst.bagKey = bk;
      }
      // On the stairs they climb; an escalator or a lift carries them standing.
      const moving = pose.ride ? pose.ride === 'stairs' : Math.hypot(p.x - p.px, p.z - p.pz) > 1e-4;
      // Shopping bags swing from one hand: walk normally. Only a box needs both arms.
      let rate = Math.max(0.6, p.speed / 1.6);
      let anim: Anim;
      if (riding) anim = 'sit';
      else if (moving) anim = carryBox || (p.anim === 'carry' && !bags) ? (inst.actions.carryWalk ? 'carryWalk' : 'carry') : 'walk';
      else if (carryBox) anim = 'carry';
      else if (p.anim === 'browse' || p.anim === 'pay') ({ anim, rate } = this.hands(state, p, inst));
      // Town life: drivers after a bump shake their heads at each other; teenagers take a drag now and then, or flick something away.
      else if (p.life === 'driver') { anim = 'argue'; rate = 0.75; }
      else if (p.life === 'teen' && p.state === 'idle') ({ anim, rate } = this.teenHands(state, p, inst));
      else anim = p.anim === 'walk' || (p.anim === 'carry' && bags) ? 'idle' : p.anim;
      // Regulars greet the staff: a wave the first time they pass someone at work.
      if (p.ctype === 'loyalist' && p.kind === 'customer' && (p.state === 'shopping' || p.state === 'browsing' || p.state === 'toQueue') && this.frame % 10 === 0) {
        const near = state.people.find((o) => (o.kind === 'staff' || o.kind === 'owner') && Math.abs(o.x - p.x) < 1.3 && Math.abs(o.z - p.z) < 1.3);
        if (near && near.id !== inst.greeted) { inst.greeted = near.id; inst.greetUntil = this.frame + 70; }
      }
      if (inst.greetUntil > this.frame && inst.actions.greet) anim = 'greet';
      this.play(inst, anim, rate);
      if (d < 30 && !PeopleView.freeze) inst.mixer.update(dt);
      if (inst.bags) this.hangBags(inst);
      if (inst.prop) this.holdProp(inst);
      // Out in the rain: an umbrella (shoppers and passers-by; never inside the shop).
      const wantsUmbrella = this.rain > 0.22 && p.kind !== 'staff' && p.kind !== 'owner' && !carryBox && !(x > shelter.x0 && x < shelter.x1 && z > shelter.z0 && z < shelter.z1);
      if (wantsUmbrella && !inst.umbrella) { inst.umbrella = this.umbrellaMesh(p.id); inst.root.add(inst.umbrella); }
      if (inst.umbrella) inst.umbrella.visible = wantsUmbrella;
      if (p.id === this.selectedId) this.attachOutline(inst);
      if (inst.dog) {
        const back = { x: -Math.sin(p.yaw) * 0.42 + Math.cos(p.yaw) * 0.3, z: -Math.cos(p.yaw) * 0.42 - Math.sin(p.yaw) * 0.3 };
        inst.dog.visible = true;
        // Stopped for the dog: it squats, back end down.
        const squat = p.dogStop !== undefined;
        inst.dog.position.set(x + back.x, y + (moving ? Math.abs(Math.sin(this.frame * 0.35)) * 0.03 : squat ? -0.025 : 0), z + back.z);
        inst.dog.rotation.set(squat ? -0.28 : 0, p.yaw, 0, 'YXZ');
        this.blobs.add(x + back.x, z + back.z, 0.24, 0.36, p.yaw);
      }
    }
    this.blobs.end();
    if (this.marks) { this.marks.count = this.markN; this.marks.visible = this.markN > 0; this.marks.instanceMatrix.needsUpdate = true; if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true; }
    if (this.outline && !this.live.has(this.selectedId ?? -1)) { this.outline.removeFromParent(); this.outline = null; }
    if (this.pawnBody && this.pawnHead && this.pawnBags) for (const m of [this.pawnBody, this.pawnHead, this.pawnBags]) { m.count = m === this.pawnBags ? this.pawnBagN : this.pawnN; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const [id, inst] of this.live) {
      if (inst.seen !== this.frame) {
        this.group.remove(inst.root);
        if (inst.dog) this.group.remove(inst.dog);
        inst.mixer.stopAllAction();
        this.live.delete(id);
      }
    }
  }

  private lastState: GameState | null = null;
  private despawn(inst: Instance): void {
    this.group.remove(inst.root);
    if (inst.dog) this.group.remove(inst.dog);
    inst.mixer.stopAllAction();
    if (this.outline && this.outline.parent && inst.root.getObjectById(this.outline.parent.id)) { this.outline.removeFromParent(); this.outline = null; }
  }

  private clear(): void {
    for (const inst of this.live.values()) { this.group.remove(inst.root); if (inst.dog) this.group.remove(inst.dog); inst.mixer.stopAllAction(); }
    this.live.clear();
  }

  get count(): number { return this.live.size; }

  /** Debug dump of the first live instance's skinned meshes. */
  debugInfo(): unknown {
    const inst = this.live.values().next().value as Instance | undefined;
    if (!inst) return null;
    const out: unknown[] = [];
    inst.root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const g = m.geometry;
      out.push({ name: m.name, bones: m.skeleton?.bones.length, hasNormal: !!g.getAttribute('normal'), hasUv: !!g.getAttribute('uv'), hasSkin: !!g.getAttribute('skinIndex'), verts: g.getAttribute('position').count, mat: (m.material as { name?: string; type: string }).type, mapOk: (m.material as { map?: unknown }).map !== undefined, bindMode: m.bindMode, visible: m.visible, scale: inst.root.scale.x, pos: inst.root.position.toArray(), current: inst.current, actions: Object.keys(inst.actions) });
    });
    return { model: inst.model, variant: inst.variant, meshes: out };
  }
}

export { Object3D };
