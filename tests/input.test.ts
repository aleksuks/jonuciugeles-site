import { describe, expect, it } from 'vitest';
import { ASSEMBLED_SLOP, EXPLODED_SLOP, Gesture, HOLD_MS, type Command } from '../src/input/gesture';

/** Flower 7 sits at x < 100; everything else is empty space. */
function rig(exploded = false) {
  const cmds: Command[] = [];
  const state = { exploded, picks: 0 };
  const g = new Gesture({
    pick: (x) => {
      state.picks++;
      return x < 100 ? 7 : null;
    },
    isExploded: () => state.exploded,
    emit: (c) => cmds.push(c),
  });
  const types = () => cmds.map((c) => c.type);
  const count = (t: Command['type']) => cmds.filter((c) => c.type === t).length;
  const clear = () => (cmds.length = 0);
  return { g, cmds, state, types, count, clear };
}

const F = { x: 50, y: 50 }; // on the flower
const E = { x: 300, y: 300 }; // empty space

describe('empty space', () => {
  it('orbits immediately and a short press is a tap(null)', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerMove(1, E.x + 5, E.y, 10);
    expect(r.cmds).toContainEqual({ type: 'orbit', dx: 5, dy: 0 });
    r.g.pointerUp(1, 500);
    expect(r.count('tap')).toBe(1);
    expect(r.cmds.find((c) => c.type === 'tap')).toEqual({ type: 'tap', id: null });
    expect(r.g.mode).toBe('idle');
  });

  it('a drag beyond the slop is not a tap', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerMove(1, E.x + 20, E.y, 10);
    r.g.pointerUp(1, 20);
    expect(r.count('tap')).toBe(0);
  });

  it('release velocity averages the last 80 ms, and is zero if the pointer rested', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    for (let i = 1; i <= 10; i++) r.g.pointerMove(1, E.x + i * 10, E.y, i * 10); // 1000 px/s
    r.g.pointerUp(1, 100);
    const rel = r.cmds.find((c) => c.type === 'orbitRelease') as Extract<Command, { type: 'orbitRelease' }>;
    expect(rel.vx).toBeCloseTo(1000, 5);
    expect(rel.vy).toBe(0);

    const s = rig();
    s.g.pointerDown(1, E.x, E.y, 0);
    for (let i = 1; i <= 10; i++) s.g.pointerMove(1, E.x + i * 10, E.y, i * 10);
    s.g.pointerUp(1, 100 + 120); // sat still for 120 ms
    const rel2 = s.cmds.find((c) => c.type === 'orbitRelease') as Extract<Command, { type: 'orbitRelease' }>;
    expect(rel2).toEqual({ type: 'orbitRelease', vx: 0, vy: 0 });
  });

  it('only counts samples inside the window', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerMove(1, E.x + 500, E.y, 10); // fast, but old
    r.g.pointerMove(1, E.x + 510, E.y, 120);
    r.g.pointerMove(1, E.x + 520, E.y, 140);
    r.g.pointerUp(1, 150);
    const rel = r.cmds.find((c) => c.type === 'orbitRelease') as Extract<Command, { type: 'orbitRelease' }>;
    expect(rel.vx).toBeCloseTo(500, 5);
  });
});

