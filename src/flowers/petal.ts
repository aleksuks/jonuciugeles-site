import { BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp01, lerp, noise2, sstep } from './rng';

/** Returns the three vertex-colour channels for a point on a petal (u in -1..1 across, t in 0..1 base to tip). */
export type ColorFn = (u: number, t: number, absU: number) => [number, number, number];

export interface PetalParams {
  length: number;
  width: number;
  nu: number;
  nv: number;
  /** Where along the length the petal is widest (0..1). */
  widest?: number;
  /** Width at the base as a fraction of the widest. */
  baseWidth?: number;
  /** Tip exponent: 2 = elliptical, ~1.2 = pointed. */
  tipPow?: number;
  /** Half wrap angle of the cross-section arc at the tip (rad). */
  cup?: number;
  /** Cup at the base as a fraction of the tip cup. */
  cupBase?: number;
  /** Total inward bend along the length (rad, +ve curls toward the concave side). */
  bend?: number;
  bendPow?: number;
  /** Outward roll of the tip, a rolled lip (rad). */
  lipRoll?: number;
  lipStart?: number;
  /** Sides rolled backwards, as a fraction of the local half width. */
  edgeCurl?: number;
  ruffle?: number;
  ruffleFreq?: number;
  /** Irregular edge width, fraction. */
  scallop?: number;
  /** V-fold along the midrib (+ve = trough). */
  fold?: number;
  /** >1 packs rows toward the tip, where the outline curves most. */
  tDist?: number;
  seed?: number;
  color: ColorFn;
}

function profile(t: number, widest: number, baseW: number, q: number): number {
  if (t < widest) {
    const k = t / widest;
    return baseW + (1 - baseW) * Math.sin((k * Math.PI) / 2);
  }
  const k = ((t - widest) / (1 - widest)) * 0.997;
  return Math.pow(Math.max(0, 1 - Math.pow(k, q)), 1 / q);
}

/**
 * One curved petal or leaf blade. Base at the origin, length along +Y, width along X, concave side toward +Z.
 * Attributes: position, normal, uv (u across, v along), color (see ColorFn).
 */
