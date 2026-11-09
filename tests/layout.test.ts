import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BLOOM_RADIUS, DOME, EXPLODED, explodedCentre, pairGap } from '../src/bouquet/layout';
import type { VarietyId } from '../src/types';
import { Sim, assertNoJumps, distToLine, motion, bounds } from './helpers';

const B = new Vector3(0, 0.35, 0);

function heads(s: Sim) {
  return s.b.flowers.map((f) => ({ id: f.id, v: f.variety, h: s.visuals.get(f.id)!.head.clone(), r: s.visuals.get(f.id)!.root.clone() }));
}

describe('starter bouquet', () => {
  it('has 17 flowers of all five varieties, deterministic from seed', () => {
    const a = new Sim(1 / 60, { seed: 4 });
    const b = new Sim(1 / 60, { seed: 4 });
    const c = new Sim(1 / 60, { seed: 5 });
    expect(a.b.flowers.length).toBe(17);
    expect(new Set(a.b.flowers.map((f) => f.variety)).size).toBe(5);
    const ha = heads(a);
    const hb = heads(b);
    const hc = heads(c);
    ha.forEach((p, i) => expect(p.h.distanceTo(hb[i].h)).toBe(0));
    expect(ha.some((p, i) => p.h.distanceTo(hc[i].h) > 0.01)).toBe(true);
  });

  it('sets userData.flowerId on pick targets and adds visuals to the scene', () => {
    const s = new Sim();
    for (const f of s.b.flowers) for (const t of f.visual.pickTargets) expect(t.userData.flowerId).toBe(f.id);
    expect(s.b.pickTargets.length).toBe(34);
    expect(s.scene.children.length).toBe(17);
  });

  it('is composed: focal high and central, filler low and wide, no bloom overlap', () => {
    const s = new Sim();
    const hs = heads(s);
    const mean = (v: VarietyId[], f: (h: Vector3) => number) => {
      const xs = hs.filter((x) => v.includes(x.v)).map((x) => f(x.h));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    const angle = (h: Vector3) => Math.acos(h.clone().sub(B).normalize().y);
    expect(mean(['rose', 'peony'], (h) => h.y)).toBeGreaterThan(mean(['tulip', 'daisy'], (h) => h.y));
    expect(mean(['tulip', 'daisy'], (h) => h.y)).toBeGreaterThan(mean(['eucalyptus'], (h) => h.y));
    expect(mean(['eucalyptus'], angle)).toBeGreaterThan(mean(['rose', 'peony'], angle));
    for (const x of hs) {
      const d = x.h.distanceTo(B);
      expect(d).toBeGreaterThanOrEqual(DOME.dMin - 1e-6);
      expect(d).toBeLessThanOrEqual(DOME.dMax + 1e-6);
      expect(angle(x.h)).toBeLessThanOrEqual(DOME.coneMax + 1e-6);
      expect(x.h.y).toBeLessThanOrEqual(0.96);
    }
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++)
        expect(hs[i].h.distanceTo(hs[j].h), `${hs[i].v}/${hs[j].v}`).toBeGreaterThanOrEqual(pairGap(hs[i].v, hs[j].v) - 1e-6);
  });
});

describe('4. convergence', () => {
  const check = (s: Sim, label: string) => {
    let worst = 0;
    for (const x of heads(s)) {
      worst = Math.max(worst, distToLine(B, x.r, x.h));
      expect(x.r.y, label).toBeGreaterThanOrEqual(DOME.rootMinY - 1e-9);
      // root is past the binding point on the opposite side from the head
      expect(x.r.clone().sub(B).dot(x.h.clone().sub(B)), label).toBeLessThan(0);
      expect(x.r.distanceTo(B)).toBeLessThan(0.3);
    }
    expect(worst, label).toBeLessThan(0.002);
    return worst;
  };
  it('stem lines cross at the binding point after settling', () => {
    const s = new Sim();
    check(s, 'initial');
    s.b.setExploded(true);
    s.run(3);
    s.b.setExploded(false);
    s.run(3);
    check(s, 'after cycle');
  });
  it('still true after adds, removes and dragging', () => {
    const s = new Sim();
    s.add('rose');
    s.add('eucalyptus');
    s.b.remove(s.b.flowers[4].id);
    const id = s.b.flowers[2].id;
    s.b.beginDrag(id);
    s.b.dragTo(id, new Vector3(-0.4, 0.8, 0.2));
    s.run(0.5);
    s.b.endDrag(id);
    s.run(3);
    check(s, 'edited');
  });
});

