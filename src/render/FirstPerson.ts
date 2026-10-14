import { PerspectiveCamera, Group, Mesh, MathUtils, Vector3, type Scene } from 'three';
import type { AssetLibrary } from './assets';
import { box, merge } from './geometry';

/** Eye height of the manager (a Kenney mini character is 0.72 tall; the eyes sit just under the top of the head). */
export const EYE_HEIGHT = 0.6;

/**
 * The manager's eyes: mouse look (yaw/pitch), a gentle head bob while walking, and whatever you
 * carry held in front of you. Yaw 0 looks north (−z), into the shop from the front door.
 */
export class FirstPersonView {
  readonly camera: PerspectiveCamera;
  yaw = 0;
  pitch = -0.42;
  /** Third person: the camera sits behind and above the manager, who stays in view. */
  third = true;
  distance = 2.5;
  private bob = 0;
  private readonly held = new Group();
  private heldBox: Mesh | null = null;
  private last = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(72, aspect, 0.03, 230);
    this.camera.rotation.order = 'YXZ';
    this.camera.add(this.held);
  }

  attach(scene: Scene, assets: AssetLibrary): void {
    scene.add(this.camera);
    const pal = assets.palette;
    // A cardboard box held low in both hands, with a strip of tape.
    const g = merge([box(pal, '#C99A62', 0.26, 0.18, 0.2, 0, 0, 0), box(pal, '#A87B45', 0.262, 0.03, 0.06, 0, 0.17, 0), box(pal, '#FFF3DC', 0.1, 0.06, 0.004, 0.05, 0.07, 0.101)]);
    this.heldBox = new Mesh(g, assets.material);
    this.heldBox.position.set(0.05, -0.27, -0.36);
    this.heldBox.rotation.set(0.15, -0.2, 0);
    this.heldBox.visible = false;
    this.held.add(this.heldBox);
  }

  look(dx: number, dy: number, sensitivity = 1): void {
    this.yaw -= dx * 0.0024 * sensitivity;
    this.pitch = this.third ? MathUtils.clamp(this.pitch - dy * 0.0022 * sensitivity, -1.15, 0.12) : MathUtils.clamp(this.pitch - dy * 0.0022 * sensitivity, -1.25, 1.1);
  }

  /** Forward and right vectors on the ground for WASD. */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }

  update(x: number, z: number, height: number, dt: number, carrying: boolean): void {
    const moved = Math.hypot(x - this.last.x, z - this.last.z);
    this.last.set(x, 0, z);
    if (moved > 1e-4) this.bob += dt * 9; else this.bob *= 0.9;
    const bobY = moved > 1e-4 ? Math.sin(this.bob) * 0.008 : 0;
    if (this.third) {
      // Over the shoulder: orbit a pivot at chest height, look a little past the manager.
      const cp = Math.cos(this.pitch), fx = -Math.sin(this.yaw) * cp, fy = Math.sin(this.pitch), fz = -Math.cos(this.yaw) * cp;
      const py = 0.5 * height, d = this.distance;
      // The centre of the screen passes just over the manager's head toward what they face.
      this.camera.position.set(x - fx * d, Math.max(0.35, py - fy * d + 0.3), z - fz * d);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else {
      this.camera.position.set(x, EYE_HEIGHT * height + bobY, z);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
    if (this.heldBox) {
      this.heldBox.visible = carrying && !this.third;
      this.heldBox.position.y = -0.27 + (moved > 1e-4 ? Math.sin(this.bob * 0.5) * 0.008 : 0);
    }
  }

  /** Face a world point (used when entering first person or after a cut). */
  faceTowards(fromX: number, fromZ: number, toX: number, toZ: number): void {
    this.yaw = Math.atan2(-(toX - fromX), -(toZ - fromZ));
  }

  /** Turn so the centre of the screen lands on a world point, with the manager standing at (x, z). */
  aimAt(x: number, z: number, height: number, tx: number, ty: number, tz: number): void {
    for (let i = 0; i < 8; i++) {
      const cp = Math.cos(this.pitch), fx = -Math.sin(this.yaw) * cp, fy = Math.sin(this.pitch), fz = -Math.cos(this.yaw) * cp;
      const d = this.third ? this.distance : 0, py = this.third ? 0.5 * height + 0.3 : EYE_HEIGHT * height;
      const cx = x - fx * d, cy = Math.max(0.35, py - fy * d), cz = z - fz * d;
      const dx = tx - cx, dy = ty - cy, dz = tz - cz;
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
  }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
