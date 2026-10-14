import type { SkinnedMesh, AnimationAction, BufferGeometry, Vector3} from 'three';
import { Group, Mesh, AnimationMixer, LoopRepeat, Object3D, Float32BufferAttribute } from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetLibrary } from './assets';
import type { GameState, Person, Anim } from '@/sim/types';
import { box, merge } from './geometry';

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
}

/** Skinned character pool. One mesh clone per person; geometry shared per model + variant. */
export class PeopleView {
  /** Debug: stop updating mixers (test hook). */
  static freeze = false;
  readonly group = new Group();
  private readonly live = new Map<number, Instance>();
  private readonly variantGeo = new Map<string, BufferGeometry>();
  private dogGeo: BufferGeometry | null = null;
  private frame = 0;
  constructor(private readonly assets: AssetLibrary) {}

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
    const m = new Mesh(this.dogGeo, this.assets.material);
    m.castShadow = true;
    return m;
  }

  private spawn(p: Person): Instance {
    const model = PEOPLE_MODELS[Math.min(p.look.model, PEOPLE_MODELS.length - 1)]!;
    const asset = this.assets.character(model);
    const root = skeletonClone(asset.scene) as Group;
    root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.geometry = this.variantGeometry(model, p.look.variant, m.geometry, m.name);
        m.material = this.assets.material;
        m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
      } else if ((o as Mesh).isMesh) { (o as Mesh).material = this.assets.material; (o as Mesh).castShadow = true; }
    });
    const scale = p.look.height;
    root.scale.setScalar(scale);
    const mixer = new AnimationMixer(root);
    const actions: Partial<Record<Anim, AnimationAction>> = {};
    for (const [anim, clipName] of Object.entries(CLIP_FOR) as [Anim, string][]) {
      const clip = asset.clips.find((c) => c.name === clipName) ?? asset.clips.find((c) => c.name === 'idle');
      if (clip) { const a = mixer.clipAction(clip); a.setLoop(LoopRepeat, Infinity); actions[anim] = a; }
    }
    const inst: Instance = { root, model, variant: p.look.variant, mixer, actions, current: null, dog: null, seen: this.frame };
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

  update(state: GameState, alpha: number, dt: number, focus: Vector3): void {
    this.frame++;
    for (const p of state.people) {
      let inst = this.live.get(p.id);
      if (!inst) { inst = this.spawn(p); this.live.set(p.id, inst); }
      inst.seen = this.frame;
      const x = p.px + (p.x - p.px) * alpha, z = p.pz + (p.z - p.pz) * alpha;
      const hidden = p.state === 'driving';
      inst.root.visible = !hidden;
      if (hidden) continue;
      inst.root.position.set(x, 0, z);
      inst.root.rotation.y = p.yaw;
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d > 48) { inst.root.visible = false; continue; }
      const moving = Math.hypot(p.x - p.px, p.z - p.pz) > 1e-4;
      const anim: Anim = moving ? (p.anim === 'carry' ? 'carry' : 'walk') : p.anim === 'walk' ? 'idle' : p.anim;
      this.play(inst, anim, Math.max(0.6, p.speed / 1.6));
      if (d < 30 && !PeopleView.freeze) inst.mixer.update(dt);
      if (inst.dog) {
        const back = { x: -Math.sin(p.yaw) * 0.42 + Math.cos(p.yaw) * 0.3, z: -Math.cos(p.yaw) * 0.42 - Math.sin(p.yaw) * 0.3 };
        inst.dog.position.set(x + back.x, moving ? Math.abs(Math.sin(this.frame * 0.35)) * 0.03 : 0, z + back.z);
        inst.dog.rotation.y = p.yaw;
      }
    }
    for (const [id, inst] of this.live) {
      if (inst.seen !== this.frame) {
        this.group.remove(inst.root);
        if (inst.dog) this.group.remove(inst.dog);
        inst.mixer.stopAllAction();
        this.live.delete(id);
      }
    }
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
