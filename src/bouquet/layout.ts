import { Vector3 } from 'three';
import type { VarietyId } from '../types';

/** Bloom radii used for spacing. Eucalyptus is filler and may overlap others (see pairGap). */
export const BLOOM_RADIUS: Record<VarietyId, number> = {
  // Measured against the rendered blooms (head width on screen at the default camera): rose ~0.13 wide,
  // peony ~0.15, tulip ~0.075, daisy ~0.19 (flat, so it may tuck under neighbours a little).
  rose: 0.068,
  peony: 0.078,
  tulip: 0.04,
  daisy: 0.08,
  eucalyptus: 0.04,
};

/** Where the camera starts (azimuth, polar from vertical). The exploded layout is separated as seen from here. */
export const DEFAULT_VIEW = { azimuth: 0.45, polar: 1.13 };

// A packed, rounded dome: heads close to the binding point so blooms hide the stems, spread over the whole
// cap down to low in front, not along a rim.
export const DOME = {
  dMin: 0.24,
  dMax: 0.42,
  coneMax: (62 * Math.PI) / 180,
  rootBelow: 0.29, // root sits this far past the binding point (stem ends about 6 cm off the floor), on the head-through-binding line
  rootMinY: 0.03,
};

export const EXPLODED = {
  radius: 0.62, // blooms fit inside this sphere...
  centreLift: 0.2, // ...centred this far above the binding point
  minHeadAboveBinding: 0.03,
  maxStem: 0.66,
};

interface Zone {
  th0: number;
  th1: number;
  d0: number;
  d1: number;
}
const deg = (d: number) => (d * Math.PI) / 180;
const ZONES: Record<VarietyId, Zone> = {
  rose: { th0: 0, th1: deg(40), d0: 0.34, d1: 0.4 },
  peony: { th0: 0, th1: deg(46), d0: 0.32, d1: 0.39 },
  tulip: { th0: deg(20), th1: deg(56), d0: 0.29, d1: 0.37 },
  daisy: { th0: deg(30), th1: deg(60), d0: 0.26, d1: 0.34 },
  eucalyptus: { th0: deg(44), th1: deg(62), d0: 0.24, d1: 0.3 },
};
const FULL_ZONE: Zone = { th0: 0, th1: DOME.coneMax, d0: DOME.dMin, d1: DOME.dMax };

/** Minimum centre distance between two blooms. Filler pairs may overlap by ~half. */
export function pairGap(a: VarietyId, b: VarietyId): number {
  const f = a === 'eucalyptus' || b === 'eucalyptus' ? 0.55 : 1;
  return (BLOOM_RADIUS[a] + BLOOM_RADIUS[b]) * f;
}

/** Saturating max: identity below L-k, C1-smooth, never exceeds L. */
export function softMax(x: number, L: number, k: number): number {
  const s = L - k;
  return x <= s ? x : s + k * Math.tanh((x - s) / k);
}
export function softMin(x: number, L: number, k: number): number {
  return -softMax(-x, -L, k);
}

/**
 * Project a world point onto the dome around the binding point. Soft = smooth saturation (for live
 * dragging), hard = plain clamp (for slots). `az` is the fallback azimuth when the point is on the axis.
 */
export function projectDome(p: Vector3, b: Vector3, soft: boolean, az: number, out: Vector3): number {
  const dx = p.x - b.x;
  const dy = p.y - b.y;
  const dz = p.z - b.z;
  const h = Math.hypot(dx, dz);
  const d = Math.hypot(h, dy);
  let theta = d > 1e-6 ? Math.atan2(h, dy) : 0;
  const azimuth = h > 1e-5 ? Math.atan2(dz, dx) : az;
  let dist = d;
  if (soft) {
    theta = softMax(theta, DOME.coneMax, DOME.coneMax * 0.3);
    dist = softMin(softMax(dist, DOME.dMax, 0.07), DOME.dMin, 0.05);
  } else {
    theta = Math.min(theta, DOME.coneMax);
    dist = Math.min(Math.max(dist, DOME.dMin), DOME.dMax);
  }
  const s = Math.sin(theta);
  out.set(b.x + dist * s * Math.cos(azimuth), b.y + dist * Math.cos(theta), b.z + dist * s * Math.sin(azimuth));
  return azimuth;
}

/** Stem root for an assembled head: on the line head -> binding, continuing past the binding. */
export function assembledRoot(head: Vector3, b: Vector3, out: Vector3): Vector3 {
  out.subVectors(head, b);
  if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
  out.normalize().multiplyScalar(-DOME.rootBelow).add(b);
  out.y = Math.max(out.y, DOME.rootMinY);
  return out;
}

/** Stem root for an exploded head: same direction as the assembled stem, length capped. */
export function explodedRoot(head: Vector3, b: Vector3, out: Vector3): Vector3 {
  const u = new Vector3().subVectors(head, b);
  const d = u.length();
  if (d < 1e-6) u.set(0, 1, 0);
  else u.divideScalar(d);
  const len = Math.min(EXPLODED.maxStem, d + 0.2);
  out.copy(head).addScaledVector(u, -len);
  out.y = Math.max(out.y, DOME.rootMinY);
  return out;
}

