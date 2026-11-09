import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import type { VarietyId } from '../types';

interface StemSpec {
  radius: number;
  bow: number;
  bottom: string;
  top: string;
}

export const STEM_SPECS: Record<VarietyId, StemSpec> = {
  rose: { radius: 0.0055, bow: 0.014, bottom: '#4a5128', top: '#3d6330' },
  tulip: { radius: 0.0062, bow: 0.017, bottom: '#6f8a56', top: '#58804a' },
  daisy: { radius: 0.0036, bow: 0.014, bottom: '#4a6b2c', top: '#5a8234' },
  peony: { radius: 0.0059, bow: 0.012, bottom: '#5c5a33', top: '#42693a' },
  eucalyptus: { radius: 0.0036, bow: 0.012, bottom: '#6f5645', top: '#8a6f5e' },
};

const RADIAL = 10;
const LENGTHS = 14;
const cache = new Map<VarietyId, BufferGeometry>();

/**
 * Unit-length tube along +Y (y from 0 to 1) with a gentle S bow baked in and a slightly flared base.
 * The caller scales Y by the stem length only, so thickness and bow stay constant. The bottom has a pale flat cut face.
 */
export function stemGeometry(variety: VarietyId): BufferGeometry {
  const hit = cache.get(variety);
  if (hit) return hit;
  const s = STEM_SPECS[variety];
  const bottom = new Color(s.bottom);
  const top = new Color(s.top);
  const cutCol = new Color('#d8dfa6');
  const c = new Color();
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bowAt = (t: number): number => s.bow * (Math.sin(Math.PI * t) + 0.35 * Math.sin(2 * Math.PI * t));
  for (let j = 0; j <= LENGTHS; j++) {
    const t = j / LENGTHS;
    const r = s.radius * (1.16 - 0.16 * t);
    c.copy(bottom).lerp(top, Math.min(1, t * 1.6));
    for (let i = 0; i < RADIAL; i++) {
      const a = (i / RADIAL) * Math.PI * 2;
      pos.push(Math.cos(a) * r + bowAt(t), t, Math.sin(a) * r);
      nor.push(Math.cos(a), 0, Math.sin(a));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < LENGTHS; j++) {
    for (let i = 0; i < RADIAL; i++) {
      const a = j * RADIAL + i;
      const b = j * RADIAL + ((i + 1) % RADIAL);
      const cc = a + RADIAL;
      const d = b + RADIAL;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  // flat cut face with its own normals
  const r0 = s.radius * 1.16;
  const base = pos.length / 3;
  pos.push(bowAt(0), 0, 0);
  nor.push(0, -1, 0);
  col.push(cutCol.r, cutCol.g, cutCol.b);
  for (let i = 0; i < RADIAL; i++) {
    const a = (i / RADIAL) * Math.PI * 2;
    pos.push(Math.cos(a) * r0 + bowAt(0), 0, Math.sin(a) * r0);
    nor.push(0, -1, 0);
    col.push(cutCol.r * 0.92, cutCol.g * 0.92, cutCol.b * 0.85);
  }
  for (let i = 0; i < RADIAL; i++) {
    idx.push(base, base + 1 + i, base + 1 + ((i + 1) % RADIAL));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  cache.set(variety, g);
  return g;
}
