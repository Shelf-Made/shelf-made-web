import { Group, Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, type Vector3 } from 'three';
import type { GameState, ReactionKind } from '@/sim/types';
import { TICK } from '@/sim/layout';
import { poseOf } from './levels';

/** How long a bubble stays up, and how many at once. */
const SHOW = 2.8, MAX = 4;

/**
 * What shoppers think, as little speech bubbles over their heads: too pricey, out of stock, a long
 * queue, a great deal, love this place. The sim records the moments (`state.reactions`); this only
 * draws the newest few, pops them in, and lets them fade.
 */
export class ReactionsView {
  readonly group = new Group();
  private readonly sprites: Sprite[] = [];
  private readonly mats = new Map<ReactionKind, SpriteMaterial>();

  constructor() {
    for (let i = 0; i < MAX; i++) { const s = new Sprite(); s.visible = false; s.renderOrder = 5; this.sprites.push(s); this.group.add(s); }
  }

  private material(kind: ReactionKind): SpriteMaterial {
    let m = this.mats.get(kind);
    if (!m) { m = new SpriteMaterial({ map: icon(kind), depthTest: false, transparent: true }); this.mats.set(kind, m); }
    return m;
  }

  /** The floor in view: bubbles over people upstairs of it are hidden with them. */
  viewLevel: number | null = null;

  update(state: GameState, alpha: number, eye: Vector3 | null, far = 42): void {
    const now = state.tick;
    const live = state.reactions.filter((r) => (now - r.tick) * TICK < SHOW).slice(-MAX);
    this.sprites.forEach((s, i) => {
      const r = live[i];
      const p = r && state.people.find((x) => x.id === r.personId);
      if (!r || !p || p.state === 'driving' || p.state === 'inRival' || typeof document === 'undefined') { s.visible = false; return; }
      const pose = poseOf(state, p, alpha), x = pose.x, z = pose.z;
      if ((this.viewLevel !== null && pose.level > this.viewLevel) || (eye && Math.hypot(x - eye.x, eye.y - pose.y, z - eye.z) > far)) { s.visible = false; return; }
      const age = (now - r.tick) * TICK;
      // Pop in with a little overshoot, hold, then shrink away.
      const k = age < 0.25 ? (age / 0.25) * 1.15 : age < 0.4 ? 1.15 - (age - 0.25) : age > SHOW - 0.35 ? Math.max(0, (SHOW - age) / 0.35) : 1;
      s.material = this.material(r.kind);
      s.position.set(x, pose.y + 0.78 * p.look.height + 0.22 + Math.min(age, 0.4) * 0.12, z);
      s.scale.set(0.42 * k, 0.42 * k, 1);
      s.visible = k > 0.01;
    });
  }
}

/** A white speech bubble with a small tail and one bold symbol. Drawn once per kind (and a spill's marker). */
export function icon(kind: ReactionKind | 'spill'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // Bubble and tail.
  g.fillStyle = '#FFFFFF'; g.strokeStyle = '#38383D'; g.lineWidth = 6;
  g.beginPath(); g.roundRect(10, 8, 108, 92, 26); g.moveTo(50, 98); g.lineTo(64, 122); g.lineTo(78, 98); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#FFFFFF'; g.fillRect(48, 92, 32, 9);
  const cx = 64, cy = 54;
  g.lineCap = 'round'; g.lineJoin = 'round';
  switch (kind) {
    case 'pricey': // Two red dollar signs.
      g.fillStyle = '#E8573F'; g.font = 'bold 58px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$$', cx, cy + 3); break;
    case 'outOfStock': { // An empty shelf with a cross.
      g.strokeStyle = '#868BA1'; g.lineWidth = 7; g.strokeRect(34, 26, 60, 54); g.beginPath(); g.moveTo(34, 53); g.lineTo(94, 53); g.stroke();
      g.strokeStyle = '#E8573F'; g.lineWidth = 9; g.beginPath(); g.moveTo(44, 34); g.lineTo(84, 74); g.moveTo(84, 34); g.lineTo(44, 74); g.stroke(); break;
    }
    case 'queue': { // A clock.
      g.fillStyle = '#FF8C42'; g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 18); g.moveTo(cx, cy); g.lineTo(cx + 14, cy + 6); g.stroke(); break;
    }
    case 'deal': { // A yellow price tag with a percent sign.
      g.fillStyle = '#FFC044'; g.beginPath(); g.moveTo(30, 54); g.lineTo(52, 28); g.lineTo(98, 28); g.lineTo(98, 80); g.lineTo(52, 80); g.closePath(); g.fill();
      g.fillStyle = '#38383D'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('%', 74, 56);
      g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(44, 54, 5, 0, Math.PI * 2); g.fill(); break;
    }
    case 'ew': { // A queasy green face: mess on the ground, or a crowd blocking the way.
      g.fillStyle = '#8BC34A'; g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#38383D'; g.beginPath(); g.arc(cx - 11, cy - 7, 4.5, 0, Math.PI * 2); g.arc(cx + 11, cy - 7, 4.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#38383D'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 14, cy + 14); g.quadraticCurveTo(cx - 7, cy + 7, cx, cy + 14); g.quadraticCurveTo(cx + 7, cy + 21, cx + 14, cy + 14); g.stroke(); break;
    }
    case 'thief': { // A red alarm: a bold exclamation mark in a red circle.
      g.fillStyle = '#E8573F'; g.beginPath(); g.arc(cx, cy, 32, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#FFFFFF'; g.beginPath(); g.roundRect(cx - 6, cy - 22, 12, 30, 5); g.fill();
      g.beginPath(); g.arc(cx, cy + 18, 6.5, 0, Math.PI * 2); g.fill(); break;
    }
    case 'spill': { // A blue drop over a puddle: something to mop up.
      g.fillStyle = '#7FC4F0'; g.beginPath(); g.ellipse(cx, cy + 24, 30, 8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3F8DBF'; g.beginPath(); g.moveTo(cx, cy - 30); g.bezierCurveTo(cx + 6, cy - 16, cx + 22, cy - 2, cx + 22, cy + 8); g.arc(cx, cy + 8, 22, 0, Math.PI); g.bezierCurveTo(cx - 22, cy - 2, cx - 6, cy - 16, cx, cy - 30); g.fill();
      g.fillStyle = '#FFFFFF'; g.beginPath(); g.ellipse(cx - 8, cy + 4, 4, 7, -0.4, 0, Math.PI * 2); g.fill(); break;
    }
    case 'love': { // A red heart.
      g.fillStyle = '#E8573F'; g.beginPath(); g.moveTo(cx, 84);
      g.bezierCurveTo(22, 56, 30, 22, cx, 40); g.bezierCurveTo(98, 22, 106, 56, cx, 84); g.fill(); break;
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
