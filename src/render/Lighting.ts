import type { Scene } from 'three';
import { DirectionalLight, HemisphereLight, AmbientLight, Color, Vector3, Fog } from 'three';

/**
 * The sky's colours for shaders that reflect it (wet ground, puddles): the zenith, the horizon, where
 * the sun is and how bright. Worked out analytically in the shader, never as an environment map (an
 * environment map on every material doubled the cost of a frame on modest hardware).
 */
export const skyUniforms = {
  uSkyTop: { value: new Color('#3F8FE0') },
  uSkyHorizon: { value: new Color('#C4E4FF') },
  uSunDir: { value: new Vector3(0, 1, 0) },
  uSunCol: { value: new Color(1, 1, 1) },
};

/** What the weather does to the light: cloud cover, rain, how dark the storm is, a lightning flash (each 0..1). */
export interface SkyWeather { cloud: number; rain: number; storm: number; fog: number; flash: number }
export const CLEAR_SKY: SkyWeather = { cloud: 0.15, rain: 0, storm: 0, fog: 0, flash: 0 };

/**
 * The sun and the sky. Strong warm sunlight with a cooler sky fill from above and grass bounce from
 * below, so shade reads blue and lit sides warm. The
 * sun climbs from a low golden morning to a high white noon and sinks to a long amber evening; clouds
 * dim and soften it (an overcast day has no hard shadows), rain greys the air, a storm darkens it and
 * lightning floods it white for a blink.
 */
