import { Group, Mesh, BoxGeometry, MeshBasicMaterial, Color } from 'three';

/**
 * A glowing outline on the floor round whatever the Use key (or a click) would act on: sunny
 * yellow when it will do something, soft white when it only tells you what it is. It breathes
 * a little so the eye finds it.
 */
export class TargetMarker {
  readonly group = new Group();
  private readonly mat = new MeshBasicMaterial({ color: '#FFC044', transparent: true, opacity: 0.95, depthWrite: false });
  private readonly sides: Mesh[] = [];
  private t = 0;
  private key = '';
  constructor() {
    const g = new BoxGeometry(1, 0.03, 1);
    for (let i = 0; i < 4; i++) { const m = new Mesh(g, this.mat); m.renderOrder = 2; this.sides.push(m); this.group.add(m); }
    this.group.visible = false;
  }

  /** Outline a world rectangle (or hide with null). */
  set(rect: { x0: number; z0: number; x1: number; z1: number } | null, ok = true): void {
    if (!rect) { this.group.visible = false; this.key = ''; return; }
    this.group.visible = true;
    this.mat.color.copy(ok ? new Color('#FFC044') : new Color('#FFFFFF'));
    const k = `${rect.x0},${rect.z0},${rect.x1},${rect.z1}`;
    if (k === this.key) return;
    this.key = k;
    const m = 0.08, w = rect.x1 - rect.x0 + 2 * m, d = rect.z1 - rect.z0 + 2 * m, cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, th = 0.07;
    const [n, s, e, west] = this.sides as [Mesh, Mesh, Mesh, Mesh];
    n.scale.set(w, 1, th); n.position.set(cx, 0.03, cz - d / 2);
    s.scale.set(w, 1, th); s.position.set(cx, 0.03, cz + d / 2);
    e.scale.set(th, 1, d); e.position.set(cx + w / 2, 0.03, cz);
    west.scale.set(th, 1, d); west.position.set(cx - w / 2, 0.03, cz);
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    this.mat.opacity = 0.6 + 0.35 * (0.5 + 0.5 * Math.sin(this.t * 5));
  }
}
