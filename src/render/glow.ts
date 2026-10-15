import { MeshBasicMaterial, CircleGeometry, Float32BufferAttribute, AdditiveBlending, Color, type BufferGeometry } from 'three';

/**
 * What lights up at night. Glowing surfaces are drawn brighter than anything the sun can light
 * (colour channels above 1), so the bloom picks out windows, signs and lamps and nothing else.
 */
export const WINDOW_GLOW = new MeshBasicMaterial({ color: new Color(2.3, 1.85, 1.1) });
export const LAMP_GLOW = new MeshBasicMaterial({ color: new Color(2.6, 2.2, 1.5) });
/** Lit sign letters: just over the bloom threshold, so they glow softly and stay readable. */
export const SIGN_GLOW = new MeshBasicMaterial({ color: new Color(1.85, 1.7, 1.35) });

/** Light spilling onto the pavement: a warm pool that fades to nothing at its rim, added on top of the ground. */
export const SPILL = new MeshBasicMaterial({ color: new Color('#FFD27A'), vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });

/** A pool of light rx by rz, lying flat at (x, y, z). Brightest in the middle. */
export function spillGeometry(rx: number, rz: number, x = 0, y = 0.02, z = 0, strength = 0.55): BufferGeometry {
  const g = new CircleGeometry(1, 18).rotateX(-Math.PI / 2).scale(rx, 1, rz).translate(x, y, z);
  const n = g.getAttribute('position').count, c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const a = i === 0 ? strength : 0; c[i * 4] = c[i * 4 + 1] = c[i * 4 + 2] = a; c[i * 4 + 3] = a; }
  g.setAttribute('color', new Float32BufferAttribute(c, 4));
  return g;
}
