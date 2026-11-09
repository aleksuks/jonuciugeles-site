import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig, FRAME_RADIUS_EXPLODED } from '../src/scene/cameraRig';
import { BLOOM_RADIUS } from '../src/bouquet/layout';
import type { VarietyId } from '../src/types';
import { Sim } from './helpers';

// Apparent on-screen radius (world units) of each bloom from the default camera. Measured from renders:
// roses and peonies are round heads, daisies are wide flat discs, eucalyptus sprays are wide leafy fans.
const APPARENT: Record<VarietyId, number> = { rose: 0.07, peony: 0.08, tulip: 0.045, daisy: 0.09, eucalyptus: 0.085 };
void BLOOM_RADIUS;

const LAYOUTS = {
  landscape: { w: 1280, h: 800, free: { x: 380, y: 0, w: 900, h: 800 } },
  portrait: { w: 390, h: 844, free: { x: 0, y: 62, w: 390, h: 550 } },
};

/** Worst pairwise overlap of projected blooms, as a fraction of the smaller bloom's radius (0 = apart, 1 = one covers the other's centre). */
function projected(exploded: boolean, layout: keyof typeof LAYOUTS, n = 17, seed = 7) {
  const L = LAYOUTS[layout];
  const s = new Sim(1 / 60, { seed });
  const kinds: VarietyId[] = ['rose', 'tulip', 'daisy', 'peony', 'eucalyptus'];
  for (let i = 0; s.b.flowers.length < n; i++) s.add(kinds[i % 5], 0);
  s.b.setExploded(exploded);
  s.run(5);
  const cam = new PerspectiveCamera(35, L.w / L.h, 0.05, 150);
  const rig = new CameraRig(cam);
  rig.setAspect(L.w / L.h);
  rig.setFreeRect(L.free, L.w, L.h);
  rig.setFrameRadius(exploded ? FRAME_RADIUS_EXPLODED : 0.52);
  rig.update(0);
  cam.updateMatrixWorld();
  const px = s.b.flowers.map((f) => {
    const h = s.visuals.get(f.id)!.head.clone();
    const along: Record<VarietyId, number> = { rose: 0.03, peony: 0.02, tulip: 0.05, daisy: 0.01, eucalyptus: -0.14 };
    const u = h.clone().sub(new Vector3(0, 0.35, 0)).normalize();
    h.addScaledVector(u, along[f.variety]); // visible bloom centre, from the pick sphere offset
    const v = h.clone().project(cam);
    const depth = h.clone().applyMatrix4(cam.matrixWorldInverse).z;
    const ppu = L.h / (2 * Math.tan((cam.fov * Math.PI) / 360) * -depth); // pixels per world unit at that depth
    return { x: ((v.x + 1) / 2) * L.w, y: ((1 - v.y) / 2) * L.h, r: APPARENT[f.variety] * ppu, v: f.variety };
  });
  let worst = 0;
  let pair = '';
  for (let i = 0; i < px.length; i++)
    for (let j = i + 1; j < px.length; j++) {
      const d = Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y);
      const o = (px[i].r + px[j].r - d) / Math.min(px[i].r, px[j].r);
      if (o > worst) { worst = o; pair = `${px[i].v}/${px[j].v}`; }
    }
  const inFrame = px.every((p) => p.x - p.r >= 0 && p.x + p.r <= L.w && p.y - p.r >= 0 && p.y + p.r <= L.h);
  return { worst, pair, inFrame };
}

describe('projected bloom overlap across seeds (the app uses seed 1)', () => {
  for (const layout of ['landscape', 'portrait'] as const) {
    it(`starter, ${layout}, seeds 1-8`, () => {
      let worst = 0;
      let at = '';
      for (let seed = 1; seed <= 8; seed++) {
        const r = projected(true, layout, 17, seed);
        if (r.worst > worst) { worst = r.worst; at = `seed ${seed} ${r.pair}`; }
      }
      console.log(`[projected overlap] starter ${layout} over seeds 1-8: worst ${(worst * 100).toFixed(0)}% (${at})`);
      expect(worst).toBeLessThan(0.1);
    });
  }
});

describe('projected bloom overlap from the default camera (exploded)', () => {
  for (const layout of ['landscape', 'portrait'] as const) {
    it(`starter, ${layout}: blooms are separate on screen and in frame`, () => {
      const r = projected(true, layout);
      console.log(`[projected overlap] starter ${layout}: worst ${(r.worst * 100).toFixed(0)}% of the smaller bloom (${r.pair || 'none'})`);
      expect(r.worst).toBeLessThan(0.1);
      expect(r.inFrame).toBe(true);
    });
    it(`25 flowers, ${layout}: stays in frame, overlap reported`, () => {
      const r = projected(true, layout, 25);
      console.log(`[projected overlap] 25 flowers ${layout}: worst ${(r.worst * 100).toFixed(0)}% (${r.pair || 'none'})`);
      expect(r.inFrame).toBe(true);
      expect(r.worst).toBeLessThan(0.6);
    });
  }
});