describe('assembled, down on a flower', () => {
  it('gives press feedback, then a quick release is a tap with feedback cleared', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    expect(r.cmds).toEqual([{ type: 'pressFeedback', id: 7 }]);
    r.g.pointerUp(1, 100);
    expect(r.cmds.slice(1)).toEqual([
      { type: 'pressFeedback', id: null },
      { type: 'tap', id: 7 },
    ]);
  });

  it('boundary: 7 px stays pending, 9 px orbits (distance, not per axis)', () => {
    const a = rig();
    a.g.pointerDown(1, F.x, F.y, 0);
    a.g.pointerMove(1, F.x + 7, F.y, 20);
    expect(a.g.mode).toBe('pending');
    a.g.pointerUp(1, 100);
    expect(a.count('tap')).toBe(1);

    const b = rig();
    b.g.pointerDown(1, F.x, F.y, 0);
    b.g.pointerMove(1, F.x + 9, F.y, 20);
    expect(b.g.mode).toBe('orbit');
    expect(b.cmds).toContainEqual({ type: 'pressFeedback', id: null });
    expect(b.cmds).toContainEqual({ type: 'orbit', dx: 9, dy: 0 });
    b.g.pointerUp(1, 60);
    expect(b.count('tap')).toBe(0);

    const c = rig();
    c.g.pointerDown(1, F.x, F.y, 0);
    c.g.pointerMove(1, F.x + ASSEMBLED_SLOP, F.y, 20);
    expect(c.g.mode).toBe('pending'); // exactly 8 is not "more than 8"
    c.g.pointerMove(1, F.x + 6, F.y + 6, 30); // 8.49 diagonal
    expect(c.g.mode).toBe('orbit');
  });

  it('boundary: 179 ms is a tap, 181 ms is a drag', () => {
    const a = rig();
    a.g.pointerDown(1, F.x, F.y, 1000);
    a.g.pointerUp(1, 1000 + HOLD_MS - 1);
    expect(a.count('tap')).toBe(1);
    expect(a.count('dragStart')).toBe(0);

    const b = rig();
    b.g.pointerDown(1, F.x, F.y, 1000);
    b.g.pointerUp(1, 1000 + HOLD_MS + 1);
    expect(b.count('tap')).toBe(0);
    expect(b.count('dragStart')).toBe(1);
    expect(b.count('dragEnd')).toBe(1);
  });

  it('tick starts the drag at the hold, with feedback cleared first, at the pointer position', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerMove(1, F.x + 3, F.y + 2, 50);
    r.g.tick(179);
    expect(r.count('dragStart')).toBe(0);
    r.g.tick(180);
    expect(r.cmds.slice(-2)).toEqual([
      { type: 'pressFeedback', id: null },
      { type: 'dragStart', id: 7, x: F.x + 3, y: F.y + 2 },
    ]);
    r.g.pointerMove(1, F.x + 40, F.y, 200);
    expect(r.cmds.at(-1)).toEqual({ type: 'dragMove', x: F.x + 40, y: F.y });
    r.g.pointerUp(1, 300);
    expect(r.cmds.at(-1)).toEqual({ type: 'dragEnd' });
    expect(r.count('tap')).toBe(0);
  });

  it('hitch: a big move arriving after the hold elapsed drags, it does not orbit', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerMove(1, F.x + 60, F.y, 400); // no tick ran for 400 ms
    expect(r.types()).toEqual(['pressFeedback', 'pressFeedback', 'dragStart', 'dragMove']);
    const start = r.cmds[2] as Extract<Command, { type: 'dragStart' }>;
    expect([start.x, start.y]).toEqual([F.x, F.y]); // starts where the pointer was, so no jump
    expect(r.count('orbit')).toBe(0);
  });

  it('hitch: release after the hold elapsed is a drag start then end, not a tap', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerUp(1, 5000);
    expect(r.types()).toEqual(['pressFeedback', 'pressFeedback', 'dragStart', 'dragEnd']);
  });

  it('hitch: a move beyond the slop just inside the hold window still orbits', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerMove(1, F.x + 30, F.y, 179);
    expect(r.g.mode).toBe('orbit');
    r.g.tick(500);
    expect(r.count('dragStart')).toBe(0);
  });
});

