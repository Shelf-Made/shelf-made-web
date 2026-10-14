/* global process, console */
/** Print node boxes of GLB models: node tools/measure.mjs <dir> <name>... */
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
const C = process.argv[2];
for (const f of process.argv.slice(3)) {
  const d = await io.read(`${C}/${f}.glb`);
  const out = [];
  // world transform of each node with mesh
  const walk = (n, m) => {
    const t = n.getTranslation(); const nm = n.getName();
    const p = [m[0] + t[0], m[1] + t[1], m[2] + t[2]];
    if (n.getMesh()) {
      let lo=[9,9,9], hi=[-9,-9,-9];
      for (const pr of n.getMesh().listPrimitives()) { const a = pr.getAttribute('POSITION'); const v=[0,0,0]; for (let i=0;i<a.getCount();i++){a.getElement(i,v); for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],v[k]+p[k]);hi[k]=Math.max(hi[k],v[k]+p[k]);}} }
      out.push(`${nm} pos=${p.map(x=>x.toFixed(3))} box=[${lo.map(x=>x.toFixed(2))}]..[${hi.map(x=>x.toFixed(2))}] rot=${n.getRotation().map(x=>x.toFixed(2))}`);
    }
    for (const c of n.listChildren()) walk(c, p);
  };
  for (const n of d.getRoot().listScenes()[0].listChildren()) walk(n, [0,0,0]);
  console.log('==', f); console.log(out.join('\n'));
}