describe('5. exploded layout', () => {
  const C = explodedCentre(B);
  const verify = (s: Sim, label: string, allowTouch = 0) => {
    const hs = heads(s);
    for (const x of hs) {
      expect(x.h.distanceTo(C) + BLOOM_RADIUS[x.v], `${label} fit`).toBeLessThanOrEqual(EXPLODED.radius + 1e-6);
      expect(x.h.distanceTo(x.r), `${label} stem`).toBeLessThanOrEqual(EXPLODED.maxStem + 1e-6);
      expect(x.r.y).toBeGreaterThanOrEqual(DOME.rootMinY - 1e-9);
    }
    let worstOverlap = 0;
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++)
        worstOverlap = Math.max(worstOverlap, BLOOM_RADIUS[hs[i].v] + BLOOM_RADIUS[hs[j].v] - hs[i].h.distanceTo(hs[j].h));
    expect(worstOverlap, `${label} overlap`).toBeLessThanOrEqual(allowTouch + 1e-6);
  };

  it('starter: blooms apart, inside the sphere, stems oriented outward', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(4);
    verify(s, 'starter');
    for (const x of heads(s)) {
      const stem = x.h.clone().sub(x.r).normalize();
      const out = x.h.clone().sub(B).normalize();
      expect(stem.dot(out)).toBeGreaterThan(0.99);
    }
    // it actually spreads wider than the assembled bouquet
    const spread = (s2: Sim) => Math.max(...heads(s2).map((x) => Math.hypot(x.h.x, x.h.z)));
    expect(spread(s)).toBeGreaterThan(spread(new Sim()) * 1.4);
  });

  it('stays fitted and unoverlapped while growing to 30 flowers', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(3);
    const kinds: VarietyId[] = ['rose', 'tulip', 'daisy', 'peony', 'eucalyptus'];
    for (let i = 0; s.b.flowers.length < 30; i++) {
      s.add(kinds[i % 5], i % 3);
      s.run(0.4);
    }
    s.run(4);
    verify(s, '30 flowers');
    assertNoJumps(s, 'grow');
  });

  it('30 flowers also fit when added while assembled, then exploded', () => {
    const s = new Sim();
    const kinds: VarietyId[] = ['peony', 'rose', 'daisy', 'tulip', 'eucalyptus'];
    for (let i = 0; s.b.flowers.length < 30; i++) s.add(kinds[i % 5]);
    s.run(2);
    s.b.setExploded(true);
    s.run(4);
    verify(s, '30 assembled-then-exploded');
  });

  it('reflows gently on remove while exploded', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(3);
    const before = heads(s);
    s.b.remove(s.b.flowers[7].id);
    s.run(3);
    const after = heads(s);
    verify(s, 'after remove');
    for (const a of after) {
      const p = before.find((x) => x.id === a.id)!;
      expect(a.h.distanceTo(p.h)).toBeLessThan(0.15);
    }
  });
});

