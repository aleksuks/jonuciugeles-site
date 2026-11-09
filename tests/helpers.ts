import { Group, Object3D, Scene, Vector3 } from 'three';
import { Bouquet } from '../src/bouquet/bouquet';
import { mulberry32 } from '../src/bouquet/spring';
import type { FlowerVisual, VarietyId } from '../src/types';

export class FakeVisual implements FlowerVisual {
  readonly object = new Group();
  readonly pickTargets: Object3D[] = [new Object3D(), new Object3D()];
  root = new Vector3();
  head = new Vector3();
  roll = 0;
  poseCalls = 0;
  disposed = false;
  constructor(readonly variety: VarietyId) {}
  setPose(root: Vector3, head: Vector3, roll: number): void {
    if (![root.x, root.y, root.z, head.x, head.y, head.z, roll].every(Number.isFinite)) throw new Error('NaN pose');
    this.root.copy(root);
    this.head.copy(head);
    this.roll = roll;
    this.poseCalls++;
  }
  setHighlighted(): void {}
  dispose(): void {
    this.disposed = true;
  }
}

export interface Trace {
  id: number;
  pos: Vector3[];
  d: number; // largest slot distance this flower must travel (for bounds)
  omega: number;
  zeta: number;
}

export class Sim {
  readonly scene = new Scene();
  readonly visuals = new Map<number, FakeVisual>();
  readonly b: Bouquet;
  readonly traces = new Map<number, Trace>();
  t = 0;
  frame = 0;

  constructor(public dt = 1 / 60, opts: { seed?: number; starter?: boolean } = {}) {
    this.b = new Bouquet({
      scene: this.scene,
      seed: opts.seed ?? 7,
      createVisual: (variety) => {
        const v = new FakeVisual(variety);
        return v;
      },
    });
    if (opts.starter !== false) this.b.addStarterBouquet();
    this.indexVisuals();
    this.settle();
    // reset traces at the settled pose
    this.traces.clear();
    this.record();
  }

  private indexVisuals(): void {
    for (const f of this.b.flowers) this.visuals.set(f.id, f.visual as FakeVisual);
  }

  add(variety: VarietyId, palette = 0) {
    const r = this.b.add(variety, palette);
    this.indexVisuals();
    this.record(true);
    return r;
  }

  private record(fresh = false): void {
    for (const f of this.b.flowers) {
      const v = this.visuals.get(f.id)!;
      let tr = this.traces.get(f.id);
      const info = this.b.inspect(f.id)!;
      if (!tr) {
        const exp = info.exp.head;
        const asm = info.asm.head;
        tr = { id: f.id, pos: [], d: Math.max(exp.distanceTo(asm), v.head.distanceTo(asm), v.head.distanceTo(exp)), omega: info.omega, zeta: info.zeta };
        this.traces.set(f.id, tr);
      }
      if (!fresh || tr.pos.length === 0) tr.pos.push(v.head.clone());
    }
  }

  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.b.update(this.dt);
      this.t += this.dt;
      this.frame++;
      this.record();
    }
  }

  run(seconds: number): void {
    this.step(Math.round(seconds / this.dt));
  }

  settle(maxSeconds = 12): number {
    let t = 0;
    while (this.b.settling && t < maxSeconds) {
      this.b.update(1 / 60);
      t += 1 / 60;
    }
    return t;
  }
}

/** Largest first and second difference of a trace, in units per frame and per frame^2. */
export function motion(tr: Trace): { step: number; accel: number } {
  let step = 0;
  let accel = 0;
  for (let i = 1; i < tr.pos.length; i++) {
    step = Math.max(step, tr.pos[i].distanceTo(tr.pos[i - 1]));
    if (i >= 2) {
      const a = tr.pos[i].clone().sub(tr.pos[i - 1]).sub(tr.pos[i - 1]).add(tr.pos[i - 2]);
      accel = Math.max(accel, a.length());
    }
  }
  return { step, accel };
}

/**
 * Bounds from the spring itself. Speed from rest peaks near 0.5*w*D (D = travel); retargeting mid-flight
 * adds at most the old velocity, so 0.75*w*D. Acceleration is w^2*|T-x| + 2*z*w*|v| with |T-x| <= 1.25 D
 * (overshoot plus slot reflow), giving w^2*D*(1.25 + 1.5 z). A frame-to-frame jump shows up as a second
 * difference far above this.
 */
export function bounds(tr: Trace, dt: number): { step: number; accel: number } {
  const w = tr.omega;
  return {
    step: 0.75 * w * tr.d * dt,
    accel: w * w * tr.d * (1.25 + 1.5 * tr.zeta) * dt * dt,
  };
}

export function assertNoJumps(sim: Sim, label = '', skip: number[] = []): void {
  for (const tr of sim.traces.values()) {
    if (skip.includes(tr.id)) continue;
    const m = motion(tr);
    const bd = bounds(tr, sim.dt);
    if (!(m.step <= bd.step) || !(m.accel <= bd.accel)) {
      throw new Error(
        `${label} flower ${tr.id}: step ${m.step.toFixed(4)} (<= ${bd.step.toFixed(4)}), accel ${m.accel.toFixed(4)} (<= ${bd.accel.toFixed(4)})`,
      );
    }
  }
}

export function maxStep(sim: Sim): number {
  let m = 0;
  for (const tr of sim.traces.values()) m = Math.max(m, motion(tr).step);
  return m;
}

export { mulberry32 };

export function distToLine(point: Vector3, a: Vector3, b: Vector3): number {
  const u = b.clone().sub(a).normalize();
  return point.clone().sub(a).cross(u).length();
}
