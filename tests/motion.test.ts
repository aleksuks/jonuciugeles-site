import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Spring3, MAX_DT } from '../src/bouquet/spring';
import { Sim, assertNoJumps, bounds, maxStep, motion, mulberry32 } from './helpers';

const finite = (v: Vector3) => Number.isFinite(v.x + v.y + v.z);

describe('spring', () => {
  it('is exact: one big step equals many small ones', () => {
    const a = new Spring3();
    const b = new Spring3();
    a.target.set(1, 2, 3);
    b.target.set(1, 2, 3);
    a.vel.set(0.5, 0, -1);
    b.vel.set(0.5, 0, -1);
    a.step(0.04, 7, 0.7);
    for (let i = 0; i < 40; i++) b.step(0.001, 7, 0.7);
    expect(a.pos.distanceTo(b.pos)).toBeLessThan(1e-9);
    expect(a.vel.distanceTo(b.vel)).toBeLessThan(1e-9);
  });
  it('clamps dt', () => {
    const a = new Spring3();
    a.target.set(1, 0, 0);
    a.step(100, 7, 0.7);
    const b = new Spring3();
    b.target.set(1, 0, 0);
    b.step(MAX_DT, 7, 0.7);
    expect(a.pos.x).toBe(b.pos.x);
  });
});

describe('1. stability', () => {
  for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 20]) {
    it(`never NaN and settles at dt=${dt.toFixed(4)}`, () => {
      const s = new Sim(dt);
      const rnd = mulberry32(5);
      s.b.setExploded(true);
      s.run(1.5);
      s.b.setExploded(false);
      s.run(1.5);
      s.b.setExploded(true);
      s.run(5);
      for (const f of s.b.flowers) expect(finite(s.b.headPosition(f.id))).toBe(true);
      expect(s.b.settling).toBe(false);
      expect(rnd()).toBeGreaterThan(-1);
    });
  }
  it('survives random hitches including huge dt, NaN and negative dt', () => {
    const s = new Sim(1 / 60);
    const rnd = mulberry32(11);
    for (let i = 0; i < 1500; i++) {
      if (rnd() < 0.02) s.b.toggleExploded();
      const r = rnd();
      const dt = r < 0.05 ? 0.5 + rnd() * 2 : r < 0.1 ? NaN : r < 0.12 ? -0.1 : r < 0.3 ? rnd() * 0.04 : 1 / 240 + rnd() / 60;
      s.b.update(dt);
      for (const f of s.b.flowers) {
        const v = s.visuals.get(f.id)!;
        expect(finite(v.head) && finite(v.root) && Number.isFinite(v.roll)).toBe(true);
      }
    }
    s.settle();
    expect(s.b.settling).toBe(false);
  });
  it('final rest pose does not depend on frame rate', () => {
    const rest = (dt: number) => {
      const s = new Sim(dt);
      s.b.setExploded(true);
      s.run(6);
      return s.b.flowers.map((f) => s.b.headPosition(f.id).clone());
    };
    const a = rest(1 / 240);
    const b = rest(1 / 20);
    a.forEach((p, i) => expect(p.distanceTo(b[i])).toBeLessThan(0.005));
  });
});