describe('exploded, down on a flower', () => {
  it('no press feedback; boundary 5/6 px pending, 7 px drags at once from the pointer position', () => {
    const a = rig(true);
    a.g.pointerDown(1, F.x, F.y, 0);
    expect(a.cmds).toEqual([]);
    a.g.pointerMove(1, F.x + EXPLODED_SLOP, F.y, 10);
    expect(a.g.mode).toBe('pending');
    a.g.pointerMove(1, F.x + 7, F.y, 20);
    expect(a.cmds).toEqual([{ type: 'dragStart', id: 7, x: F.x + 7, y: F.y }]);
    a.g.pointerMove(1, F.x + 12, F.y, 30);
    expect(a.cmds.at(-1)).toEqual({ type: 'dragMove', x: F.x + 12, y: F.y });
    a.g.pointerUp(1, 40);
    expect(a.cmds.at(-1)).toEqual({ type: 'dragEnd' });
  });

  it('has no hold timer: a long still press is a tap', () => {
    const r = rig(true);
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.tick(10_000);
    r.g.pointerUp(1, 10_001);
    expect(r.cmds).toEqual([{ type: 'tap', id: 7 }]);
  });

  it('uses the exploded state captured at pointer down', () => {
    const r = rig(false);
    r.g.pointerDown(1, F.x, F.y, 0);
    r.state.exploded = true; // flips mid-press
    r.g.pointerMove(1, F.x + 7, F.y, 20); // still assembled rules: pending
    expect(r.g.mode).toBe('pending');
  });
});

describe('second pointer handover', () => {
  const second = { x: 400, y: 100 };

  it('during pending: clears feedback, no tap, enters pinch', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerDown(2, second.x, second.y, 50);
    expect(r.cmds.slice(1)).toEqual([{ type: 'pressFeedback', id: null }]);
    expect(r.g.mode).toBe('pinch');
    r.g.pointerUp(2, 60);
    r.g.pointerUp(1, 70);
    expect(r.count('tap')).toBe(0);
  });

  it('during pending (exploded): nothing started, nothing to end', () => {
    const r = rig(true);
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerDown(2, second.x, second.y, 50);
    expect(r.g.mode).toBe('pinch');
    expect(r.count('dragStart') + r.count('dragEnd') + r.count('tap')).toBe(0);
  });

  it('during orbit: no tap, pinch zooms and the midpoint orbits', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerMove(1, E.x + 20, E.y, 10);
    r.clear();
    r.g.pointerDown(2, E.x + 120, E.y, 20); // 100 px apart, midpoint x = E.x + 70
    r.g.pointerMove(2, E.x + 220, E.y, 30); // 200 px apart; midpoint +50
    expect(r.cmds).toContainEqual({ type: 'pinch', factor: 0.5 });
    expect(r.cmds).toContainEqual({ type: 'orbit', dx: 50, dy: 0 });
    r.g.pointerUp(2, 40);
    r.g.pointerUp(1, 50);
    expect(r.count('tap')).toBe(0);
  });

  it('during an active drag: dragEnd exactly once, then pinch', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.tick(200);
    r.g.pointerDown(2, second.x, second.y, 250);
    expect(r.count('dragEnd')).toBe(1);
    expect(r.g.mode).toBe('pinch');
    r.g.pointerMove(1, F.x + 30, F.y, 260);
    expect(r.count('dragMove')).toBe(0);
    r.g.pointerUp(1, 300);
    r.g.pointerUp(2, 310);
    expect(r.count('dragEnd')).toBe(1);
    expect(r.count('tap')).toBe(0);
  });

  it('pinch factor is previous distance over current distance', () => {
    const r = rig();
    r.g.pointerDown(1, 200, 200, 0);
    r.g.pointerDown(2, 300, 200, 1); // 100 apart
    r.clear();
    r.g.pointerMove(2, 350, 200, 2); // 150 apart: fingers spread
    expect(r.cmds[0]).toEqual({ type: 'pinch', factor: 100 / 150 });
    r.clear();
    r.g.pointerMove(2, 300, 200, 3); // back to 100
    expect((r.cmds[0] as Extract<Command, { type: 'pinch' }>).factor).toBeCloseTo(1.5, 10);
  });

  it('ignores a third pointer entirely', () => {
    const r = rig();
    r.g.pointerDown(1, 200, 200, 0);
    r.g.pointerDown(2, 300, 200, 1);
    r.clear();
    r.g.pointerDown(3, F.x, F.y, 2);
    r.g.pointerMove(3, 90, 90, 3);
    r.g.pointerUp(3, 4);
    expect(r.cmds).toEqual([]);
    expect(r.g.mode).toBe('pinch');
    expect(r.state.picks).toBe(1); // only the first down was picked
  });
});