export function explodedCentre(b: Vector3): Vector3 {
  return new Vector3(b.x, b.y + EXPLODED.centreLift, b.z);
}

export interface AssembledItem {
  head: Vector3;
  variety: VarietyId;
  anchor?: boolean;
}

/** Best-candidate sampling: the point in the variety's zone that clears its neighbours the most. */
export function placeAssembled(
  variety: VarietyId,
  others: readonly AssembledItem[],
  b: Vector3,
  rng: () => number,
): Vector3 {
  const sample = (z: Zone, n: number) => {
    let best = new Vector3();
    let bestScore = -Infinity;
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      const th = z.th0 + (z.th1 - z.th0) * Math.sqrt(rng());
      const d = z.d0 + (z.d1 - z.d0) * rng();
      const az = rng() * Math.PI * 2;
      p.set(b.x + d * Math.sin(th) * Math.cos(az), b.y + d * Math.cos(th), b.z + d * Math.sin(th) * Math.sin(az));
      let score = Infinity;
      for (const o of others) score = Math.min(score, p.distanceTo(o.head) - pairGap(variety, o.variety));
      if (score > bestScore) {
        bestScore = score;
        best = p.clone();
      }
    }
    return { best, bestScore };
  };
  let r = sample(ZONES[variety], 220);
  if (r.bestScore < 0) {
    const r2 = sample(FULL_ZONE, 500);
    if (r2.bestScore > r.bestScore) r = r2;
  }
  return r.best;
}

const nudge = new Vector3();
function separation(i: number, j: number, n: Vector3, a: Vector3, bb: Vector3): void {
  n.subVectors(a, bb);
  if (n.lengthSq() < 1e-10) {
    // identical points: deterministic direction from indices
    const t = (i * 12.9898 + j * 78.233) % (Math.PI * 2);
    n.set(Math.cos(t), 0.3, Math.sin(t));
  }
  n.normalize();
}

/** Push overlapping assembled heads apart and keep them on the dome. Mutates item.head. */
export function relaxAssembled(items: AssembledItem[], b: Vector3, iters = 80): void {
  const tmp = new Vector3();
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i];
        const B = items[j];
        const min = pairGap(A.variety, B.variety) * 1.02;
        const dist = A.head.distanceTo(B.head);
        if (dist >= min) continue;
        moved = true;
        separation(i, j, nudge, A.head, B.head);
        const push = min - dist;
        const wa = A.anchor ? 0 : B.anchor ? 1 : 0.5;
        const wb = B.anchor ? 0 : A.anchor ? 1 : 0.5;
        A.head.addScaledVector(nudge, push * wa);
        B.head.addScaledVector(nudge, -push * wb);
      }
    }
    for (const A of items) {
      if (A.anchor) continue;
      projectDome(A.head, b, false, 0, tmp);
      A.head.copy(tmp);
    }
    if (!moved) break;
  }
}

/** Where an assembled head would like to sit when exploded: same side, spread wider and lower. */
export function homeExploded(headA: Vector3, b: Vector3, variety?: VarietyId): Vector3 {
  const u = new Vector3().subVectors(headA, b);
  const d = u.length();
  u.divideScalar(d || 1);
  const theta = Math.acos(Math.min(1, Math.max(-1, u.y)));
  const th2 = Math.min(deg(80), deg(14) + theta * 1.7);
  const az = Math.atan2(u.z, u.x);
  // filler sprays sit on the outer ring; focal blooms nearer the centre
  const r = (0.32 + (0.22 * (d - DOME.dMin)) / (DOME.dMax - DOME.dMin)) * (variety === 'eucalyptus' ? 1.4 : 1);
  return new Vector3(
    b.x + r * Math.sin(th2) * Math.cos(az),
    b.y + r * Math.cos(th2),
    b.z + r * Math.sin(th2) * Math.sin(az),
  );
}

export interface ExplodedItem {
  head: Vector3;
  variety: VarietyId;
  home: Vector3 | null; // null once the user has placed it
  anchor?: boolean;
}