describe('2. no-jump at 60 Hz', () => {
  it('explode, then assemble', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(2.5);
    assertNoJumps(s, 'explode');
    s.b.setExploded(false);
    s.run(2.5);
    assertNoJumps(s, 'assemble');
  });

  for (const tMs of [10, 40, 80, 130, 200, 300, 450, 700]) {
    it(`reversal mid-explode at ${tMs} ms`, () => {
      const s = new Sim();
      s.b.setExploded(true);
      s.run(tMs / 1000);
      s.b.setExploded(false);
      s.run(2.5);
      assertNoJumps(s, 'reverse');
    });
    it(`reversal mid-assemble at ${tMs} ms`, () => {
      const s = new Sim();
      s.b.setExploded(true);
      s.run(2);
      s.b.setExploded(false);
      s.run(tMs / 1000);
      s.b.setExploded(true);
      s.run(2.5);
      assertNoJumps(s, 'reverse');
    });
  }

  it('reversal while staggers are pending, at every frame of the stagger window', () => {
    for (let k = 1; k <= 14; k++) {
      const s = new Sim();
      s.b.setExploded(true);
      s.step(k);
      s.b.setExploded(false);
      s.step(k);
      s.b.setExploded(true);
      s.run(2.5);
      assertNoJumps(s, `stagger k=${k}`);
    }
  });

  it('repeated rapid toggling', () => {
    for (const period of [0.03, 0.07, 0.11, 0.2, 0.33]) {
      const s = new Sim();
      for (let i = 0; i < 24; i++) {
        s.b.toggleExploded();
        s.run(period);
      }
      s.run(2.5);
      assertNoJumps(s, `toggle ${period}`);
    }
  });

  it('random toggle times and hitchy dt', () => {
    const rnd = mulberry32(3);
    const s = new Sim();
    for (let i = 0; i < 60; i++) {
      if (rnd() < 0.15) s.b.toggleExploded();
      s.step(1);
    }
    assertNoJumps(s, 'random');
  });

  it('detector sanity: a 5 cm teleport would be caught', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(0.3);
    const tr = [...s.traces.values()][0];
    const bd = bounds(tr, s.dt);
    tr.pos[10].add(new Vector3(0.05, 0, 0));
    expect(motion(tr).accel).toBeGreaterThan(bd.accel);
  });
});

describe('3. velocity continuity at reversal', () => {
  for (const tMs of [20, 60, 120, 200, 350, 500]) {
    it(`velocity survives a reversal at ${tMs} ms`, () => {
      const s = new Sim();
      s.b.setExploded(true);
      s.run(tMs / 1000);
      const before = s.b.flowers.map((f) => s.b.inspect(f.id)!.headVel.clone());
      s.b.setExploded(false);
      // the reversal call itself changes nothing
      s.b.flowers.forEach((f, i) => expect(s.b.inspect(f.id)!.headVel.distanceTo(before[i])).toBe(0));
      s.step(1);
      s.b.flowers.forEach((f, i) => {
        const tr = s.traces.get(f.id)!;
        const a = tr.omega * tr.omega * tr.d * (1.25 + 1.5 * tr.zeta);
        const dv = s.b.inspect(f.id)!.headVel.distanceTo(before[i]);
        expect(dv).toBeLessThanOrEqual(a * s.dt);
      });
    });
  }
});

