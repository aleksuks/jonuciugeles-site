import { deg, mulberry32 } from './rng';
import { directColor, makePetal, merge, paletteColor, petalMatrix, placed } from './petal';
import { lin, receptacle } from './leaves';
import type { Bloom } from './leaves';
import type { BufferGeometry } from 'three';

/** Tulip: three outer and three inner tepals closing into a goblet, plus two arching blade leaves. */
export function buildTulip(variant: number): Bloom {
  const rnd = mulberry32(555 + variant * 31);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const outer = i % 2 === 0;
    const yaw = (i / 6) * Math.PI * 2 + (rnd() - 0.5) * 0.1;
    const g = makePetal({
      length: (outer ? 0.118 : 0.1) * (0.97 + rnd() * 0.06),
      width: (outer ? 0.074 : 0.064) * (0.97 + rnd() * 0.06),
      nu: 8,
      nv: 12,
      widest: 0.42,
      baseWidth: 0.8,
      tipPow: 1.55,
      cup: outer ? 0.85 : 0.95,
      cupBase: 0.8,
      bend: deg(outer ? 36 : 30),
      bendPow: 1.5,
      lipRoll: outer ? deg(16) : deg(10),
      lipStart: 0.8,
      ruffle: 0.0008,
      ruffleFreq: 3,
      seed: 5 + i * 9 + variant,
      color: paletteColor({
        ao0: outer ? 0.6 : 0.5,
        shade: outer ? 1 : 0.9,
        gScale: 0.95,
        gBias: rnd() * 0.18,
        accent: rnd() * 0.3,
        accentEdge: 0.9,
        stripe: outer ? 0.6 : 0.35,
      }),
    });
    placed(g, petalMatrix(yaw, outer ? 0 : 0.002, outer ? 0.0105 : 0.008, deg(outer ? 20 : 15)));
    parts.push(g);
  }
  const petals = merge(parts);

  const f: BufferGeometry[] = receptacle(0.0125, 0.006, 3, 0.03, { dark: lin('#4a6a3a'), light: lin('#7d9a5c') }, 0.3, 0.0095);
  const base = lin('#2f4a2a');
  const tip = lin('#6b8f58');
  for (let k = 0; k < 2; k++) {
    const g = makePetal({
      length: k === 0 ? 0.27 : 0.22, width: k === 0 ? 0.052 : 0.045, nu: 4, nv: 14, widest: 0.3, baseWidth: 0.22, tipPow: 1.25,
      cup: 0.9, cupBase: 1.8, bend: -0.95, bendPow: 1.7, fold: 0.1, ruffle: 0.0015, ruffleFreq: 3, seed: 71 + k + variant,
      color: directColor(base, tip, 0.65),
    });
    f.push(placed(g, petalMatrix(k * Math.PI + 0.5 + variant * 0.9, k === 0 ? -0.33 : -0.29, 0.005, deg(4))));
  }
  return { petals, foliage: merge(f), pickRadius: 0.085, pickY: 0.05 };
}

