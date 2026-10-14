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
  pitch = -0.12;
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
    this.pitch = MathUtils.clamp(this.pitch - dy * 0.0022 * sensitivity, -1.25, 1.1);
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
    this.camera.position.set(x, EYE_HEIGHT * height + bobY, z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.heldBox) {
      this.heldBox.visible = carrying;
      this.heldBox.position.y = -0.27 + (moved > 1e-4 ? Math.sin(this.bob * 0.5) * 0.008 : 0);
    }
  }

  /** Face a world point (used when entering first person or after a cut). */
  faceTowards(fromX: number, fromZ: number, toX: number, toZ: number): void {
    this.yaw = Math.atan2(-(toX - fromX), -(toZ - fromZ));
  }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
