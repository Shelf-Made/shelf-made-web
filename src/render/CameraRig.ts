import { PerspectiveCamera, Vector3, MathUtils } from 'three';

/** One angled camera over the world: pan, zoom, rotate, tilt with smooth limits. */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  target = new Vector3(0, 0, -3);
  yaw = 0;
  pitch = MathUtils.degToRad(52);
  distance = 17;
  private goal = { x: 0, z: -3, yaw: 0, pitch: MathUtils.degToRad(52), distance: 17 };
  /** Screen-space offset of the target, as a fraction of the view (positive = world shifts left, for docked cards). */
  sideOffset = 0;
  private side = 0;
  bounds = { minX: -40, maxX: 40, minZ: -16, maxZ: 14 };
  limits = { minDist: 6, maxDist: 46, minPitch: MathUtils.degToRad(28), maxPitch: MathUtils.degToRad(80) };

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(36, aspect, 0.5, 320);
    this.snap();
  }

  /** Jump to the goal (no smoothing). */
  snap(): void {
    this.target.x = this.goal.x; this.target.z = this.goal.z;
    this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.distance = this.goal.distance;
    this.apply();
  }

  focus(x: number, z: number, distance?: number, yaw?: number, pitch?: number): void {
    this.goal.x = x; this.goal.z = z;
    if (distance !== undefined) this.goal.distance = distance;
    if (yaw !== undefined) this.goal.yaw = yaw;
    if (pitch !== undefined) this.goal.pitch = pitch;
    this.clampGoal();
  }

  pan(dx: number, dz: number): void {
    // Pan in camera-relative ground directions.
    const s = Math.sin(this.goal.yaw), c = Math.cos(this.goal.yaw);
    this.goal.x += dx * c - dz * s;
    this.goal.z += dx * s + dz * c;
    this.clampGoal();
  }
  zoom(factor: number): void { this.goal.distance = MathUtils.clamp(this.goal.distance * factor, this.limits.minDist, this.limits.maxDist); }
  rotate(dyaw: number, dpitch: number): void {
    this.goal.yaw += dyaw;
    this.goal.pitch = MathUtils.clamp(this.goal.pitch + dpitch, this.limits.minPitch, this.limits.maxPitch);
  }
  get goalDistance(): number { return this.goal.distance; }
  get goalYaw(): number { return this.goal.yaw; }

  private clampGoal(): void {
    this.goal.x = MathUtils.clamp(this.goal.x, this.bounds.minX, this.bounds.maxX);
    this.goal.z = MathUtils.clamp(this.goal.z, this.bounds.minZ, this.bounds.maxZ);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 9);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    const dy = this.goal.yaw - this.yaw;
    this.yaw += dy * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.side += (this.sideOffset - this.side) * k;
    this.apply();
  }

  private apply(): void {
    const c = this.camera;
    const h = Math.sin(this.pitch) * this.distance;
    const r = Math.cos(this.pitch) * this.distance;
    // Shift the look-at point along the camera's right vector so a docked card leaves the store uncovered.
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const off = this.side * this.distance * 0.42;
    const tx = this.target.x + rx * off, tz = this.target.z + rz * off;
    c.position.set(tx + Math.sin(this.yaw) * r, h, tz + Math.cos(this.yaw) * r);
    c.lookAt(tx, 0, tz);
  }

  /** Ground-plane size visible at the target, for shadow frustum fitting. */
  viewRadius(): number { return this.distance * 0.9; }

  resize(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
