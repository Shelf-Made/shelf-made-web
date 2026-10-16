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
  private goal = { x: 0, y: 0, z: 0, yaw: 0, pitch: deg(52), distance: FollowCamera.DEFAULT };
  /** The camera stays over the crossroads and its backdrop ring. */
  bounds = { minX: -32, maxX: 32, minZ: -24, maxZ: 28 };
  limits = { minPitch: deg(35), maxPitch: deg(70) };
  /** Seeing through the manager's eyes: at their eye height, looking where they look, with a wider lens and a short view. */
  firstPerson = false;
  /** How far down the eyes look in first person (radians; negative looks up). */
  fpDown = deg(6);
  /** The eyes' height over the floor, in first person (set from the manager's height). */
  eye = 0.6;
  /** Scrolling in past the closest the camera comes: how far, so a nudge of the trackpad does not drop you into first person. */
  private pushIn = 0;

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

  /**
   * Track the manager (only while following), at the height of the floor they are on. Dragged away to look about, the
   * view stays where it was put but still at the height of the floor in view (not out over the town).
   */
  follow(x: number, z: number, y = 0): void {
    if (this.following) { this.goal.x = x; this.goal.z = z; this.goal.y = y; this.clamp(); }
    else if (this.goal.distance <= FollowCamera.FOLLOW_MAX) this.goal.y = y;
  }

  /** Jump straight to a framing (screenshots, load, after picking a plot). */
  set(x: number, z: number, yaw?: number, distance?: number, pitch?: number, y = 0): void {
    this.goal.x = x; this.goal.z = z; this.goal.y = y;
    if (yaw !== undefined) this.goal.yaw = yaw;
    if (distance !== undefined) this.goal.distance = MathUtils.clamp(distance, FollowCamera.MIN, FollowCamera.MAX);
    if (pitch !== undefined) this.goal.pitch = MathUtils.clamp(pitch, this.limits.minPitch, this.limits.maxPitch);
    this.clamp();
  }

  snap(): void {
    this.target.set(this.goal.x, this.goal.y, this.goal.z);
    this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.distance = this.goal.distance;
    this.apply();
  }

  /** Where the overview settles: the middle of the crossroads. */
  home = { x: 0, z: 3 };

  /**
   * The wheel or the zoom keys. In first person, out goes back to the camera behind (null: no change); in close,
   * scrolling on past the nearest the camera comes asks for first person ('in').
   */
  zoom(factor: number): 'in' | 'out' | null {
    if (this.firstPerson) return factor > 1.01 ? 'out' : null;
    if (factor < 1 && this.goal.distance <= FollowCamera.MIN + 1e-6) {
      this.pushIn += Math.log(1 / factor);
      if (this.pushIn > 0.3) { this.pushIn = 0; return 'in'; }
      return null;
    }
    this.pushIn = 0;
    this.zoomBy(factor);
    return null;
  }

  /** Zoom by a factor, nothing more (the Build card fitting the shop in view, and back). */
  zoomBy(factor: number): void {
    const before = this.goal.distance;
    this.goal.distance = MathUtils.clamp(this.goal.distance * factor, FollowCamera.MIN, FollowCamera.MAX);
    if (this.goal.distance > FollowCamera.FOLLOW_MAX) {
      this.following = false; this.goal.y = 0;
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

  /** Right-drag: turn freely and tilt (in first person, look round and up and down). */
  drag(dx: number, dy: number): void {
    this.goal.yaw -= dx * 0.006;
    if (this.firstPerson) { this.fpDown = MathUtils.clamp(this.fpDown + dy * 0.004, -deg(50), deg(70)); return; }
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

  /** Drag the ground: move by a world offset at once (no glide), so the spot under the pointer stays under it. */
  panWorld(dx: number, dz: number): void {
    const gx = this.goal.x, gz = this.goal.z;
    this.goal.x += dx; this.goal.z += dz;
    this.following = false;
    this.clamp();
    this.target.x += this.goal.x - gx; this.target.z += this.goal.z - gz;
  }

  /** Back to the manager. Zoomed right out, come back in to the default too. */
  focus(x: number, z: number, y = this.goal.y): void {
    this.following = true; this.goal.y = y;
    if (this.firstPerson) { this.goal.x = x; this.goal.z = z; this.clamp(); return; }
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

  /** Into the manager's eyes (facing the way the camera did), or back out to the camera behind them at its nearest. */
  setFirstPerson(on: boolean): void {
    if (on === this.firstPerson) return;
    this.firstPerson = on; this.pushIn = 0;
    const c = this.camera;
    if (on) {
      this.following = true; this.fpDown = deg(6);
      c.fov = 62; c.near = 0.04; c.far = 60;
    } else {
      // Back out behind them, close in, looking the way the eyes did.
      this.goal.distance = this.distance = FollowCamera.MIN;
      c.fov = 30; c.near = 0.3; c.far = 260;
    }
    c.updateProjectionMatrix();
    this.target.set(this.goal.x, this.goal.y, this.goal.z);
    this.apply();
  }

  update(dt: number): void {
    if (this.firstPerson) {
      // The eyes go where the manager goes, with no lag (their walk is already smoothed); turning eases a little.
      this.target.set(this.goal.x, this.goal.y, this.goal.z);
      this.yaw += (this.goal.yaw - this.yaw) * (1 - Math.exp(-dt * 22));
      this.apply();
      return;
    }
    const k = 1 - Math.exp(-dt * 8);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    this.target.y += (this.goal.y - this.target.y) * k;
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.side += (this.sideOffset - this.side) * k;
    this.apply();
  }

  private apply(): void {
    const c = this.camera;
    if (this.firstPerson) {
      const cp = Math.cos(this.fpDown), fx = -Math.sin(this.yaw) * cp, fz = -Math.cos(this.yaw) * cp;
      const y = this.target.y + this.eye;
      c.position.set(this.target.x, y, this.target.z);
      c.lookAt(this.target.x + fx, y - Math.sin(this.fpDown), this.target.z + fz);
      return;
    }
    const lookY = this.distance < 20 ? 0.45 : 0;
    const h = Math.sin(this.pitch) * this.distance, r = Math.cos(this.pitch) * this.distance;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    // Look a little to one side so the target lands at `side` across the screen.
    const off = -this.side * this.distance * Math.tan(MathUtils.degToRad(c.fov / 2)) * c.aspect;
    const tx = this.target.x + rx * off, tz = this.target.z + rz * off;
    const ty = lookY + this.target.y;
    c.position.set(tx + Math.sin(this.yaw) * r, ty + h, tz + Math.cos(this.yaw) * r);
    c.lookAt(tx, ty, tz);
  }

  /** Ground radius in view around the target, for fitting the sun's shadow camera. */
  viewRadius(): number { return this.firstPerson ? 9 : this.distance * 0.75; }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
