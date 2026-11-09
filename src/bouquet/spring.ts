import { Vector3 } from 'three';

/** Largest step the bouquet will integrate in one go; longer frames are clamped (not subdivided). */
export const MAX_DT = 1 / 20;

interface Coef {
  e: number;
  c: number;
  s: number;
  zw: number; // zeta * omega
  wd: number; // damped frequency
  w2: number; // omega squared
}

const coef: Coef = { e: 1, c: 1, s: 0, zw: 0, wd: 0, w2: 0 };

/**
 * Exact (analytic) solution of x'' = -w^2 (x - T) - 2 z w x' over dt, so it is stable at any dt.
 * Position and velocity are continuous when target, omega or zeta change between steps.
 */
function prepare(dt: number, omega: number, zeta: number): Coef {
  const z = Math.min(Math.max(zeta, 0.05), 0.98);
  const wd = omega * Math.sqrt(1 - z * z);
  coef.zw = z * omega;
  coef.wd = wd;
  coef.w2 = omega * omega;
  coef.e = Math.exp(-coef.zw * dt);
  coef.c = Math.cos(wd * dt);
  coef.s = Math.sin(wd * dt);
  return coef;
}

function advance(x: number, v: number, target: number, k: Coef, out: [number, number]): void {
  const d = x - target;
  const A = d;
  const B = (v + k.zw * d) / k.wd;
  out[0] = target + k.e * (A * k.c + B * k.s);
  out[1] = k.e * (v * k.c - ((k.zw * v + k.w2 * d) / k.wd) * k.s);
}

const tmp: [number, number] = [0, 0];

export class Spring1 {
  x = 0;
  v = 0;
  target = 0;
  step(dt: number, omega: number, zeta: number): void {
    if (dt <= 0) return;
    advance(this.x, this.v, this.target, prepare(Math.min(dt, MAX_DT), omega, zeta), tmp);
    this.x = tmp[0];
    this.v = tmp[1];
  }
}

export class Spring3 {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly target = new Vector3();

  snapTo(p: Vector3): void {
    this.pos.copy(p);
    this.target.copy(p);
    this.vel.set(0, 0, 0);
  }

  step(dt: number, omega: number, zeta: number): void {
    if (dt <= 0) return;
    const k = prepare(Math.min(dt, MAX_DT), omega, zeta);
    advance(this.pos.x, this.vel.x, this.target.x, k, tmp);
    this.pos.x = tmp[0];
    this.vel.x = tmp[1];
    advance(this.pos.y, this.vel.y, this.target.y, k, tmp);
    this.pos.y = tmp[0];
    this.vel.y = tmp[1];
    advance(this.pos.z, this.vel.z, this.target.z, k, tmp);
    this.pos.z = tmp[0];
    this.vel.z = tmp[1];
  }

  /** Distance to target plus speed, a cheap "still moving" measure. */
  energy(): number {
    return this.pos.distanceTo(this.target) + this.vel.length() * 0.1;
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
