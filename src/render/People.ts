import type { SkinnedMesh, AnimationAction, BufferGeometry, Vector3, Frustum } from 'three';
import { Group, Mesh, AnimationMixer, LoopRepeat, Object3D, Float32BufferAttribute, Sphere, Vector3 as V3, InstancedMesh, Color } from 'three';
import { BlobShadows } from './blobs';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLibrary } from './assets';
import type { GameState, Person, Anim } from '@/sim/types';
import { box, merge } from './geometry';
import { bagsGeometry } from './props';
import { shoppingBags, storeScheme, shopScheme } from '@/sim/schemes';
import { paintStrips } from './recolor';

export const PEOPLE_MODELS = ['people/female-a', 'people/male-a', 'people/female-b', 'people/male-b', 'people/female-c', 'people/male-c', 'people/female-d', 'people/male-d', 'people/female-e', 'people/male-e', 'people/female-f', 'people/male-f', 'market/character-employee'];

const CLIP_FOR: Record<Anim, string> = { idle: 'idle', walk: 'walk', browse: 'pick-up', carry: 'holding-both', pay: 'interact-right', sit: 'sit' };
/** Outfit strip permutations (row 2 of the colormap). Green (strip 1) stays put so aprons stay green. */
const OUTFIT_PERMS: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [4, 1, 7, 5, 0, 2, 3, 6],
  [6, 1, 3, 7, 2, 0, 5, 4],
  [3, 1, 5, 0, 6, 7, 4, 2],
];