describe('lifting one of two fingers', () => {
  it('the remaining finger orbits from where it is with no jump, and never taps or drags', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0); // on a flower
    r.g.pointerDown(2, 400, 200, 10);
    r.g.pointerMove(1, 60, 80, 20);
    r.g.pointerUp(2, 30);
    expect(r.g.mode).toBe('orbit');
    r.clear();
    r.g.pointerMove(1, 64, 80, 40);
    expect(r.cmds).toEqual([{ type: 'orbit', dx: 4, dy: 0 }]); // delta from its current spot, not from its start
    r.g.tick(10_000); // a hold must not trigger a drag
    r.g.pointerUp(1, 10_001);
    expect(r.cmds.map((c) => c.type)).toEqual(['orbit', 'orbitRelease']);
  });

  it('release velocity is zero straight after a handover with no movement', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerDown(2, E.x + 100, E.y, 5);
    r.g.pointerMove(1, E.x + 50, E.y, 10);
    r.g.pointerUp(2, 20);
    r.g.pointerUp(1, 30);
    expect(r.cmds.at(-1)).toEqual({ type: 'orbitRelease', vx: 0, vy: 0 });
  });

  it('lifting the first finger lets the second continue as well', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerDown(2, E.x + 100, E.y, 5);
    r.g.pointerUp(1, 20);
    r.clear();
    r.g.pointerMove(2, E.x + 110, E.y, 30);
    expect(r.cmds).toEqual([{ type: 'orbit', dx: 10, dy: 0 }]);
  });
});

describe('pointercancel in each state', () => {
  it('pending (assembled): feedback cleared, no tap', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerCancel(1, 50);
    expect(r.cmds.slice(1)).toEqual([{ type: 'pressFeedback', id: null }]);
    expect(r.g.mode).toBe('idle');
  });
  it('pending (exploded): no tap', () => {
    const r = rig(true);
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerCancel(1, 50);
    expect(r.cmds).toEqual([]);
    expect(r.g.mode).toBe('idle');
  });
  it('orbit: released with zero velocity and no tap', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerMove(1, E.x + 50, E.y, 10);
    r.g.pointerCancel(1, 20);
    expect(r.cmds.at(-1)).toEqual({ type: 'orbitRelease', vx: 0, vy: 0 });
    expect(r.count('tap')).toBe(0);
    expect(r.g.mode).toBe('idle');
  });
  it('empty-space press cancelled is not a tap', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerCancel(1, 20);
    expect(r.count('tap')).toBe(0);
  });
  it('drag: dragEnd', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.tick(200);
    r.g.pointerCancel(1, 250);
    expect(r.cmds.at(-1)).toEqual({ type: 'dragEnd' });
    expect(r.g.mode).toBe('idle');
  });
  it('pinch: cancelling one finger leaves an orbit, cancelling the last ends it', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.g.pointerDown(2, E.x + 100, E.y, 5);
    r.g.pointerCancel(2, 10);
    expect(r.g.mode).toBe('orbit');
    r.g.pointerCancel(1, 20);
    expect(r.g.mode).toBe('idle');
    expect(r.count('tap')).toBe(0);
  });
  it('cancel or up for a pointer never seen is ignored', () => {
    const r = rig();
    r.g.pointerCancel(9, 0);
    r.g.pointerUp(9, 1);
    r.g.pointerMove(9, 1, 1, 2);
    expect(r.cmds).toEqual([]);
  });
  it('cancelAll (blur) ends a drag once and leaves the machine idle', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.tick(200);
    r.g.cancelAll();
    r.g.cancelAll();
    expect(r.count('dragEnd')).toBe(1);
    expect(r.g.mode).toBe('idle');
    r.g.pointerUp(1, 300); // late up must not double-end
    expect(r.count('dragEnd')).toBe(1);
  });
  it('a duplicate pointerdown for a tracked id is ignored', () => {
    const r = rig();
    r.g.pointerDown(1, E.x, E.y, 0);
    r.clear();
    r.g.pointerDown(1, E.x, E.y, 1);
    expect(r.cmds).toEqual([]);
    expect(r.g.mode).toBe('orbit');
  });
});