export function makePetal(p: PetalParams): BufferGeometry {
  const L = p.length;
  const W = p.width;
  const { nu, nv } = p;
  const widest = p.widest ?? 0.6;
  const baseW = p.baseWidth ?? 0.35;
  const q = p.tipPow ?? 2;
  const cup = p.cup ?? 0.5;
  const cupBase = p.cupBase ?? 0.7;
  const bend = p.bend ?? 0;
  const bendPow = p.bendPow ?? 2;
  const lip = p.lipRoll ?? 0;
  const lipStart = p.lipStart ?? 0.65;
  const edgeCurl = p.edgeCurl ?? 0;
  const ruffle = p.ruffle ?? 0;
  const rf = p.ruffleFreq ?? 4;
  const scallop = p.scallop ?? 0;
  const fold = p.fold ?? 0;
  const seed = p.seed ?? 1;
  const tDist = p.tDist ?? 1.5;
  const tAt = (j: number): number => 1 - Math.pow(1 - j / nv, tDist);

  const theta = (t: number): number => bend * Math.pow(t, bendPow) - lip * Math.pow(sstep(t, lipStart, 1), 2);
  const cy = new Float32Array(nv + 1);
  const cz = new Float32Array(nv + 1);
  const th = new Float32Array(nv + 1);
    th[0] = theta(0);
  for (let j = 1; j <= nv; j++) {
    const tm = theta(tAt(j - 0.5));
    const dl = L * (tAt(j) - tAt(j - 1));
    cy[j] = cy[j - 1] + dl * Math.cos(tm);
    cz[j] = cz[j - 1] + dl * Math.sin(tm);
    th[j] = theta(tAt(j));
  }

  const count = (nu + 1) * (nv + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const col = new Float32Array(count * 3);
  let k = 0;
  for (let j = 0; j <= nv; j++) {
    const t = tAt(j);
    const scal = 1 + scallop * noise2(t * rf * 1.5, seed * 0.37, seed) * sstep(t, 0.35, 0.95);
    const w = 0.5 * W * profile(t, widest, baseW, q) * scal;
    const psi = cup * (cupBase + (1 - cupBase) * t);
    const s = Math.sin(th[j]);
    const c = Math.cos(th[j]);
    for (let i = 0; i <= nu; i++, k++) {
      const u = -1 + (2 * i) / nu;
      const au = Math.abs(u);
      let X: number;
      let Zo: number;
      if (psi > 1e-3) {
        const a = u * psi;
        const R = w / psi;
        X = R * Math.sin(a);
        Zo = R * (1 - Math.cos(a));
      } else {
        X = u * w;
        Zo = 0;
      }
      Zo += fold * Math.abs(X);
      Zo -= edgeCurl * w * Math.pow(sstep(au, 0.55, 1), 2) * sstep(t, 0.25, 1);
      if (ruffle > 0) {
        const n = noise2(u * rf + 3.1, t * rf * 1.4, seed) * 0.7 + noise2(u * rf * 1.9, t * rf * 2.4, seed + 5) * 0.3;
        Zo += ruffle * n * (0.15 + 0.85 * sstep(t, 0.1, 1)) * (0.35 + 0.65 * au) * (1 - 0.85 * sstep(t, 0.86, 1));
      }
      pos[k * 3] = X;
      pos[k * 3 + 1] = cy[j] - s * Zo;
      pos[k * 3 + 2] = cz[j] + c * Zo;
      uv[k * 2] = u * 0.5 + 0.5;
      uv[k * 2 + 1] = t;
      const cc = p.color(u, t, au);
      col[k * 3] = cc[0];
      col[k * 3 + 1] = cc[1];
      col[k * 3 + 2] = cc[2];
    }
  }
  const idx: number[] = [];
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c2 = a + row;
      const d = c2 + 1;
      idx.push(a, b, c2, b, d, c2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Palette channel colouring: r = base-to-tip gradient, g = occlusion shade, b = accent mix. */
export function paletteColor(o: {
  ao0?: number; shade?: number; gScale?: number; gBias?: number; accent?: number; accentEdge?: number; stripe?: number;
}): ColorFn {
  const ao0 = o.ao0 ?? 0.5;
  const shade = o.shade ?? 1;
  const gScale = o.gScale ?? 1;
  const gBias = o.gBias ?? 0;
  const accent = o.accent ?? 0;
  const accentEdge = o.accentEdge ?? 0;
  const stripe = o.stripe ?? 0;
  return (_u, t, au) => {
    const g = clamp01(gBias + sstep(t, 0.0, 0.95) * gScale);
    const ao = lerp(ao0, 1, sstep(t, 0, 0.55)) * shade;
    const b = clamp01(accent + accentEdge * Math.pow(au, 3) * sstep(t, 0.35, 1) + stripe * Math.pow(1 - au, 2.5) * sstep(t, 0.1, 0.8));
    return [g, ao, b];
  };
}

/** Direct (not palette-mapped) colouring: lerps two linear RGB triples base to tip with a slightly lighter midrib. */
export function directColor(base: [number, number, number], tip: [number, number, number], ao0 = 0.7): ColorFn {
  return (_u, t, au) => {
    const f = sstep(t, 0, 1);
    const ao = lerp(ao0, 1, sstep(t, 0, 0.4));
    const lift = 1 + 0.12 * Math.pow(1 - au, 4);
    return [lerp(base[0], tip[0], f) * ao * lift, lerp(base[1], tip[1], f) * ao * lift, lerp(base[2], tip[2], f) * ao * lift];
  };
}

/** Matrix for a petal attached around an axis: yaw about Y, base at radius r0 and height h0, tilted outward. */
export function petalMatrix(yaw: number, h0: number, r0: number, tilt: number, spin = 0): Matrix4 {
  const m = new Matrix4().makeRotationY(yaw);
  m.multiply(new Matrix4().makeTranslation(0, h0, -r0));
  m.multiply(new Matrix4().makeRotationX(-tilt));
  if (spin) m.multiply(new Matrix4().makeRotationY(spin));
  return m;
}

export function placed(geo: BufferGeometry, m: Matrix4): BufferGeometry {
  geo.applyMatrix4(m);
  return geo;
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('flowers: geometry merge failed (attribute mismatch)');
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Add a constant colour attribute to a geometry that lacks one (so it can merge with petals). */
export function colorize(geo: BufferGeometry, rgb: [number, number, number]): BufferGeometry {
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = rgb[0]; a[i * 3 + 1] = rgb[1]; a[i * 3 + 2] = rgb[2]; }
  geo.setAttribute('color', new Float32BufferAttribute(a, 3));
  return geo;
}

export function triCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
}