interface Instance {
  root: Group;
  model: string;
  variant: number;
  mixer: AnimationMixer;
  actions: Partial<Record<Anim, AnimationAction>>;
  current: Anim | null;
  dog: Mesh | null;
  seen: number;
  /** What they hold: a box in both arms, or shopping bags in one hand. */
  box: Mesh | null;
  bags: Mesh | null;
  bagKey: string;
}

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
  /** Seen from far off, people are drawn as little stand-ins in two instanced draws: a body in their shirt colour, a head. */
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
    const bag = box(pal, '#FFFFFF', 0.16, 0.18, 0.08, 0.24, 0.02, 0);
    this.pawnBody = new InstancedMesh(body, this.assets.material, 192);
    this.pawnHead = new InstancedMesh(head, this.assets.material, 192);
    this.pawnBags = new InstancedMesh(bag, this.assets.material, 192);
    for (const m of [this.pawnBody, this.pawnHead, this.pawnBags]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
  }
  private pawn(state: GameState, p: Person, x: number, z: number, moving: boolean): void {
    this.pawns();
    const b = this.pawnBody!, h = this.pawnHead!;
    if (this.pawnN >= b.instanceMatrix.count) return;
    const d = this.pd;
    d.position.set(x, moving ? Math.abs(Math.sin(this.frame * 0.4 + p.id)) * 0.04 : 0, z); d.rotation.set(0, p.yaw, 0); d.scale.setScalar(1.1 * p.look.height); d.updateMatrix();
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

  private variantGeometry(model: string, variant: number, geo: BufferGeometry, meshName: string): BufferGeometry {
    const key = `${model}|${variant}|${meshName}`;
    const cached = this.variantGeo.get(key);
    if (cached) return cached;
    const out = geo.clone();
    if (variant !== 0) {
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
        if (ns === strip) continue;
        const shift = (ns - strip) / 8 / 4;
        for (const v of [a, b, c]) arr[v * 2] = src[v * 2]! + shift;
      }
      out.setAttribute('uv', new Float32BufferAttribute(arr, 2));
    }
    this.variantGeo.set(key, out);
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
    return new Mesh(this.dogGeo, this.assets.material);
  }

  private spawn(state: GameState, p: Person): Instance {
    const model = PEOPLE_MODELS[Math.min(p.look.model, PEOPLE_MODELS.length - 1)]!;
    const asset = this.assets.character(model);
    const root = skeletonClone(asset.scene) as Group;
    const skinned: SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh) {
        skinned.push(m);
        m.geometry = this.variantGeometry(model, p.look.variant, m.geometry, m.name);
        // The shop's staff (and you) wear its colour: Kenney's green apron, repainted.
        if ((p.kind === 'staff' || p.kind === 'owner') && model === UNIFORM_MODEL) m.geometry = this.uniform(m.geometry, `${model}|${p.look.variant}|${m.name}`, shopScheme(state).primary);
        m.material = this.assets.material;
        m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
      } else if ((o as Mesh).isMesh) { (o as Mesh).material = this.assets.material; (o as Mesh).castShadow = false; }
    });
    const first = skinned[0];
    if (first && skinned.length > 1 && skinned.every((m) => m.skeleton.bones.every((b, i) => b === first.skeleton.bones[i]))) {
      const uniformed = (p.kind === 'staff' || p.kind === 'owner') && model === UNIFORM_MODEL;
      const merged = this.mergedGeometry(`${model}|${p.look.variant}|${uniformed ? shopScheme(state).primary : ''}`, skinned);
      if (merged) { first.geometry = merged; for (const m of skinned.slice(1)) m.removeFromParent(); }
    }
    const scale = p.look.height;
    root.scale.setScalar(scale);
    const mixer = new AnimationMixer(root);
    const actions: Partial<Record<Anim, AnimationAction>> = {};
    for (const [anim, clipName] of Object.entries(CLIP_FOR) as [Anim, string][]) {
      const clip = asset.clips.find((c) => c.name === clipName) ?? asset.clips.find((c) => c.name === 'idle');
      if (clip) { const a = mixer.clipAction(clip); a.setLoop(LoopRepeat, Infinity); actions[anim] = a; }
    }
    const inst: Instance = { root, model, variant: p.look.variant, mixer, actions, current: null, dog: null, seen: this.frame, box: null, bags: null, bagKey: '' };
    if (p.kind === 'owner') root.add(this.badge());
    if (p.look.dog) { inst.dog = this.makeDog(); this.group.add(inst.dog); }
    // Randomise the phase so a crowd does not march in step.
    mixer.setTime((p.id % 13) * 0.17);
    this.group.add(root);
    return inst;
  }

  private play(inst: Instance, anim: Anim, speed: number): void {
    const action = inst.actions[anim] ?? inst.actions.idle;
    if (!action) return;
    action.timeScale = anim === 'walk' || anim === 'carry' ? speed : 1;
    if (inst.current === anim) return;
    const prev = inst.current ? inst.actions[inst.current] : undefined;
    action.reset().setEffectiveWeight(1).play();
    if (prev && prev !== action) prev.crossFadeTo(action, 0.18, false);
    inst.current = anim;
  }


  /** The manager's name badge and clipboard, so you can always tell which one is you. */
  private badge(): Group {
    const pal = this.assets.palette;
    const g = new Group();
    const badge = new Mesh(merge([box(pal, '#FFC044', 0.07, 0.05, 0.012, 0.07, 0.42, 0.1), box(pal, '#38383D', 0.05, 0.01, 0.014, 0.07, 0.445, 0.1)]), this.assets.material);
    const board = new Mesh(merge([box(pal, '#D9A066', 0.1, 0.13, 0.012, 0, 0, 0), box(pal, '#FFFFFF', 0.08, 0.1, 0.014, 0, 0.012, 0), box(pal, '#9AA0A8', 0.04, 0.015, 0.016, 0, 0.12, 0)]), this.assets.material);
    board.position.set(-0.16, 0.22, 0.02); board.rotation.set(0, 0.3, 0.15);
    g.add(badge, board);
    g.name = 'badge';
    return g;
  }

  private boxMesh(): Mesh {
    const pal = this.assets.palette;
    const m = new Mesh(merge([box(pal, '#C99A62', 0.24, 0.17, 0.19, 0, 0, 0), box(pal, '#A87B45', 0.242, 0.03, 0.06, 0, 0.16, 0), box(pal, '#FFF3DC', 0.09, 0.05, 0.004, 0.05, 0.07, 0.096)]), this.assets.material);
    m.position.set(0, 0.24, 0.17);
    return m;
  }

  /** Bags in one hand, in the colour of the store they came from; the geometry is shared per colour and count. */
  private bagGeo = new Map<string, BufferGeometry>();
  private bagMesh(hex: string, n: number): Mesh {
    const k = `${hex}:${n}`;
    let g = this.bagGeo.get(k);
    if (!g) { g = bagsGeometry(this.assets.palette, hex, n); this.bagGeo.set(k, g); }
    return new Mesh(g, this.assets.material);
  }

  /** far: people beyond this distance from the focus are not drawn; nor is anyone outside the camera's view. */
  update(state: GameState, alpha: number, dt: number, focus: Vector3, hideId = -1, nearHide = 0, far = 48, view: Frustum | null = null, eye: Vector3 | null = null): void {
    this.frame++;
    // A different game (new, loaded, or the lobby's demo): ids start again, so nothing carries over.
    if (state !== this.lastState) { this.clear(); this.lastState = state; }
    this.blobs.begin();
    this.pawnN = 0; this.pawnBagN = 0;
    for (const p of state.people) {
      let inst = this.live.get(p.id);
      if (!inst) { inst = this.spawn(state, p); this.live.set(p.id, inst); }
      inst.seen = this.frame;
      const x = p.px + (p.x - p.px) * alpha, z = p.pz + (p.z - p.pz) * alpha;
      const hidden = p.state === 'driving' || p.state === 'inRival' || p.id === hideId;
      inst.root.visible = !hidden;
      if (hidden) continue;
      inst.root.position.set(x, 0, z);
      inst.root.rotation.y = p.yaw;
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d > far || d < nearHide) { inst.root.visible = false; if (inst.dog) inst.dog.visible = false; continue; }
      if (view) { this.sphere.center.set(x, 0.5, z); if (!view.intersectsSphere(this.sphere)) { inst.root.visible = false; if (inst.dog) inst.dog.visible = false; continue; } }
      this.blobs.add(x, z, 0.62 * p.look.height);
      if (eye && Math.hypot(x - eye.x, eye.y, z - eye.z) > PeopleView.FAR) {
        inst.root.visible = false; if (inst.dog) inst.dog.visible = false;
        this.pawn(state, p, x, z, Math.hypot(p.x - p.px, p.z - p.pz) > 1e-4);
        continue;
      }
      // In their arms: a box (the manager and stockers), or bags in the colour of the shop they came from.
      const carryBox = !!p.carrying;
      if (carryBox && !inst.box) { inst.box = this.boxMesh(); inst.root.add(inst.box); }
      if (inst.box) inst.box.visible = carryBox;
      const bags = shoppingBags(p);
      const bk = bags ? `${bags.store}:${bags.n}` : '';
      if (bk !== inst.bagKey) {
        if (inst.bags) { inst.bags.removeFromParent(); inst.bags = null; }
        if (bags) {
          // Hanging from the right hand, so they swing as the arm does.
          inst.bags = this.bagMesh(storeScheme(state, bags.store).primary, bags.n);
          const hand = inst.root.getObjectByName('arm-right');
          if (hand) { inst.bags.position.set(0, -0.11, 0.0); hand.add(inst.bags); } else { inst.bags.position.set(0.17, 0.2, 0); inst.root.add(inst.bags); }
        }
        inst.bagKey = bk;
      }
      const moving = Math.hypot(p.x - p.px, p.z - p.pz) > 1e-4;
      // Shopping bags swing from one hand: walk normally. Only a box needs both arms.
      const anim: Anim = moving ? (p.anim === 'carry' && !bags ? 'carry' : 'walk') : p.anim === 'walk' || (p.anim === 'carry' && bags) ? 'idle' : p.anim;
      this.play(inst, anim, Math.max(0.6, p.speed / 1.6));
      if (d < 30 && !PeopleView.freeze) inst.mixer.update(dt);
      if (inst.dog) {
        const back = { x: -Math.sin(p.yaw) * 0.42 + Math.cos(p.yaw) * 0.3, z: -Math.cos(p.yaw) * 0.42 - Math.sin(p.yaw) * 0.3 };
        inst.dog.visible = true;
        inst.dog.position.set(x + back.x, moving ? Math.abs(Math.sin(this.frame * 0.35)) * 0.03 : 0, z + back.z);
        inst.dog.rotation.y = p.yaw;
        this.blobs.add(x + back.x, z + back.z, 0.24, 0.36, p.yaw);
      }
    }
    this.blobs.end();
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
