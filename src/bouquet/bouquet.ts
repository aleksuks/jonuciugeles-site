import { Vector3, type Object3D, type Scene } from 'three';
import type { BouquetApi, BouquetEvents, FlowerRecord, FlowerVisual, VarietyId } from '../types';
import { MAX_DT, Spring1, Spring3, mulberry32 } from './spring';
import {
  DOME,
  EXPLODED,
  assembledRoot,
  clampExploded,
  explodedRoot,
  homeExploded,
  placeAssembled,
  projectDome,
  relaxAssembled,
  relaxExploded,
  softMax,
  softMin,
  explodedCentre,
  type AssembledItem,
  type ExplodedItem,
} from './layout';

export type CreateVisual = (variety: VarietyId, opts: { paletteIndex: number; seed: number }) => FlowerVisual;

export interface BouquetOptions {
  scene: Scene;
  createVisual: CreateVisual;
  bindingPoint?: Vector3;
  seed?: number;
  events?: BouquetEvents;
  /** Palettes per variety the injected createVisual supports; used to spread colours in the starter. */
  paletteCount?: number | ((variety: VarietyId) => number);
}

/** Hard cap on the bouquet size; the UI reads this same constant. */
export const MAX_FLOWERS = 40;

// Tuning (feel-test these)
export const TUNING = {
  stagger: 0.2, // seconds, spread inner->outer; plus up to 0.02 jitter => total <= 0.22
  omega: [7.6, 9.4] as const, // rad/s natural frequency per flower
  zeta: [0.62, 0.8] as const, // damping ratio per flower
  rollOffset: [0.4, 1.0] as const, // radians of extra spin when exploded
  dragOmega: 38,
  dragZeta: 0.85,
  leaveOmega: 9,
  leaveTime: 0.5,
};

interface Slot {
  head: Vector3;
  root: Vector3;
}

interface Entry {
  record: FlowerRecord;
  head: Spring3;
  root: Spring3;
  roll: Spring1;
  omega: number;
  zeta: number;
  rollOffset: number;
  asm: Slot;
  exp: Slot;
  home: Vector3 | null; // exploded home from the assembled slot; null once the user placed it
  mode: boolean; // true = targets follow the exploded slot
  pending: boolean | null;
  delay: number;
  rank: number; // 0 inner .. 1 outer, for stagger order
  jitter: number;
  az: number;
  dragging: boolean;
  dragExploded: boolean;
  dragStem: Vector3;
  last: Float64Array;
}

interface Leaving {
  visual: FlowerVisual;
  head: Spring3;
  root: Spring3;
  roll: Spring1;
  omega: number;
  t: number;
}

/** Exit: fly up, and over the last part of the flight shrink to nothing about the head, so removal never pops. */
const LEAVE_SHRINK_FROM = 0.45; // fraction of leaveTime

const SETTLE_POS = 0.0015;

export class Bouquet implements BouquetApi {
  readonly bindingPoint: Vector3;
  private readonly scene: Scene;
  private readonly createVisual: CreateVisual;
  private readonly events?: BouquetEvents;
  private readonly rng: () => number;
  private readonly paletteCount: (variety: VarietyId) => number;
  private readonly entries: Entry[] = [];
  private readonly list: FlowerRecord[] = [];
  private readonly leaving: Leaving[] = [];
  private nextId = 1;
  private _exploded = false;

  constructor(opts: BouquetOptions) {
    this.scene = opts.scene;
    this.createVisual = opts.createVisual;
    this.events = opts.events;
    this.bindingPoint = (opts.bindingPoint ?? new Vector3(0, 0.35, 0)).clone();
    this.rng = mulberry32(opts.seed ?? 1);
    const pc = opts.paletteCount ?? 3;
    this.paletteCount = typeof pc === 'function' ? pc : () => pc;
  }

  get flowers(): readonly FlowerRecord[] {
    return this.list;
  }
  get exploded(): boolean {
    return this._exploded;
  }

  get pickTargets(): Object3D[] {
    const out: Object3D[] = [];
    for (const f of this.list) out.push(...f.visual.pickTargets);
    return out;
  }

