import { lerp, deg, mulberry32, GOLDEN_ANGLE } from './rng';
import { makePetal, merge, paletteColor, petalMatrix, placed } from './petal';
import { compoundLeaf, lin, receptacle } from './leaves';
import type { Bloom } from './leaves';
import type { BufferGeometry } from 'three';

/**
 * Peony: a lot of wide, crumpled petals with irregular margins stacked in a rounded dome. The outer guard
 * petals sit nearly flat, the heart is a dense ruffled pom.
 */
export function buildPeony(variant: number): Bloom {
  const rnd = mulberry32(977 + variant * 57);
  const N = 34;
  const NI = 14; // small crumpled petals forming the pom
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const yaw = i * GOLDEN_ANGLE + (rnd() - 0.5) * 0.2;
    const inner = i < NI;
    const k = inner ? i / (NI - 1) : (i - NI) / (N - NI - 1); // 0 = innermost of its group
    // globe: petals leave the base leaning out, then curve back in over the top
    const len = inner ? lerp(0.05, 0.076, k) : lerp(0.084, 0.1, k);
    const wid = inner ? lerp(0.04, 0.062, k) : lerp(0.085, 0.1, k);
    const tilt = inner ? lerp(0, 8, k) : lerp(26, 46, k);
    const bend = inner ? lerp(48, 60, k) : lerp(66, 82, k);
    const g = makePetal({
      length: len * (0.95 + rnd() * 0.1),
      width: wid * (0.95 + rnd() * 0.1),
      nu: inner ? 6 : 8,
      nv: inner ? 9 : 10,
      widest: 0.55,
      baseWidth: inner ? 0.5 : 0.75,
      tipPow: 2.1,
      cup: inner ? lerp(1.1, 0.85, k) : lerp(0.8, 0.65, k),
      cupBase: 0.7,
      bend: deg(bend),
      bendPow: 1.7,
      lipRoll: inner ? 0 : deg(lerp(14, 26, k)),
      lipStart: 0.78,
      edgeCurl: inner ? 0 : 0.12,
      ruffle: inner ? 0.002 : lerp(0.006, 0.008, k),
      ruffleFreq: inner ? 2.4 : 2.0,
      scallop: 0,
      tDist: inner ? 1.15 : 1.6,
      seed: 3 + i * 17 + variant * 53,
      color: paletteColor({
        ao0: lerp(0.55, 0.7, s),
        shade: lerp(0.62, 1, Math.pow(s, 0.5)),
        gScale: lerp(0.45, 1, s),
        gBias: 0,
        accent: rnd() * 0.15,
        accentEdge: 0.7,
      }),
    });
    const r0 = inner ? 0.004 + 0.009 * k : 0.026 + 0.004 * k;
    const h0 = inner ? lerp(0.004, 0.001, k) : lerp(0, -0.01, k);
    placed(g, petalMatrix(yaw, h0, r0, deg(tilt)));
    parts.push(g);
  }
  const petals = merge(parts);

  const leafDark = lin('#1f3a22');
  const leafTip = lin('#4d7140');
  const f: BufferGeometry[] = receptacle(0.018, -0.008, 5, 0.045, { dark: lin('#35532b'), light: lin('#628443') }, rnd() * 6, 0.009);
  const leafYs = [-0.11, -0.19, -0.27];
  for (let k = 0; k < 3; k++) {
    f.push(...compoundLeaf({
      az: k * 2.2 + rnd() * 0.8 + variant, y: leafYs[k], tilt: deg(72 + rnd() * 12), scale: 1.05 - k * 0.06,
      leaflets: 3, length: 0.07, width: 0.04, seed: 80 + k + variant * 7, base: leafDark, tip: leafTip,
    }));
  }
  return { petals, foliage: merge(f), pickRadius: 0.125, pickY: 0.02 };
}
