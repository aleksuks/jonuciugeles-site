import { lerp, deg, mulberry32, GOLDEN_ANGLE } from './rng';
import { makePetal, merge, paletteColor, petalMatrix, placed } from './petal';
import { compoundLeaf, lin, receptacle } from './leaves';
import type { Bloom } from './leaves';
import type { BufferGeometry } from 'three';

/**
 * Rose, bloom origin at the receptacle, +Y outward. 23 petals on a golden-angle spiral: a tightly wrapped
 * bud in the middle (wide, strongly cupped, bent inward), then cupped mid petals, then outer petals that
 * splay and roll their lips back.
 */
export function buildRose(variant: number): Bloom {
  const rnd = mulberry32(31 + variant * 101);
  const N = 24;
  const parts: BufferGeometry[] = [];
  const NI = 11; // wrapped bud petals
  const NM = 6; // cupped middle petals
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const yaw = i * GOLDEN_ANGLE + (rnd() - 0.5) * 0.14;
    const phase = i < NI ? 0 : i < NI + NM ? 1 : 2;
    const k = phase === 0 ? i / (NI - 1) : phase === 1 ? (i - NI) / (NM - 1) : (i - NI - NM) / (N - NI - NM - 1);
    let r0: number, len: number, wid: number, cup: number, tilt: number, bend: number, lip: number, curl: number;
    if (phase === 0) {
      // concentric wrap: each layer's arc is centred on the axis, so layers nest into a spiral
      r0 = 0.0045 + 0.0019 * i;
      cup = lerp(1.4, 1.2, k);
      wid = 2 * cup * r0 * 1.12;
      len = lerp(0.05, 0.074, k);
      tilt = deg(lerp(0, 3, k));
      bend = (1.55 * r0) / len;
      lip = k > 0.6 ? deg((k - 0.6) * 50) : 0;
      curl = 0;
    } else if (phase === 1) {
      r0 = lerp(0.027, 0.029, k);
      cup = lerp(0.95, 0.8, k);
      wid = lerp(0.064, 0.078, k);
      len = lerp(0.076, 0.085, k);
      tilt = deg(lerp(5, 16, k));
      bend = deg(lerp(32, 22, k));
      lip = deg(lerp(20, 34, k));
      curl = lerp(0.1, 0.2, k);
    } else {
      r0 = 0.031;
      cup = lerp(0.7, 0.6, k);
      wid = lerp(0.082, 0.09, k);
      len = lerp(0.074, 0.07, k);
      tilt = deg(lerp(20, 34, k));
      bend = deg(lerp(20, 12, k));
      lip = deg(lerp(42, 56, k));
      curl = lerp(0.22, 0.38, k);
    }
    const inner = phase === 0;
    const g = makePetal({
      length: len * (0.96 + rnd() * 0.08),
      width: wid * (0.97 + rnd() * 0.06),
      nu: inner ? 6 : 10,
      nv: inner ? 8 : 13,
      widest: phase === 0 ? 0.55 : 0.62,
      baseWidth: phase === 0 ? 0.6 : 0.7,
      tipPow: 2.2,
      cup,
      cupBase: phase === 0 ? 0.9 : 0.75,
      bend,
      bendPow: phase === 0 ? 2 : 2.2,
      lipRoll: lip,
      lipStart: phase === 0 ? 0.8 : 0.62,
      edgeCurl: curl,
      ruffle: lerp(0.0004, 0.0018, s),
      ruffleFreq: 2.6,
      scallop: 0,
      tDist: 1.6,
      seed: 7 + i * 13 + variant * 101,
      color: paletteColor({
        ao0: lerp(0.6, 0.7, s),
        shade: lerp(0.75, 1, Math.pow(s, 0.55)),
        gScale: lerp(0.5, 1, s),
        gBias: 0,
        accent: rnd() * 0.12,
        accentEdge: 0.8,
      }),
    });
    placed(g, petalMatrix(yaw, lerp(0.004, -0.01, s), r0, tilt));
    parts.push(g);
  }
  const petals = merge(parts);

  const leafDark = lin('#26401f');
  const leafTip = lin('#5b7d3a');
  const f: BufferGeometry[] = receptacle(0.015, -0.006, 5, 0.04, { dark: lin('#3b5a2b'), light: lin('#6c8a45') }, rnd() * 6);
  const leafYs = [-0.1, -0.175, -0.25];
  for (let k = 0; k < 3; k++) {
    f.push(...compoundLeaf({
      az: k * 2.4 + rnd() * 0.8 + variant, y: leafYs[k], tilt: deg(68 + rnd() * 14), scale: 1 - k * 0.07,
      leaflets: 3, length: 0.062, width: 0.036, seed: 50 + k + variant * 9, base: leafDark, tip: leafTip,
    }));
  }
  return { petals, foliage: merge(f), pickRadius: 0.115, pickY: 0.03 };
}
