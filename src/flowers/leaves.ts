import { BufferGeometry, Color, LatheGeometry, Matrix4, Vector2 } from 'three';
import { colorize, directColor, makePetal, petalMatrix, placed } from './petal';
import type { ColorFn } from './petal';

export interface Bloom {
  /** Palette mapped petals (vertex colour channels, see paletteColor). */
  petals: BufferGeometry;
  /** Green leaves and sepals in the bloom's local frame, coloured directly. */
  foliage?: BufferGeometry;
  /** Optional separate matte part (daisy centre). */
  centre?: BufferGeometry;
  pickRadius: number;
  pickY: number;
}

export function lin(hex: string): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

export interface LeafOpts {
  az: number;
  /** Height on the stem relative to the bloom origin (negative = below). */
  y: number;
  r0?: number;
  /** Outward tilt from the stem axis (rad). */
  tilt: number;
  scale: number;
  leaflets: 1 | 3;
  length: number;
  width: number;
  seed: number;
  base: [number, number, number];
  tip: [number, number, number];
  bend?: number;
  segs?: [number, number];
}

function leaflet(o: LeafOpts, scale: number, seed: number): BufferGeometry {
  const [nu, nv] = o.segs ?? [4, 9];
  return makePetal({
    length: o.length * scale, width: o.width * scale, nu, nv,
    widest: 0.38, baseWidth: 0.18, tipPow: 1.35, cup: 0, bend: o.bend ?? -0.55, bendPow: 1.6,
    fold: 0.28, scallop: 0.08, ruffle: 0.0012, ruffleFreq: 5, seed,
    color: directColor(o.base, o.tip, 0.75),
  });
}

/** A rose-style leaf: one terminal leaflet plus two lateral, or a single leaflet. */
export function compoundLeaf(o: LeafOpts): BufferGeometry[] {
  const frame = petalMatrix(o.az, o.y, o.r0 ?? 0.006, o.tilt);
  frame.multiply(new Matrix4().makeScale(o.scale, o.scale, o.scale));
  const out: BufferGeometry[] = [];
  if (o.leaflets === 1) {
    out.push(placed(leaflet(o, 1, o.seed), frame));
    return out;
  }
  const mid = frame.clone().multiply(new Matrix4().makeTranslation(0, o.length * 0.34, 0));
  out.push(placed(leaflet(o, 1, o.seed), mid));
  for (const sgn of [-1, 1]) {
    const m = frame.clone()
      .multiply(new Matrix4().makeTranslation(0, o.length * 0.16, 0))
      .multiply(new Matrix4().makeRotationZ(sgn * 0.95))
      .multiply(new Matrix4().makeTranslation(0, o.length * 0.04, 0));
    out.push(placed(leaflet(o, 0.72, o.seed + sgn * 3), m));
  }
  return out;
}

/** Small tapered hip that blends into the stem, with sepals folded down.  is the widest point; stemR the stem radius. */
export function receptacle(radius: number, y: number, sepals: number, sepalLen: number, rgb: { dark: [number, number, number]; light: [number, number, number] }, yawJitter = 0, stemR = 0.0085): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const pts = [
    new Vector2(stemR * 0.98, y - radius * 1.9),
    new Vector2(stemR * 1.15, y - radius * 1.3),
    new Vector2(radius * 0.8, y - radius * 0.9),
    new Vector2(radius, y - radius * 0.3),
    new Vector2(radius * 0.85, y + radius * 0.25),
    new Vector2(radius * 0.4, y + radius * 0.4),
  ];
  const hip = new LatheGeometry(pts, 12);
  out.push(colorize(hip, rgb.dark));
  const color: ColorFn = directColor(rgb.dark, rgb.light, 0.8);
  for (let i = 0; i < sepals; i++) {
    const yaw = (i / sepals) * Math.PI * 2 + yawJitter;
    const g = makePetal({
      length: sepalLen, width: sepalLen * 0.22, nu: 3, nv: 6, widest: 0.25, baseWidth: 0.7, tipPow: 1.1,
      cup: 0.3, bend: -0.5, bendPow: 1.5, color, seed: i + 11,
    });
    out.push(placed(g, petalMatrix(yaw, y + radius * 0.1, radius * 0.7, 1.8)));
  }
  return out;
}
