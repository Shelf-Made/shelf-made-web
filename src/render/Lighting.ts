import type { Scene} from 'three';
import { DirectionalLight, HemisphereLight, AmbientLight, Color, Vector3, Fog } from 'three';

/** Sun, sky and a soft fill; colours follow the time of day. */
export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly sky = new Color('#BFE3FF');
  private readonly sunDay = new Color('#FFF4E0');
  private readonly sunEve = new Color('#FFB070');
  private readonly sunNight = new Color('#7F90C8');
  private readonly skyDay = new Color('#BFE3FF');
  private readonly skyEve = new Color('#F9C08A');
  private readonly skyNight = new Color('#2D3250');
  private readonly groundDay = new Color('#8FB07A');
  private readonly groundNight = new Color('#2A3328');
  private readonly tmp = new Color();

  constructor(scene: Scene) {
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    this.hemi = new HemisphereLight(this.skyDay, this.groundDay, 1.4);
    this.ambient = new AmbientLight(0xffffff, 0.45);
    scene.add(this.sun, this.sun.target, this.hemi, this.ambient);
    scene.background = this.sky;
    scene.fog = new Fog(this.sky, 70, 160);
  }

  /** t = 0 at 08:00, 1 at 20:00. night = true after closing. */
  setTime(t: number, night: boolean, focus: Vector3, radius: number): void {
    const tt = Math.max(0, Math.min(1, t));
    const elev = night ? 0.5 : 0.62 + 0.45 * Math.sin(Math.PI * tt);
    const az = -0.9 + tt * 1.8;
    const dir = new Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev) * 0.6 + 0.4).normalize();
    this.sun.position.copy(focus).addScaledVector(dir, 60);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    const r = Math.max(10, Math.min(radius, 34));
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.updateProjectionMatrix();
    const evening = Math.max(0, (tt - 0.7) / 0.3);
    if (night) {
      this.sun.color.copy(this.sunNight); this.sun.intensity = 1.1;
      this.sky.copy(this.skyNight);
      this.hemi.color.set('#6D7BB8'); this.hemi.groundColor.copy(this.groundNight); this.hemi.intensity = 1.3;
      this.ambient.color.set('#FFD9A8'); this.ambient.intensity = 0.5;
    } else {
      this.sun.color.copy(this.sunDay).lerp(this.sunEve, evening); this.sun.intensity = 2.2 - 0.6 * evening;
      this.sky.copy(this.skyDay).lerp(this.skyEve, evening * 0.8);
      this.hemi.color.copy(this.sky); this.hemi.groundColor.copy(this.groundDay); this.hemi.intensity = 1.4;
      this.ambient.color.set('#FFFFFF'); this.ambient.intensity = 0.45;
    }
    this.tmp.copy(this.sky);
  }
}