describe('8. add and remove', () => {
  it('add during explosion: survivors never jump, newcomer drops in', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(0.25);
    const r = s.add('rose');
    s.run(0.2);
    s.add('tulip');
    s.run(3);
    assertNoJumps(s, 'add');
    const v = s.visuals.get(r.id)!;
    expect(s.b.flowers.length).toBe(19);
    expect(s.b.settling).toBe(false);
    expect(v.head.y).toBeGreaterThan(0.3);
    expect(s.scene.children.length).toBe(19);
  });

  it('remove during explosion and assembly', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(0.2);
    const removed = s.b.flowers[3];
    const rv = s.visuals.get(removed.id)!;
    const x0 = rv.head.clone();
    s.b.remove(removed.id);
    expect(s.b.flowers.find((f) => f.id === removed.id)).toBeUndefined();
    expect(s.b.pickTargets.length).toBe(16 * 2);
    s.step(1);
    expect(rv.head.distanceTo(x0)).toBeLessThan(0.1); // leaves by moving, not by popping
    s.b.setExploded(false);
    s.run(0.15);
    s.b.remove(s.b.flowers[0].id);
    s.run(2.5);
    for (const [id, tr] of s.traces) {
      if (id === removed.id || id === 1) continue;
      expect(motion(tr).accel).toBeLessThanOrEqual(bounds(tr, s.dt).accel);
    }
    expect(rv.disposed).toBe(true);
    expect(s.scene.children.length).toBe(15);
  });

  it('remove while dragging does not throw; further drag calls are no-ops', () => {
    const s = new Sim();
    const id = s.b.flowers[2].id;
    s.b.beginDrag(id);
    s.b.dragTo(id, new Vector3(0.3, 0.9, 0));
    s.run(0.1);
    expect(() => s.b.remove(id)).not.toThrow();
    expect(() => {
      s.b.dragTo(id, new Vector3());
      s.b.endDrag(id);
      s.b.remove(id);
      s.b.beginDrag(id);
    }).not.toThrow();
    s.run(2);
    assertNoJumps(s, 'remove dragged', [id]);
    // the departing flower itself: leave spring w=9, travel ~1.6, zeta 0.9
    const lv = s.traces.get(id)!;
    expect(motion(lv).accel).toBeLessThan(81 * 1.6 * (1.25 + 1.5 * 0.9) * s.dt * s.dt);
  });

  it('add and remove while another flower is dragged', () => {
    const s = new Sim();
    const id = s.b.flowers[1].id;
    s.b.setExploded(true);
    s.run(0.3);
    s.b.beginDrag(id);
    for (let i = 0; i < 40; i++) {
      s.b.dragTo(id, s.b.headPosition(id).clone().add(new Vector3(0.004, 0.002, 0)));
      if (i === 10) s.add('daisy');
      if (i === 20) s.b.remove(s.b.flowers[5].id);
      s.step(1);
    }
    s.b.endDrag(id);
    s.run(3);
    for (const [fid, tr] of s.traces) {
      if (fid === id) continue;
      expect(motion(tr).accel).toBeLessThanOrEqual(bounds(tr, s.dt).accel);
    }
  });
});

describe('report', () => {
  // visual settle: every head within 5 mm of its slot and slower than 5 cm/s
  const visuallySettled = (s: Sim, exploded: boolean) =>
    s.b.flowers.every((f) => {
      const i = s.b.inspect(f.id)!;
      return i.head.distanceTo(exploded ? i.exp.head : i.asm.head) < 0.005 && i.headVel.length() < 0.05;
    });

  it('prints max per-frame head motion and settle time', () => {
    const rows: string[] = [];
    for (const dt of [1 / 60, 1 / 30]) {
      const s = new Sim(dt);
      const phase = (exploded: boolean) => {
        s.traces.clear();
        s.b.setExploded(exploded);
        const t0 = s.t;
        let visual = 0;
        let strict = 0;
        for (let i = 0; i < 600 && !strict; i++) {
          s.step(1);
          if (!visual && visuallySettled(s, exploded)) visual = s.t - t0;
          if (!s.b.settling) strict = s.t - t0;
        }
        let ratio = 0;
        for (const tr of s.traces.values()) ratio = Math.max(ratio, motion(tr).accel / bounds(tr, dt).accel);
        return { step: maxStep(s), visual, strict, ratio };
      };
      const e = phase(true);
      const a = phase(false);
      const fmt = (p: typeof e) =>
        `max head step ${p.step.toFixed(4)}/frame (${(p.step / dt).toFixed(2)} u/s), settle 5mm ${p.visual.toFixed(2)} s / 1.5mm ${p.strict.toFixed(2)} s, accel/bound ${p.ratio.toFixed(2)}`;
      rows.push(`${(1 / dt).toFixed(0).padStart(3)} Hz | explode: ${fmt(e)}
       | assemble: ${fmt(a)}`);
      expect(e.visual).toBeGreaterThan(0.7);
      expect(e.visual).toBeLessThan(1.3);
      expect(a.visual).toBeLessThan(1.3);
      expect(e.strict).toBeLessThan(1.7);
    }
    console.log('\n' + rows.join('\n'));
  });
});
