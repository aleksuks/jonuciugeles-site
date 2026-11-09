import { BufferGeometry, CylinderGeometry, Matrix4, Vector3 } from 'three';
import { lerp, mulberry32 } from './rng';
import { colorize, makePetal, merge, paletteColor, placed } from './petal';
import type { Bloom } from './leaves';

const UP = new Vector3(0, 1, 0);

/** Matrix with origin, Y along yDir, Z as close to zHint as orthogonality allows. */
function frame(origin: Vector3, yDir: Vector3, zHint: Vector3): Matrix4 {
  const y = yDir.clone().normalize();
  const z = zHint.clone().sub(y.clone().multiplyScalar(zHint.dot(y)));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1).sub(y.clone().multiplyScalar(y.z));
  z.normalize();
  const x = new Vector3().crossVectors(y, z);
  return new Matrix4().makeBasis(x, y, z).setPosition(origin);
}

function twig(a: Vector3, b: Vector3, ra: number, rb: number): BufferGeometry {
  const d = b.clone().sub(a);
  const len = d.length();
  const g = new CylinderGeometry(rb, ra, len, 5, 1, true);
  g.translate(0, len / 2, 0);
  placed(g, frame(a, d, new Vector3(0, 0, 1)));
  // palette channels: pure accent mix, a darkened brown-green twig
  return colorize(g, [0, 0.55, 1]);
}

/** Silver dollar eucalyptus: a branching spray of round, slightly cupped leaves in alternating pairs. */
export function buildEucalyptus(variant: number): Bloom {
  const rnd = mulberry32(8080 + variant * 43);
  const parts: BufferGeometry[] = [];
  let leafSeed = 1 + variant * 100;

  const leaf = (pos: Vector3, dir: Vector3, alpha: number, scale: number): void => {
    const e1 = new Vector3().crossVectors(dir, Math.abs(dir.y) > 0.95 ? new Vector3(1, 0, 0) : UP).normalize();
    const e2 = new Vector3().crossVectors(dir, e1).normalize();
    const out = e1.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(e2, Math.sin(alpha));
    const pitch = 0.45 + rnd() * 0.25;
    const yDir = out.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(dir, Math.sin(pitch));
    const zHint = dir.clone().multiplyScalar(0.6).addScaledVector(UP, 0.5).addScaledVector(out, -0.2);
    const sz = scale * (0.9 + rnd() * 0.2);
    const g = makePetal({
      length: 0.062 * sz, width: 0.06 * sz, nu: 6, nv: 5, widest: 0.5, baseWidth: 0.12, tipPow: 2, cup: 0.55, cupBase: 1,
      bend: 0.45 + rnd() * 0.3, bendPow: 1.8, ruffle: 0.0006, ruffleFreq: 2.5, seed: leafSeed++,
      color: paletteColor({ ao0: 0.55, gBias: rnd() * 0.25, gScale: 0.75, accent: rnd() * 0.12, accentEdge: 0.35 }),
    });
    parts.push(placed(g, frame(pos.clone().addScaledVector(out, 0.004), yDir, zHint)));
  };

  // Walk a twig, dropping opposite leaf pairs; returns nothing, adds geometry.
  const branch = (start: Vector3, dir: Vector3, length: number, pairs: number, scale0: number, scale1: number, a0: number): void => {
    const end = start.clone().addScaledVector(dir, length);
    parts.push(twig(start, end, 0.0028, 0.0014));
    for (let k = 0; k < pairs; k++) {
      const s = (k + 0.6) / pairs;
      const p = start.clone().lerp(end, s);
      const sc = lerp(scale0, scale1, s);
      const alpha = a0 + k * (Math.PI / 2);
      leaf(p, dir, alpha, sc);
      leaf(p, dir, alpha + Math.PI, sc);
    }
    leaf(end, dir, a0 + pairs * 1.4, lerp(scale0, scale1, 1) * 0.85); // terminal leaf
  };

  const sway = (rnd() - 0.5) * 0.12;
  const top = new Vector3(sway * 0.4, 0.05, 0);
  const bottom = new Vector3(0, -0.36, 0);
  const mainDir = top.clone().sub(bottom).normalize();
  // the stem itself reaches y=0; the twig continues a little above and carries leaf pairs
  branch(bottom.clone().setY(-0.3), mainDir, 0.35, 9, 1.05, 0.7, rnd() * 6);
  const sideY = [-0.27, -0.19, -0.11, -0.04];
  for (let k = 0; k < sideY.length; k++) {
    const a = k * 2.4 + rnd() * 1.2 + variant;
    const out = new Vector3(Math.cos(a), 0, Math.sin(a));
    const up = lerp(0.95, 0.6, k / (sideY.length - 1));
    const dir = out.multiplyScalar(Math.sqrt(1 - up * up)).addScaledVector(UP, up).normalize();
    const start = new Vector3(0, sideY[k], 0);
    branch(start, dir, lerp(0.19, 0.1, k / (sideY.length - 1)), 4 + (k < 2 ? 1 : 0), 1.0, 0.65, rnd() * 6);
  }
  return { petals: merge(parts), pickRadius: 0.15, pickY: -0.14 };
}