describe('no double dragEnd', () => {
  it('up after cancel after hold produces one dragEnd', () => {
    const r = rig();
    r.g.pointerDown(1, F.x, F.y, 0);
    r.g.pointerMove(1, F.x + 1, F.y, 300);
    r.g.pointerCancel(1, 310);
    r.g.pointerUp(1, 320);
    r.g.pointerCancel(1, 330);
    expect(r.count('dragStart')).toBe(1);
    expect(r.count('dragEnd')).toBe(1);
  });
});

describe('fuzz', () => {
  function mulberry(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`10k random events keep the drag invariants (seed ${seed})`, () => {
      const rnd = mulberry(seed);
      let inDrag = false;
      let dragStarts = 0;
      let dragEnds = 0;
      const state = { exploded: false };
      const g = new Gesture({
        pick: (x) => (x < 150 ? 1 + Math.floor(x / 50) : null),
        isExploded: () => state.exploded,
        emit: (c) => {
          if (c.type === 'dragStart') {
            expect(inDrag, 'dragStart inside a drag').toBe(false);
            inDrag = true;
            dragStarts++;
          } else if (c.type === 'dragMove') {
            expect(inDrag, 'dragMove outside a drag').toBe(true);
          } else if (c.type === 'dragEnd') {
            expect(inDrag, 'dragEnd outside a drag').toBe(true);
            inDrag = false;
            dragEnds++;
          } else if (c.type === 'tap') {
            expect(inDrag, 'tap inside a drag').toBe(false);
          }
        },
      });
      const down = new Map<number, { x: number; y: number }>();
      let t = 0;
      for (let i = 0; i < 10_000; i++) {
        t += rnd() < 0.05 ? 100 + rnd() * 600 : rnd() * 30; // occasional frame hitch
        const ids = [...down.keys()];
        const r = rnd();
        if (r < 0.2 && down.size < 4) {
          const id = 1 + Math.floor(rnd() * 5);
          if (!down.has(id)) {
            const p = { x: rnd() * 400, y: rnd() * 400 };
            down.set(id, p);
            g.pointerDown(id, p.x, p.y, t);
          }
        } else if (r < 0.62 && ids.length) {
          const id = ids[Math.floor(rnd() * ids.length)];
          const p = down.get(id)!;
          p.x += (rnd() - 0.5) * (rnd() < 0.2 ? 80 : 12);
          p.y += (rnd() - 0.5) * 12;
          g.pointerMove(id, p.x, p.y, t);
        } else if (r < 0.74 && ids.length) {
          const id = ids[Math.floor(rnd() * ids.length)];
          down.delete(id);
          g.pointerUp(id, t);
        } else if (r < 0.8 && ids.length) {
          const id = ids[Math.floor(rnd() * ids.length)];
          down.delete(id);
          g.pointerCancel(id, t);
        } else if (r < 0.9) {
          g.tick(t);
        } else if (r < 0.92) {
          g.cancelAll();
          down.clear();
        } else if (r < 0.95) {
          state.exploded = !state.exploded;
        } else {
          // stray events for ids that are not down
          g.pointerMove(9, rnd() * 400, rnd() * 400, t);
          g.pointerUp(9, t);
          g.pointerCancel(9, t);
        }
        expect(g.mode === 'drag', 'mode and drag flag agree').toBe(inDrag);
      }
      for (const id of [...down.keys()]) g.pointerUp(id, t + 1);
      expect(g.mode).toBe('idle');
      expect(inDrag).toBe(false);
      expect(dragStarts).toBe(dragEnds);
      expect(dragStarts).toBeGreaterThan(20); // the fuzz actually exercises drags
    });
  }
});
