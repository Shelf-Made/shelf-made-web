import { PerspectiveCamera, Vector3, MathUtils } from 'three';

const deg = MathUtils.degToRad;

/**
 * The game camera: a narrow lens looking down at the manager from behind and above, like a
 * model railway seen over its edge. It follows the manager with smoothing; zoom runs from close
 * on the shelves out to the whole crossroads, and past a threshold the camera lets go of the
 * manager and pans freely until you focus it back. Q/E turn it in 45° steps, a right-drag turns
 * it freely. Yaw 0 looks north (the camera stands south of its target).
 */
export class FollowCamera {
  readonly camera: PerspectiveCamera;
  static readonly MIN = 7;
  static readonly MAX = 68;
  /** Beyond this distance the camera stops following the manager and pans freely. */
  static readonly FOLLOW_MAX = 30;
  static readonly DEFAULT = 12;
  readonly target = new Vector3();
  yaw = 0;
  pitch = deg(52);
  distance = FollowCamera.DEFAULT;
  following = true;
  /** Where across the screen the target sits, in -1..1 (docked cards and panels push the world aside). */
  sideOffset = 0;
  private side = 0;
  private goal = { x: 0, z: 0, yaw: 0, pitch: deg(52), distance: FollowCamera.DEFAULT };
  /** The camera stays over the crossroads and its backdrop ring. */
  bounds = { minX: -32, maxX: 32, minZ: -24, maxZ: 28 };
  limits = { minPitch: deg(35), maxPitch: deg(70) };

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(30, aspect, 0.3, 260);
  }

  get goalDistance(): number { return this.goal.distance; }
  /** True once the glide has caught up with where the camera is going (tests wait for this). */
  get settled(): boolean {
    const g = this.goal;
    return Math.hypot(g.x - this.target.x, g.z - this.target.z) < 0.01 && Math.abs(g.yaw - this.yaw) < 1e-3 && Math.abs(g.pitch - this.pitch) < 1e-3
      && Math.abs(g.distance - this.distance) < 0.01 && Math.abs(this.sideOffset - this.side) < 1e-3;
  }
  get goalYaw(): number { return this.goal.yaw; }

  /** Track the manager (only while following). */
  follow(x: number, z: number): void { if (this.following) { this.goal.x = x; this.goal.z = z; this.clamp(); } }

  /** Jump straight to a framing (screenshots, load, after picking a plot). */
  set(x: number, z: number, yaw?: number, distance?: number, pitch?: number): void {
    this.goal.x = x; this.goal.z = z;
    if (yaw !== undefined) this.goal.yaw = yaw;
    if (distance !== undefined) this.goal.distance = MathUtils.clamp(distance, FollowCamera.MIN, FollowCamera.MAX);
    if (pitch !== undefined) this.goal.pitch = MathUtils.clamp(pitch, this.limits.minPitch, this.limits.maxPitch);
    this.clamp();
  }

  snap(): void {
    this.target.set(this.goal.x, 0, this.goal.z);
    this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.distance = this.goal.distance;
    this.apply();
  }

  /** Where the overview settles: the middle of the crossroads. */
  home = { x: 0, z: 3 };

  zoom(factor: number): void {
    const before = this.goal.distance;
    this.goal.distance = MathUtils.clamp(this.goal.distance * factor, FollowCamera.MIN, FollowCamera.MAX);
    if (this.goal.distance > FollowCamera.FOLLOW_MAX) {
      this.following = false;
      // Pulling right out slides the view over to the middle of the crossroads, so the far limit frames the whole town.
      if (this.goal.distance > before) {
        const t = (this.goal.distance - before) / Math.max(1, FollowCamera.MAX - before);
        this.goal.x += (this.home.x - this.goal.x) * t; this.goal.z += (this.home.z - this.goal.z) * t;
      }
    }
  }

  /** Turn by 45° steps (Q and E), landing on the nearest step. */
  rotateStep(dir: 1 | -1): void {
    const step = Math.PI / 4;
    this.goal.yaw = Math.round(this.goal.yaw / step) * step + dir * step;
  }

  /** Right-drag: turn freely and tilt. */
  drag(dx: number, dy: number): void {
    this.goal.yaw -= dx * 0.006;
    this.goal.pitch = MathUtils.clamp(this.goal.pitch + dy * 0.004, this.limits.minPitch, this.limits.maxPitch);
  }

  /** Free pan (zoomed out), in camera-relative ground directions. */
  pan(right: number, forward: number): void {
    const b = this.basis();
    this.goal.x += b.rx * right + b.fx * forward;
    this.goal.z += b.rz * right + b.fz * forward;
    this.following = false;
    this.clamp();
  }

  /** Back to the manager. Zoomed right out, come back in to the default too. */
  focus(x: number, z: number): void {
    this.following = true;
    if (this.goal.distance > FollowCamera.FOLLOW_MAX) this.goal.distance = FollowCamera.DEFAULT;
    this.goal.x = x; this.goal.z = z; this.clamp();
  }

  /** Forward and right on the ground, as the camera sees it (for WASD). */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }

  private clamp(): void {
    this.goal.x = MathUtils.clamp(this.goal.x, this.bounds.minX, this.bounds.maxX);
    this.goal.z = MathUtils.clamp(this.goal.z, this.bounds.minZ, this.bounds.maxZ);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.side += (this.sideOffset - this.side) * k;
    this.apply();
  }

  private apply(): void {
    const c = this.camera;
    const lookY = this.distance < 20 ? 0.45 : 0;
    const h = Math.sin(this.pitch) * this.distance, r = Math.cos(this.pitch) * this.distance;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    // Look a little to one side so the target lands at `side` across the screen.
    const off = -this.side * this.distance * Math.tan(MathUtils.degToRad(c.fov / 2)) * c.aspect;
    const tx = this.target.x + rx * off, tz = this.target.z + rz * off;
    c.position.set(tx + Math.sin(this.yaw) * r, lookY + h, tz + Math.cos(this.yaw) * r);
    c.lookAt(tx, lookY, tz);
  }

  /** Ground radius in view around the target, for fitting the sun's shadow camera. */
  viewRadius(): number { return this.distance * 0.75; }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