describe('6. assembled drag constraint', () => {
  it('absurd drag targets keep head in the dome and root above the floor, every frame', () => {
    const targets = [
      new Vector3(50, -30, 20), new Vector3(0, -5, 0), new Vector3(-10, 10, 0), new Vector3(0, 100, 0),
      new Vector3(0, 0.35, 0), new Vector3(0.001, 0.36, 0), new Vector3(3, 0.35, -3), new Vector3(-0.3, 0.2, 0.1),
    ];
    for (const t of targets) {
      const s = new Sim();
      const id = s.b.flowers[0].id;
      s.b.beginDrag(id);
      for (let i = 0; i < 120; i++) {
        s.b.dragTo(id, t);
        s.step(1);
        const info = s.b.inspect(id)!;
        const d = info.head.distanceTo(B);
        const ang = Math.acos(Math.min(1, info.head.clone().sub(B).normalize().y));
        expect(d).toBeGreaterThanOrEqual(DOME.dMin - 0.02);
        expect(d).toBeLessThanOrEqual(DOME.dMax + 0.02);
        expect(ang).toBeLessThanOrEqual(DOME.coneMax + 0.03);
        expect(info.root.y).toBeGreaterThanOrEqual(DOME.rootMinY - 1e-6);
      }
      const info = s.b.inspect(id)!;
      expect(info.head.distanceTo(B)).toBeLessThanOrEqual(DOME.dMax + 1e-6);
      expect(info.head.distanceTo(B)).toBeGreaterThanOrEqual(DOME.dMin - 1e-6);
      expect(Math.acos(info.head.clone().sub(B).normalize().y)).toBeLessThanOrEqual(DOME.coneMax + 1e-6);
      expect(info.root.y).toBeGreaterThanOrEqual(DOME.rootMinY);
      s.b.endDrag(id);
      s.run(3);
      const h = s.visuals.get(id)!;
      expect(distToLine(B, h.root, h.head)).toBeLessThan(0.002);
    }
  });

  it('dragging inside the dome follows the pointer and keeps stems crossing the binding point in motion', () => {
    const s = new Sim();
    const id = s.b.flowers[0].id;
    s.b.beginDrag(id);
    const v = s.visuals.get(id)!;
    const start = v.head.clone();
    let worstLine = 0;
    for (let i = 0; i < 90; i++) {
      s.b.dragTo(id, start.clone().add(new Vector3(0.002 * i, 0, 0.0015 * i)));
      s.step(1);
      worstLine = Math.max(worstLine, distToLine(B, v.root, v.head));
    }
    expect(worstLine).toBeLessThan(0.03); // springs for root and head differ only in transit
    expect(v.head.distanceTo(start)).toBeGreaterThan(0.1);
  });

  it('drag motion is bounded by pointer speed (stiff follow, no snap)', () => {
    const s = new Sim();
    const id = s.b.flowers[0].id;
    const v = s.visuals.get(id)!;
    s.b.beginDrag(id);
    const start = v.head.clone();
    const speed = 0.9; // units per second, a brisk finger
    let prev = v.head.clone();
    let worst = 0;
    for (let i = 0; i < 90; i++) {
      s.b.dragTo(id, start.clone().add(new Vector3(speed * s.t, 0, 0)));
      s.step(1);
      worst = Math.max(worst, v.head.distanceTo(prev));
      prev = v.head.clone();
    }
    // zeta 0.85 follower of a ramp: overshoot of speed under 5%, plus the soft clamp only slows
    expect(worst).toBeLessThanOrEqual(speed * s.dt * 1.1);
  });
});

describe('beginDrag / endDrag on moving flowers', () => {
  for (const tMs of [30, 100, 200, 350]) {
    it(`grab at ${tMs} ms into an explosion: no jump, and release rejoins smoothly`, () => {
      const s = new Sim();
      s.b.setExploded(true);
      s.run(tMs / 1000);
      const id = s.b.flowers[0].id;
      const v = s.visuals.get(id)!;
      const tr = s.traces.get(id)!;
      const v0 = s.b.inspect(id)!.headVel.clone();
      const x0 = v.head.clone();
      s.b.beginDrag(id);
      s.step(1);
      // moved by (about) its existing velocity, not teleported
      expect(v.head.distanceTo(x0)).toBeLessThanOrEqual(v0.length() * s.dt * 1.5 + 0.004);
      const hold = v.head.clone();
      for (let i = 0; i < 30; i++) {
        s.b.dragTo(id, hold.add(new Vector3(0.003, 0.001, 0)).clone());
        s.step(1);
      }
      s.b.setExploded(false); // toggled while held
      s.run(0.4);
      s.b.endDrag(id);
      s.run(3);
      const m = motion(tr);
      // stiff follower bound: its own spring (w=38) times the lag distance, plus coasting speed
      const stepBound = Math.max(v0.length(), 0.35) * s.dt * 1.6;
      expect(m.step).toBeLessThanOrEqual(Math.max(stepBound, bounds(tr, s.dt).step));
      expect(s.b.exploded).toBe(false);
      expect(s.b.settling).toBe(false);
      // it rejoined the assembled bouquet: stem crosses the binding point
      expect(distToLine(B, v.root, v.head)).toBeLessThan(0.002);
    });
  }

  it('release moves smoothly (max frame step after release is below the pre-release follower bound)', () => {
    const s = new Sim();
    const id = s.b.flowers[0].id;
    const v = s.visuals.get(id)!;
    s.b.beginDrag(id);
    s.b.dragTo(id, new Vector3(0.25, 0.9, 0.1));
    s.run(0.6);
    s.b.endDrag(id);
    const tr = s.traces.get(id)!;
    const n0 = tr.pos.length;
    s.run(1.5);
    const after = { ...tr, pos: tr.pos.slice(n0 - 3) };
    expect(motion(after).accel).toBeLessThan(0.004);
    expect(v.head.distanceTo(B)).toBeLessThanOrEqual(DOME.dMax + 1e-6);
  });
});

