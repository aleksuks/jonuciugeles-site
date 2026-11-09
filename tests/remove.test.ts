import { describe, expect, it } from 'vitest';
import { Sim } from './helpers';

describe('removing a flower', () => {
  it('does not snap its roll when removed while exploded', () => {
    const s = new Sim();
    s.b.setExploded(true);
    s.run(3);
    let checked = 0;
    for (const f of [...s.b.flowers].slice(0, 8)) {
      const vis = s.visuals.get(f.id)!;
      let prev = vis.roll;
      expect(Math.abs(prev), 'exploded flowers carry roll').toBeGreaterThan(0.2);
      s.b.remove(f.id);
      let maxStep = 0;
      for (let i = 0; i < 40 && !vis.disposed; i++) {
        s.b.update(1 / 60);
        maxStep = Math.max(maxStep, Math.abs(vis.roll - prev));
        prev = vis.roll;
      }
      // a roll spring of w ~ 6-7 rad/s moves at most ~2.6 rad/s: well under 0.08 rad per 1/60 s frame
      expect(maxStep, `flower ${f.id}`).toBeLessThan(0.08);
      checked++;
    }
    expect(checked).toBe(8);
  });
});
