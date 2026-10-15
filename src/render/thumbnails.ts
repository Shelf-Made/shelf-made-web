import { Scene, PerspectiveCamera, Mesh, WebGLRenderTarget, SRGBColorSpace, HemisphereLight, DirectionalLight, Color, Vector3, AnimationMixer, type WebGLRenderer, type Object3D, type SkinnedMesh } from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetLibrary } from './assets';
import { productGeometry } from './storeArt';

/**
 * A small picture of every product, rendered once at load from the same model that stands on the
 * shelves (a three-quarter view in the style of Kenney's own previews), as PNG data URLs for the cards.
 * Rendered at twice the size without antialiasing and scaled down, which smooths the edges.
 */
export function renderProductThumbs(renderer: WebGLRenderer, assets: AssetLibrary, ids: string[], size = 96): Record<string, string> {
  return renderThumbs(renderer, ids, size, (scene, cam, id) => {
    const g = productGeometry(assets, id);
    g.computeBoundingSphere();
    const s = g.boundingSphere!;
    const mesh = new Mesh(g, assets.plainMaterial);
    mesh.position.set(-s.center.x, -s.center.y, -s.center.z);
    scene.add(mesh);
    const dist = (s.radius * 1.08) / Math.sin((cam.fov / 2) * Math.PI / 180);
    cam.position.copy(VIEW).multiplyScalar(dist);
    cam.lookAt(0, 0, 0);
    return mesh;
  });
}

/** Head-and-shoulders portraits of the characters (for the manager designer), standing in their idle pose. */
export function renderCharacterThumbs(renderer: WebGLRenderer, assets: AssetLibrary, ids: string[], size = 96): Record<string, string> {
  return renderThumbs(renderer, ids, size, (scene, cam, id) => {
    const a = assets.character(id);
    const root = skeletonClone(a.scene);
    root.traverse((o) => { const m = o as SkinnedMesh; if (m.isSkinnedMesh || (o as Mesh).isMesh) { (o as Mesh).material = assets.plainMaterial; m.frustumCulled = false; } });
    const idle = a.clips.find((c) => c.name === 'idle');
    if (idle) { const mx = new AnimationMixer(root); mx.clipAction(idle).play(); mx.update(0.01); }
    root.updateMatrixWorld(true);
    scene.add(root);
    cam.position.set(0.32, 0.66, 1.45);
    cam.lookAt(0, 0.5, 0);
    return root;
  });
}

const VIEW = new Vector3(1, 0.85, 1.5).normalize();

/** Render one small picture per id: `stage` puts the subject in the scene and aims the camera, returning what to take out after. */
function renderThumbs(renderer: WebGLRenderer, ids: string[], size: number, stage: (scene: Scene, cam: PerspectiveCamera, id: string) => Object3D): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof document === 'undefined') return out;
  const px = size * 2;
  const rt = new WebGLRenderTarget(px, px);
  rt.texture.colorSpace = SRGBColorSpace;
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 2.0);
  sun.position.set(1.5, 3, 2.5);
  scene.add(new HemisphereLight('#FFFFFF', '#C9B79C', 1.9), sun);
  const cam = new PerspectiveCamera(24, 1, 0.01, 50);
  const buf = new Uint8Array(px * px * 4);
  const big = document.createElement('canvas'); big.width = big.height = px;
  const small = document.createElement('canvas'); small.width = small.height = size;
  const bctx = big.getContext('2d'), sctx = small.getContext('2d');
  if (!bctx || !sctx) return out;
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new Color()), prevAlpha = renderer.getClearAlpha();
  const shadows = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(0x000000, 0);
  try {
    for (const id of ids) {
      const subject = stage(scene, cam, id);
      cam.updateMatrixWorld();
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
      // WebGL rows run bottom-up.
      const img = bctx.createImageData(px, px);
      for (let y = 0; y < px; y++) img.data.set(buf.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);
      bctx.putImageData(img, 0, 0);
      sctx.clearRect(0, 0, size, size);
      sctx.drawImage(big, 0, 0, size, size);
      out[id] = small.toDataURL('image/png');
      scene.remove(subject);
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.enabled = shadows;
    rt.dispose();
  }
  return out;
}
