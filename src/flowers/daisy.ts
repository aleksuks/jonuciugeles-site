import { BufferGeometry, Color, Float32BufferAttribute, SphereGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { deg, mulberry32 } from './rng';
import { makePetal, merge, paletteColor, petalMatrix, placed } from './petal';
import { lin, receptacle } from './leaves';
import type { Bloom } from './leaves';

/** Domed disc of florets: a hex lattice of bumps (the florets), orange-brown at the heart, yellow outward. */
function daisyCentre(variant: number): BufferGeometry {
  const R = 0.021;
  let g: BufferGeometry = new SphereGeometry(R, 44, 14, 0, Math.PI * 2, 0, 1.4);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  g.scale(1, 0.5, 1);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const spacing = 0.0046;
  const f = (Math.PI * 2) / spacing;
  const rnd = mulberry32(88 + variant);
  const ph = rnd() * 6;
  const heart = new Color('#b4701a');
  const mid = new Color('#e8b21f');
  const rim = new Color('#d89a1c');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = (Math.cos(f * x + ph) + Math.cos(f * (0.5 * x + 0.866 * z)) + Math.cos(f * (0.5 * x - 0.866 * z))) / 3;
    const r = Math.hypot(x, z) / R;
    const lift = 0.0011 * (h + 0.5) * Math.min(1, 0.4 + r * 1.2);
    const len = Math.hypot(x, y, z) || 1;
    pos.setXYZ(i, x + (x / len) * lift, y + (y / len) * lift, z + (z / len) * lift);
    c.copy(heart).lerp(mid, Math.min(1, Math.pow(r, 0.7) * 1.3)).lerp(rim, Math.pow(r, 5) * 0.8);
    const shade = 0.72 + 0.5 * (h + 0.5);
    col[i * 3] = c.r * shade; col[i * 3 + 1] = c.g * shade; col[i * 3 + 2] = c.b * shade;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Daisy: 26 narrow rays in two staggered rings with random droop, around a domed textured centre. */
export function buildDaisy(variant: number): Bloom {
  const rnd = mulberry32(2024 + variant * 19);
  const parts: BufferGeometry[] = [];
  const perRing = 13;
  for (let ring = 0; ring < 2; ring++) {
    for (let k = 0; k < perRing; k++) {
      const yaw = ((k + ring * 0.5) / perRing) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
      const g = makePetal({
        length: 0.066 * (0.88 + rnd() * 0.22), width: 0.0135 * (0.9 + rnd() * 0.2), nu: 4, nv: 8,
        widest: 0.72, baseWidth: 0.5, tipPow: 2.2, cup: 0.7, cupBase: 0.6,
        bend: deg(-(4 + rnd() * 26)), bendPow: 1.7, ruffle: 0.0007, ruffleFreq: 2.5, seed: 9 + k * 5 + ring * 71 + variant,
        color: paletteColor({ ao0: 0.55, shade: ring === 0 ? 0.88 : 1, gScale: 1, accent: 0.05, accentEdge: 0.7 }),
      });
      placed(g, petalMatrix(yaw, ring * 0.0035, 0.017, deg((ring === 0 ? 84 : 74) + (rnd() - 0.5) * 8)));
      parts.push(g);
    }
  }
  const petals = merge(parts);
  const f = receptacle(0.013, -0.01, 0, 0, { dark: lin('#4d6b34'), light: lin('#6b8a42') });
  return { petals, foliage: merge(f), centre: daisyCentre(variant), pickRadius: 0.1, pickY: 0.01 };
}