  /** Mean fraction of the way from each flower's assembled to exploded head slot (debug). */
  get explodeProgress(): number {
    if (!this.entries.length) return this._exploded ? 1 : 0;
    let sum = 0;
    const ab = new Vector3();
    const ap = new Vector3();
    for (const e of this.entries) {
      ab.subVectors(e.exp.head, e.asm.head);
      const l2 = ab.lengthSq();
      ap.subVectors(e.head.pos, e.asm.head);
      sum += l2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ap.dot(ab) / l2));
    }
    return sum / this.entries.length;
  }

  get settling(): boolean {
    if (this.leaving.length) return true;
    for (const e of this.entries) {
      if (e.dragging || e.pending !== null) return true;
      if (
        e.head.energy() > SETTLE_POS ||
        e.root.energy() > SETTLE_POS ||
        Math.abs(e.roll.x - e.roll.target) + Math.abs(e.roll.v) * 0.1 > 0.003
      )
        return true;
    }
    return false;
  }

  /** Test/debug view of a flower's motion state. */
  inspect(id: number) {
    const e = this.find(id);
    if (!e) return null;
    return {
      head: e.head.pos,
      headVel: e.head.vel,
      root: e.root.pos,
      rootVel: e.root.vel,
      roll: e.roll.x,
      omega: e.omega,
      zeta: e.zeta,
      mode: e.mode,
      pending: e.pending,
      asm: e.asm,
      exp: e.exp,
      dragging: e.dragging,
    };
  }

  // ---------------------------------------------------------------- building

  addStarterBouquet(): void {
    // Focal blooms first so they get the best spots; filler last, at the edges.
    const order: VarietyId[] = [
      'rose', 'peony', 'rose', 'peony', 'rose', 'peony', 'rose',
      'tulip', 'daisy', 'tulip', 'daisy', 'tulip', 'daisy',
      'eucalyptus', 'eucalyptus', 'eucalyptus', 'eucalyptus',
    ];
    const used: Partial<Record<VarietyId, number>> = {};
    for (const v of order) {
      const n = used[v] ?? 0;
      used[v] = n + 1;
      this.addInternal(v, n % Math.max(1, this.paletteCount(v)), false);
    }
    this.relayout();
    this.events?.onChange?.();
  }

  get full(): boolean {
    return this.entries.length >= MAX_FLOWERS;
  }

  add(variety: VarietyId, paletteIndex = 0): FlowerRecord {
    if (this.full) throw new RangeError(`bouquet is full (${MAX_FLOWERS} flowers)`);
    const e = this.addInternal(variety, paletteIndex, true);
    this.relayout();
    this.events?.onChange?.();
    return e.record;
  }

  private addInternal(variety: VarietyId, paletteIndex: number, spawnAbove: boolean): Entry {
    const rng = this.rng;
    const seed = Math.floor(rng() * 0x7fffffff);
    const visual = this.createVisual(variety, { paletteIndex, seed });
    const id = this.nextId++;
    for (const t of visual.pickTargets) t.userData.flowerId = id;
    this.scene.add(visual.object);
    const record: FlowerRecord = { id, variety, visual };
    const b = this.bindingPoint;

    const asmHead = placeAssembled(variety, this.assembledItems(), b, rng);
    const home = homeExploded(asmHead, b, variety);
    const expHead = home.clone();
    clampExploded(expHead, variety, b);

    const [o0, o1] = TUNING.omega;
    const [z0, z1] = TUNING.zeta;
    const [r0, r1] = TUNING.rollOffset;
    const e: Entry = {
      record,
      head: new Spring3(),
      root: new Spring3(),
      roll: new Spring1(),
      omega: o0 + rng() * (o1 - o0),
      zeta: z0 + rng() * (z1 - z0),
      rollOffset: (r0 + rng() * (r1 - r0)) * (rng() < 0.5 ? -1 : 1),
      asm: { head: asmHead, root: assembledRoot(asmHead, b, new Vector3()) },
      exp: { head: expHead, root: explodedRoot(expHead, b, new Vector3()) },
      home,
      mode: this._exploded,
      pending: null,
      delay: 0,
      rank: 0,
      jitter: rng() * 0.02,
      az: Math.atan2(asmHead.z - b.z, asmHead.x - b.x),
      dragging: false,
      dragExploded: false,
      dragStem: new Vector3(),
      last: new Float64Array(7).fill(NaN),
    };
    const slot = e.mode ? e.exp : e.asm;
    if (spawnAbove) {
      // drop in from above the bouquet
      const sh = new Vector3((rng() - 0.5) * 0.3, b.y + 1.15 + rng() * 0.2, (rng() - 0.5) * 0.3);
      e.head.snapTo(sh);
      e.root.snapTo(new Vector3(sh.x * 0.5, sh.y - 0.7, sh.z * 0.5));
      e.roll.x = e.roll.target = e.mode ? e.rollOffset : 0;
      e.roll.x += (rng() - 0.5) * 1.2;
    } else {
      e.head.snapTo(slot.head);
      e.root.snapTo(slot.root);
      e.roll.x = e.roll.target = e.mode ? e.rollOffset : 0;
    }
    this.entries.push(e);
    this.list.push(record);
    this.applyTargets(e);
    this.pushPose(e, true);
    return e;
  }

  remove(id: number): void {
    const i = this.entries.findIndex((e) => e.record.id === id);
    if (i < 0) return;
    const e = this.entries[i];
    this.entries.splice(i, 1);
    this.list.splice(i, 1);
    // Fly up and away from where it is now (springs keep position and velocity), then dispose.
    const b = this.bindingPoint;
    const out = new Vector3().subVectors(e.head.pos, b).setY(0).normalize().multiplyScalar(0.3);
    e.head.target.copy(e.head.pos).add(out).add(new Vector3(0, 1.4, 0));
    e.root.target.copy(e.root.pos).add(out).add(new Vector3(0, 1.4, 0));
    e.record.visual.setHighlighted(false);
    e.roll.target = 0; // the bloom unwinds on the way out instead of snapping
    this.leaving.push({ visual: e.record.visual, head: e.head, root: e.root, roll: e.roll, omega: e.omega * 0.8, t: 0 });
    this.relayout();
    this.events?.onChange?.();
  }

  // ---------------------------------------------------------------- explode

  setExploded(on: boolean): void {
    if (on === this._exploded) return;
    this._exploded = on;
    const sorted = [...this.entries].sort((a, b) => thetaOf(a, this.bindingPoint) - thetaOf(b, this.bindingPoint));
    sorted.forEach((e, i) => (e.rank = sorted.length > 1 ? i / (sorted.length - 1) : 0));
    for (const e of this.entries) {
      if (e.dragging) continue; // joins the new state on release
      if (e.mode === on) {
        e.pending = null; // reversal before this flower started moving: nothing to do
        continue;
      }
      const lead = on ? e.rank : 1 - e.rank; // inner first on explode, outer first on assemble
      e.pending = on;
      e.delay = lead * TUNING.stagger + e.jitter;
    }
    this.events?.onChange?.();
  }

  toggleExploded(): void {
    this.setExploded(!this._exploded);
  }

  // ---------------------------------------------------------------- drag

  headPosition(id: number): Vector3 {
    const e = this.find(id);
    return e ? e.head.pos : this.bindingPoint.clone();
  }

  beginDrag(id: number): void {
    const e = this.find(id);
    if (!e || e.dragging) return;
    e.dragging = true;
    e.dragExploded = this._exploded;
    e.pending = null;
    // Spring state (position, velocity) is kept; only stiffness changes. The target is parked at the
    // current position so the stiff spring doesn't yank the flower toward its old slot.
    e.dragStem.subVectors(e.head.target, e.root.target);
    e.head.target.copy(e.head.pos);
    e.root.target.copy(e.root.pos);
  }

  dragTo(id: number, worldHead: Vector3): void {
    const e = this.find(id);
    if (!e || !e.dragging) return;
    const b = this.bindingPoint;
    if (!e.dragExploded) {
      e.az = projectDome(worldHead, b, true, e.az, e.head.target);
      assembledRoot(e.head.target, b, e.root.target);
    } else {
      const c = explodedCentre(b);
      const off = new Vector3().subVectors(worldHead, c);
      const l = off.length();
      const R = 0.95;
      if (l > 1e-6) off.multiplyScalar(softMax(l, R, 0.15) / l);
      e.head.target.copy(c).add(off);
      const floor = b.y + EXPLODED.minHeadAboveBinding;
      e.head.target.y = floor + softMin(e.head.target.y - floor, 0, 0.05);
      e.root.target.subVectors(e.head.target, e.dragStem);
      e.root.target.y = DOME.rootMinY + softMin(e.root.target.y - DOME.rootMinY, 0, 0.04);
    }
  }

  endDrag(id: number): void {
    const e = this.find(id);
    if (!e || !e.dragging) return;
    const b = this.bindingPoint;
    if (e.dragExploded) {
      e.exp.head.copy(e.head.target);
      e.exp.root.copy(e.root.target);
      e.home = null;
      e.az = projectDome(e.exp.head, b, false, e.az, e.asm.head);
    } else {
      e.asm.head.copy(e.head.target);
      e.home = homeExploded(e.asm.head, b, e.record.variety);
    }
    e.dragging = false;
    e.mode = this._exploded; // join whatever state we are in now; targets change, state does not
    this.relayout(e);
  }

  // ---------------------------------------------------------------- frame

  update(dtIn: number): void {
    const dt = Math.min(Math.max(Number.isFinite(dtIn) ? dtIn : 0, 0), MAX_DT);
    for (const e of this.entries) {
      if (e.pending !== null) {
        e.delay -= dt;
        if (e.delay <= 0) {
          e.mode = e.pending;
          e.pending = null;
        }
      }
      if (!e.dragging) this.applyTargets(e);
      const w = e.dragging ? TUNING.dragOmega : e.omega;
      const z = e.dragging ? TUNING.dragZeta : e.zeta;
      e.head.step(dt, w, z);
      e.root.step(dt, w, z);
      e.roll.step(dt, e.omega * 0.8, Math.min(e.zeta + 0.05, 0.85));
      this.pushPose(e, false);
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.t += dt;
      l.head.step(dt, TUNING.leaveOmega, 0.9);
      l.root.step(dt, TUNING.leaveOmega, 0.9);
      l.roll.step(dt, l.omega, 0.85);
      l.visual.setPose(l.root.pos, l.head.pos, l.roll.x);
      // Scale the whole visual object about the head. setPose only touches the stem and head child groups,
      // so object.scale/position do not interfere with it.
      const u = Math.min(1, Math.max(0, (l.t / TUNING.leaveTime - LEAVE_SHRINK_FROM) / (1 - LEAVE_SHRINK_FROM)));
      const sc = Math.max(1e-4, 1 - u * u * (3 - 2 * u));
      const o = l.visual.object;
      o.scale.setScalar(sc);
      o.position.copy(l.head.pos).multiplyScalar(1 - sc);
      if (l.t >= TUNING.leaveTime) {
        this.scene.remove(l.visual.object);
        l.visual.dispose();
        this.leaving.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- internals

  private find(id: number): Entry | undefined {
    return this.entries.find((e) => e.record.id === id);
  }

  private applyTargets(e: Entry): void {
    const s = e.mode ? e.exp : e.asm;
    e.head.target.copy(s.head);
    e.root.target.copy(s.root);
    e.roll.target = e.mode ? e.rollOffset : 0;
  }

  private pushPose(e: Entry, force: boolean): void {
    const L = e.last;
    const h = e.head.pos;
    const r = e.root.pos;
    const ro = e.roll.x;
    if (
      !force &&
      Math.abs(L[0] - r.x) + Math.abs(L[1] - r.y) + Math.abs(L[2] - r.z) +
        Math.abs(L[3] - h.x) + Math.abs(L[4] - h.y) + Math.abs(L[5] - h.z) +
        Math.abs(L[6] - ro) < 1e-6
    )
      return;
    L[0] = r.x; L[1] = r.y; L[2] = r.z; L[3] = h.x; L[4] = h.y; L[5] = h.z; L[6] = ro;
    e.record.visual.setPose(r, h, ro);
  }

  private assembledItems(): AssembledItem[] {
    return this.entries.map((e) => ({ head: e.asm.head, variety: e.record.variety }));
  }

  /** Recompute both layouts after add/remove/drag. Slots move; springs carry flowers there smoothly. */
  private relayout(anchor?: Entry): void {
    const b = this.bindingPoint;
    const asm = this.entries.map((e) => ({ head: e.asm.head, variety: e.record.variety, anchor: e === anchor }));
    relaxAssembled(asm, b);
    const prev = this.entries.map((e) => e.exp.head.clone());
    const exp: ExplodedItem[] = this.entries.map((e) => {
      if (e.home) e.home = homeExploded(e.asm.head, b, e.record.variety);
      return { head: e.exp.head, variety: e.record.variety, home: e.home, anchor: e === anchor };
    });
    relaxExploded(exp, b);
    this.entries.forEach((e, i) => {
      assembledRoot(e.asm.head, b, e.asm.root);
      if (e.home) explodedRoot(e.exp.head, b, e.exp.root);
      else {
        // user-placed: the stem keeps its shape and moves with the head
        e.exp.root.add(prev[i].negate().add(e.exp.head));
        e.exp.root.y = Math.max(e.exp.root.y, DOME.rootMinY);
      }
    });
    // pending/new staggers use fresh slots; ranks refresh on the next setExploded
  }
}

function thetaOf(e: Entry, b: Vector3): number {
  const dx = e.asm.head.x - b.x;
  const dz = e.asm.head.z - b.z;
  return Math.atan2(Math.hypot(dx, dz), e.asm.head.y - b.y);
}