export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly sky = new Color('#BFE3FF');
  /** The zenith colour for the gradient sky dome. */
  readonly skyTop = new Color('#5FA8E8');
  /** Where the sun is (unit vector), for the sky's glow round it. */
  readonly sunDir = new Vector3(0, 1, 0);
  /** 0..1: how much of the sun gets through (the sky dome draws its glow this strong). */
  sunVisible = 1;
  private readonly topDay = new Color('#3F8FE0');
  private readonly topEve = new Color('#6E7BC4');
  private readonly topNight = new Color('#121630');
  private readonly topOvercast = new Color('#8E98A6');
  private readonly topStorm = new Color('#3A4250');
  private readonly sunDay = new Color('#FFF3E0');
  private readonly sunMorning = new Color('#FFCB8A');
  private readonly sunEve = new Color('#FF8C4A');
  private readonly skyMorning = new Color('#FFDDBA');
  private readonly sunNight = new Color('#7F90C8');
  private readonly skyDay = new Color('#C4E4FF');
  private readonly skyEve = new Color('#F7B57E');
  private readonly skyNight = new Color('#2D3250');
  private readonly skyOvercast = new Color('#C3C9CF');
  private readonly skyStorm = new Color('#626C78');
  private readonly groundDay = new Color('#7E9E6A');
  private readonly groundNight = new Color('#2A3328');
  private readonly flashColour = new Color('#E6EEFF');
  private readonly fog: Fog;

  constructor(scene: Scene) {
    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    // Soft edges: the sun is a disc, not a point.
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    this.hemi = new HemisphereLight(this.skyDay, this.groundDay, 1.15);
    this.ambient = new AmbientLight(0xffffff, 0.16);
    scene.add(this.sun, this.sun.target, this.hemi, this.ambient);
    scene.background = this.sky;
    this.fog = new Fog(this.sky, 55, 210);
    scene.fog = this.fog;
  }

  /**
   * t = 0 at 08:00, 1 at 20:00. night = true after closing. focus and radius frame the sun's shadow
   * round what the camera looks at.
   */
  setTime(t: number, night: boolean, focus: Vector3, radius: number, w: SkyWeather = CLEAR_SKY): void {
    const tt = Math.max(0, Math.min(1, t));
    // The sun's path: up from the morning (about 20 degrees at opening), highest a little after noon,
    // down to a few degrees at closing for long evening shadows.
    const elev = night ? 0.5 : Math.max(0.07, 0.36 + 0.78 * Math.sin(Math.PI * Math.min(1, tt * 0.92 + 0.02)) - 0.3 * Math.max(0, tt - 0.7) / 0.3);
    const az = -1.0 + tt * 2.0;
    const dir = this.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev) * 0.6 + 0.4).normalize();
    this.sun.position.copy(focus).addScaledVector(dir, 60);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    const r = Math.max(10, Math.min(radius, 34));
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.updateProjectionMatrix();
    const evening = Math.max(0, (tt - 0.6) / 0.4);
    const morning = Math.max(0, 1 - tt / 0.3);
    // Cloud dims the sun and greys the sky; a storm darkens both; rain hangs in the air.
    const cover = Math.max(0, Math.min(1, w.cloud));
    const dull = Math.max(0, Math.min(1, (cover - 0.35) / 0.65));
    const storm = Math.max(0, Math.min(1, w.storm));
    if (night) {
      this.sun.color.copy(this.sunNight); this.sun.intensity = 1.1 * (1 - 0.6 * dull);
      this.sky.copy(this.skyNight).lerp(this.skyStorm, storm * 0.3);
      this.skyTop.copy(this.topNight);
      this.hemi.color.set('#6D7BB8'); this.hemi.groundColor.copy(this.groundNight); this.hemi.intensity = 1.2;
      this.ambient.color.set('#FFD9A8'); this.ambient.intensity = 0.4;
      this.sunVisible = 0;
    } else {
      this.sun.color.copy(this.sunDay).lerp(this.sunMorning, morning * 0.8).lerp(this.sunEve, evening * evening * 0.95);
      this.sun.intensity = (2.85 - 0.4 * morning - 1.1 * evening * evening) * (1 - 0.82 * dull) * (1 - 0.5 * storm);
      this.sky.copy(this.skyDay).lerp(this.skyMorning, morning * 0.5).lerp(this.skyEve, evening * evening * 0.85);
      this.sky.lerp(this.skyOvercast, dull * 0.9).lerp(this.skyStorm, storm * 0.85);
      this.skyTop.copy(this.topDay).lerp(this.topEve, evening * evening).lerp(this.topOvercast, dull * 0.95).lerp(this.topStorm, storm * 0.9);
      // The fill: the sky's own colour from above, sunlit grass bouncing up from below. Under cloud the
      // fill takes over from the sun, so it brightens a little as the sun goes.
      this.hemi.color.copy(this.sky); this.hemi.groundColor.copy(this.groundDay);
      this.hemi.intensity = (1.15 + 0.45 * dull) * (1 - 0.6 * storm) * (1 - 0.15 * w.rain);
      this.ambient.color.set('#FFFFFF'); this.ambient.intensity = 0.16 + 0.1 * dull;
      this.sunVisible = 1 - dull;
    }
    // Shadows fade as the cloud thickens: none at all under a full overcast.
    this.sun.shadow.intensity = 1 - 0.9 * dull;
    // Lightning: everything flooded blue-white for a blink.
    const flash = Math.max(0, Math.min(1, w.flash));
    if (flash > 0) {
      this.hemi.color.lerp(this.flashColour, flash); this.hemi.intensity += 3.5 * flash;
      this.sky.lerp(this.flashColour, flash * 0.7); this.skyTop.lerp(this.flashColour, flash * 0.5);
    }
    // Haze: rain and fog pull the far side of town into the sky's colour.
    const thick = Math.max(w.rain * 0.7, w.fog);
    this.fog.color.copy(this.sky);
    this.fogScale = 1 - 0.65 * thick;
    skyUniforms.uSkyTop.value.copy(this.skyTop); skyUniforms.uSkyHorizon.value.copy(this.sky);
    skyUniforms.uSunDir.value.copy(this.sunDir); skyUniforms.uSunCol.value.copy(this.sun.color).multiplyScalar(this.sunVisible);
  }
  /** Rain and mist bring the haze in (the renderer scales its fog distances by this). */
  fogScale = 1;
}