describe('7. exploded-drag carry-through', () => {
  it('a flower moved while exploded reassembles on the side it was moved to', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(3);
    const id = s.b.flowers[0].id; // a rose
    const target = new Vector3(0.42, 0.55, 0.0);
    s.b.beginDrag(id);
    const from = s.visuals.get(id)!.head.clone();
    for (let i = 0; i < 90; i++) {
      s.b.dragTo(id, from.clone().lerp(target, Math.min(1, i / 45))); // finger moving ~0.4 u/s
      s.step(1);
    }
    s.b.endDrag(id);
    s.run(2);
    const expHead = s.visuals.get(id)!.head.clone();
    expect(expHead.distanceTo(target)).toBeLessThan(0.08); // stays where it was dropped
    s.b.setExploded(false);
    s.run(3.5);
    const h = s.visuals.get(id)!.head.clone().sub(B);
    const az = Math.atan2(h.z, h.x);
    expect(Math.abs(az)).toBeLessThan(0.1); // +x side, like the drag
    expect(Math.acos(h.y / h.length())).toBeGreaterThan(DOME.coneMax - 0.05); // pushed out to the cone edge
    // a baseline flower is not dragged to that side
    const base = new Sim();
    const bh = base.visuals.get(base.b.flowers[0].id)!.head.clone().sub(B);
    expect(Math.acos(bh.y / bh.length())).toBeLessThan(DOME.coneMax - 0.2);
    assertNoJumps(s, 'carry-through', [id]);
  });

  it('a drag released while exploded keeps neighbours un-overlapped in both layouts', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(3);
    const id = s.b.flowers[0].id;
    s.b.beginDrag(id);
    const nb = s.visuals.get(s.b.flowers[8].id)!.head.clone();
    for (let i = 0; i < 40; i++) {
      s.b.dragTo(id, nb);
      s.step(1);
    }
    s.b.endDrag(id);
    s.run(3);
    const hs = heads(s);
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++)
        expect(hs[i].h.distanceTo(hs[j].h)).toBeGreaterThanOrEqual(BLOOM_RADIUS[hs[i].v] + BLOOM_RADIUS[hs[j].v] - 1e-3);
  });
});

describe('API extras', () => {
  it('explodeProgress goes 0 -> 1 -> 0', () => {
    const s = new Sim();
    expect(s.b.explodeProgress).toBeLessThan(0.01);
    s.b.setExploded(true);
    s.run(0.3);
    const mid = s.b.explodeProgress;
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.99);
    s.run(3);
    expect(s.b.explodeProgress).toBeGreaterThan(0.99);
    s.b.setExploded(false);
    s.run(3);
    expect(s.b.explodeProgress).toBeLessThan(0.01);
  });
  it('fires onChange', () => {
    let n = 0;
    const s = new Sim();
    (s.b as unknown as { events: { onChange(): void } }).events = { onChange: () => n++ };
    s.b.toggleExploded();
    s.add('rose');
    s.b.remove(s.b.flowers[0].id);
    expect(n).toBe(3);
  });
});