export function clampExploded(p: Vector3, variety: VarietyId, b: Vector3): void {
  const cx = b.x;
  const cy = b.y + EXPLODED.centreLift;
  const cz = b.z;
  p.y = Math.max(p.y, b.y + EXPLODED.minHeadAboveBinding);
  const R = EXPLODED.radius - BLOOM_RADIUS[variety];
  let ox = p.x - cx;
  let oy = p.y - cy;
  let oz = p.z - cz;
  const l = Math.hypot(ox, oy, oz);
  if (l > R) {
    const k = R / l;
    p.set(cx + ox * k, cy + oy * k, cz + oz * k);
  }
  // the sphere cut can push below the floor again; floor wins, then re-project once
  if (p.y < b.y + EXPLODED.minHeadAboveBinding) {
    p.y = b.y + EXPLODED.minHeadAboveBinding;
    ox = p.x - cx;
    oy = p.y - cy;
    oz = p.z - cz;
    if (Math.hypot(ox, oy, oz) > R) {
      // slide along the floor circle
      const rr = Math.sqrt(Math.max(R * R - oy * oy, 0));
      const hl = Math.hypot(ox, oz) || 1;
      p.x = cx + (ox / hl) * rr;
      p.z = cz + (oz / hl) * rr;
    }
  }
}

const _right = new Vector3(Math.cos(DEFAULT_VIEW.azimuth), 0, -Math.sin(DEFAULT_VIEW.azimuth));
const _elev = Math.PI / 2 - DEFAULT_VIEW.polar;
const _up = new Vector3(
  -Math.sin(DEFAULT_VIEW.azimuth) * Math.sin(_elev),
  Math.cos(_elev),
  -Math.cos(DEFAULT_VIEW.azimuth) * Math.sin(_elev),
);
/** Apparent bloom radius from the default camera (bigger than BLOOM_RADIUS: sprays and daisies read wide). */
const VIEW_RADIUS: Record<VarietyId, number> = { rose: 0.078, peony: 0.088, tulip: 0.055, daisy: 0.098, eucalyptus: 0.1 };

/** Offset of the visible bloom centre from the head point, along the stem (negative: the spray hangs back toward the binding). From each variety's pickY. */
const CENTRE_ALONG: Record<VarietyId, number> = { rose: 0.03, peony: 0.02, tulip: 0.05, daisy: 0.01, eucalyptus: -0.14 };
const _cA = new Vector3();
const _cB = new Vector3();
const _u = new Vector3();
function bloomCentre(head: Vector3, variety: VarietyId, b: Vector3, out: Vector3): Vector3 {
  _u.subVectors(head, b);
  const l = _u.length() || 1;
  return out.copy(head).addScaledVector(_u, CENTRE_ALONG[variety] / l);
}

/** Resolve overlaps in the exploded spread. Home pull keeps the fan shaped like the bouquet. */
export function relaxExploded(items: ExplodedItem[], b: Vector3, iters = 240): void {
  const d = new Vector3();
  // roomy on screen for a normal bouquet; with many flowers the sphere is crowded, so ease off
  const margin = items.length <= 20 ? 1.22 : 1.04;
  for (let it = 0; it < iters; it++) {
    let moved = false;
    let pull = 0;
    for (const A of items) {
      if (A.anchor || !A.home || it > iters * 0.5) continue; // second half: separation only, so no overlap survives
      pull += A.head.distanceTo(A.home) * 0.04;
      A.head.lerp(A.home, 0.04);
    }
    if (it < iters * 0.75) {
      // Separate as seen from the default camera, so blooms do not hide each other on screen.
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const A = items[i];
          const B2 = items[j];
          d.subVectors(bloomCentre(A.head, A.variety, b, _cA), bloomCentre(B2.head, B2.variety, b, _cB));
          let du = d.dot(_right);
          let dv = d.dot(_up);
          const dist = Math.hypot(du, dv);
          const min = (VIEW_RADIUS[A.variety] + VIEW_RADIUS[B2.variety]) * margin;
          if (dist >= min) continue;
          moved = true;
          if (dist < 1e-6) { du = 1; dv = 0.3; }
          const l = Math.hypot(du, dv);
          const push = min - dist;
          const wa = A.anchor ? 0 : B2.anchor ? 1 : 0.5;
          const wb = B2.anchor ? 0 : A.anchor ? 1 : 0.5;
          A.head.addScaledVector(_right, (du / l) * push * wa).addScaledVector(_up, (dv / l) * push * wa);
          B2.head.addScaledVector(_right, -(du / l) * push * wb).addScaledVector(_up, -(dv / l) * push * wb);
        }
      }
      for (const A of items) if (!A.anchor) clampExploded(A.head, A.variety, b);
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i];
        const B = items[j];
        const min = (BLOOM_RADIUS[A.variety] + BLOOM_RADIUS[B.variety]) * 1.06;
        const dist = A.head.distanceTo(B.head);
        if (dist >= min) continue;
        moved = true;
        separation(i, j, nudge, A.head, B.head);
        const push = min - dist;
        const wa = A.anchor ? 0 : B.anchor ? 1 : 0.5;
        const wb = B.anchor ? 0 : A.anchor ? 1 : 0.5;
        A.head.addScaledVector(nudge, push * wa);
        B.head.addScaledVector(nudge, -push * wb);
      }
    }
    for (const A of items) if (!A.anchor) clampExploded(A.head, A.variety, b);
    if (!moved && pull < 1e-4 * items.length) break; // converged: nothing pushes and nothing is still being pulled home
  }
}
