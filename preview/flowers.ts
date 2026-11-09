// Dev-only preview of the generated flowers. Not part of the app.
//   /preview/flowers.html                               all five varieties in a row
//   /preview/flowers.html?variety=rose&close=1          close-up of one variety
// Extra params: pal=<palette index>, seed=<n>, polar=<rad>, az=<rad>, zoom=<multiplier>, tilt=<rad>, quality=<tier>
import { Vector3 } from 'three';
import { CameraRig } from '../src/scene/cameraRig';
import { createStage } from '../src/scene/stage';
import { VARIETIES, createFlower, triangleReport } from '../src/flowers';
import type { VarietyId } from '../src/types';

const q = new URLSearchParams(window.location.search);
const stage = createStage(document.getElementById('stage') as HTMLCanvasElement);
const rig = new CameraRig(stage.camera);
stage.onResize((_w, _h, a) => rig.setAspect(a));
rig.setAspect(stage.camera.aspect);

const pal = Number(q.get('pal') ?? 0);
const seed = Number(q.get('seed') ?? 1);
const close = q.get('close') === '1';
const only = (q.get('variety') ?? 'rose') as VarietyId;

const CLOSE_ZOOM: Record<VarietyId, number> = { rose: 0.5, peony: 0.55, tulip: 0.6, daisy: 0.5, eucalyptus: 1.6 };

const report: Record<string, unknown> = {};
const heads: Vector3[] = [];
const list = close ? VARIETIES.filter((v) => v.id === only) : VARIETIES;
list.forEach((v, i) => {
  const x = close ? 0 : (i - (list.length - 1) / 2) * 0.27;
  const f = createFlower(v.id, { paletteIndex: pal, seed: seed + i });
  const tilt = Number(q.get('tilt') ?? (close ? 0 : (i % 2 ? 0.08 : -0.06)));
  const root = new Vector3(x, 0.08, 0);
  const head = new Vector3(x + Math.sin(tilt) * 0.66, 0.08 + Math.cos(tilt) * 0.66, 0);
  f.setPose(root, head, i * 0.7);
  f.object.traverse((o) => { if (o.type === 'Mesh' && o.name !== 'pick') o.castShadow = o.receiveShadow = true; });
  stage.scene.add(f.object);
  heads.push(head);
  report[v.id] = triangleReport(v.id, (seed + i) % 3);
  if (q.get('hi') === '1') f.setHighlighted(true);
});
console.log('triangles', JSON.stringify(report));

if (close) {
  const h = heads[0];
  rig.target.set(h.x, h.y + (only === 'eucalyptus' ? -0.14 : 0.03), 0);
  rig.polar = Number(q.get('polar') ?? 1.2);
  rig.azimuth = Number(q.get('az') ?? 0.5);
  rig.zoomBy(0.45);
} else {
  rig.target.set(0, 0.5, 0);
  rig.polar = Number(q.get('polar') ?? 1.3);
  rig.azimuth = Number(q.get('az') ?? 0.3);
  rig.zoomBy(Number(q.get('zoom') ?? 1.5));
}
rig.update(10);
if (close) {
  // pull the camera nearer than the rig allows, for a detailed look
  const k = Number(q.get('zoom') ?? CLOSE_ZOOM[only]);
  const off = stage.camera.position.clone().sub(rig.target);
  stage.camera.position.copy(rig.target).addScaledVector(off, k);
  stage.camera.lookAt(rig.target);
}
stage.setFocus(rig.target);

declare global {
  interface Window { __preview: { ready: boolean; report: Record<string, unknown>; rig: CameraRig }; }
}
window.__preview = { ready: false, report, rig };

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!close) rig.update(dt);
  stage.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void stage.ready.then(() => {
  const f0 = stage.stats.frames;
  const t = setInterval(() => {
    if (stage.stats.frames > f0 + 6) { window.__preview.ready = true; clearInterval(t); }
  }, 100);
});
if (q.get('noshadow') === '1') stage.keyLight.castShadow = false;
{
  const ss = q.get('ss');
  if (ss) {
    const side = ss === 'front' ? 0 : ss === 'back' ? 1 : 2;
    stage.scene.traverse((o) => {
      const m = (o as { material?: { shadowSide?: number | null } }).material;
      if (m && 'shadowSide' in m) m.shadowSide = side;
    });
  }
}
