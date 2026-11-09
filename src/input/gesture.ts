/**
 * Pure gesture state machine. No DOM, no three. Coordinates are whatever the caller uses consistently
 * (the controller passes canvas-local CSS pixels); times are milliseconds on one monotonic clock.
 *
 * States: idle, pending (down on a flower, undecided), orbit, drag, pinch.
 * Every drag that starts is ended exactly once, whatever way the gesture finishes.
 */

export type Command =
  | { type: 'orbit'; dx: number; dy: number }
  | { type: 'orbitRelease'; vx: number; vy: number }
  | { type: 'pinch'; factor: number }
  | { type: 'dragStart'; id: number; x: number; y: number }
  | { type: 'dragMove'; x: number; y: number }
  | { type: 'dragEnd' }
  | { type: 'tap'; id: number | null }
  | { type: 'pressFeedback'; id: number | null };

export interface GestureDeps {
  /** Flower under the point, or null. Called once per pointer down, never otherwise. */
  pick(x: number, y: number): number | null;
  isExploded(): boolean;
  emit(cmd: Command): void;
}

export const HOLD_MS = 180;
/** Assembled: movement beyond this before the hold elapses means orbit. */
export const ASSEMBLED_SLOP = 8;
/** Exploded: movement beyond this starts a drag at once. */
export const EXPLODED_SLOP = 6;
/** Empty-space press that stays within this distance is a tap. */
export const TAP_SLOP = 8;
export const VELOCITY_WINDOW_MS = 80;
const MIN_PINCH_DIST = 1;
const PINCH_MIN = 0.5;
const PINCH_MAX = 2;

interface Ptr {
  id: number;
  x: number;
  y: number;
}
interface Sample {
  t: number;
  x: number;
  y: number;
}

type State =
  | { kind: 'idle' }
  | { kind: 'pending'; p: Ptr; flowerId: number; sx: number; sy: number; t0: number; exploded: boolean }
  | { kind: 'orbit'; p: Ptr; sx: number; sy: number; tapOk: boolean; samples: Sample[] }
  | { kind: 'drag'; p: Ptr; flowerId: number }
  | { kind: 'pinch'; a: Ptr; b: Ptr; dist: number; mx: number; my: number };

export class Gesture {
  private state: State = { kind: 'idle' };
  private clock = 0;

  constructor(private readonly deps: GestureDeps) {}

  get mode(): State['kind'] {
    return this.state.kind;
  }

  /** True when this pointer id belongs to the current gesture. */
  tracks(id: number): boolean {
    const s = this.state;
    switch (s.kind) {
      case 'pending':
      case 'orbit':
      case 'drag':
        return s.p.id === id;
      case 'pinch':
        return s.a.id === id || s.b.id === id;
      default:
        return false;
    }
  }

  /** Hold timer. Safe to call every frame; also run implicitly at the start of every event. */
  tick(now: number): void {
    this.advance(now);
  }

  pointerDown(id: number, x: number, y: number, t: number): void {
    this.advance(t);
    if (this.tracks(id)) return; // duplicate down: ignore
    const s = this.state;
    switch (s.kind) {
      case 'idle': {
        const flowerId = this.deps.pick(x, y);
        const p = { id, x, y };
        if (flowerId === null) {
          this.state = { kind: 'orbit', p, sx: x, sy: y, tapOk: true, samples: [{ t, x, y }] };
          // Stops any camera inertia straight away, so a touch on empty space always catches the bouquet.
          this.deps.emit({ type: 'orbit', dx: 0, dy: 0 });
        } else {
          const exploded = this.deps.isExploded();
          this.state = { kind: 'pending', p, flowerId, sx: x, sy: y, t0: t, exploded };
          if (!exploded) this.deps.emit({ type: 'pressFeedback', id: flowerId });
        }
        break;
      }
      case 'pending':
        this.deps.emit({ type: 'pressFeedback', id: null });
        this.beginPinch(s.p, { id, x, y });
        break;
      case 'orbit':
        this.beginPinch(s.p, { id, x, y });
        break;
      case 'drag':
        this.deps.emit({ type: 'dragEnd' });
        this.beginPinch(s.p, { id, x, y });
        break;
      case 'pinch':
        break; // third and further pointers are ignored
    }
  }

  pointerMove(id: number, x: number, y: number, t: number): void {
    this.advance(t); // a hold that elapsed during a hitch wins over this move
    const s = this.state;
    switch (s.kind) {
      case 'pending': {
        if (s.p.id !== id) return;
        s.p.x = x;
        s.p.y = y;
        const d = Math.hypot(x - s.sx, y - s.sy);
        if (s.exploded) {
          if (d > EXPLODED_SLOP) {
            this.state = { kind: 'drag', p: s.p, flowerId: s.flowerId };
            this.deps.emit({ type: 'dragStart', id: s.flowerId, x, y });
          }
        } else if (d > ASSEMBLED_SLOP) {
          this.deps.emit({ type: 'pressFeedback', id: null });
          this.state = {
            kind: 'orbit',
            p: s.p,
            sx: s.sx,
            sy: s.sy,
            tapOk: false,
            samples: [
              { t: s.t0, x: s.sx, y: s.sy },
              { t, x, y },
            ],
          };
          this.deps.emit({ type: 'orbit', dx: x - s.sx, dy: y - s.sy });
        }
        break;
      }
      case 'orbit': {
        if (s.p.id !== id) return;
        const dx = x - s.p.x;
        const dy = y - s.p.y;
        s.p.x = x;
        s.p.y = y;
        if (s.tapOk && Math.hypot(x - s.sx, y - s.sy) > TAP_SLOP) s.tapOk = false;
        s.samples.push({ t, x, y });
        while (s.samples.length > 2 && t - s.samples[0].t > 4 * VELOCITY_WINDOW_MS) s.samples.shift();
        if (dx !== 0 || dy !== 0) this.deps.emit({ type: 'orbit', dx, dy });
        break;
      }
      case 'drag': {
        if (s.p.id !== id) return;
        s.p.x = x;
        s.p.y = y;
        this.deps.emit({ type: 'dragMove', x, y });
        break;
      }
      case 'pinch': {
        const p = s.a.id === id ? s.a : s.b.id === id ? s.b : null;
        if (!p) return;
        p.x = x;
        p.y = y;
        const dist = Math.max(Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y), MIN_PINCH_DIST);
        const mx = (s.a.x + s.b.x) / 2;
        const my = (s.a.y + s.b.y) / 2;
        const factor = Math.min(PINCH_MAX, Math.max(PINCH_MIN, s.dist / dist));
        if (factor !== 1) this.deps.emit({ type: 'pinch', factor });
        if (mx !== s.mx || my !== s.my) this.deps.emit({ type: 'orbit', dx: mx - s.mx, dy: my - s.my });
        s.dist = dist;
        s.mx = mx;
        s.my = my;
        break;
      }
      default:
        break;
    }
  }

  pointerUp(id: number, t: number): void {
    this.advance(t);
    this.finish(id, t, true);
  }

  pointerCancel(id: number, t: number): void {
    this.advance(t);
    this.finish(id, t, false);
  }

  /** Window blur, tab hidden, dispose: end whatever is going on with no tap and no inertia. */
  cancelAll(): void {
    const s = this.state;
    this.state = { kind: 'idle' };
    switch (s.kind) {
      case 'pending':
        this.deps.emit({ type: 'pressFeedback', id: null });
        break;
      case 'orbit':
        this.deps.emit({ type: 'orbitRelease', vx: 0, vy: 0 });
        break;
      case 'drag':
        this.deps.emit({ type: 'dragEnd' });
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ internals

  private advance(now: number): void {
    if (Number.isFinite(now) && now > this.clock) this.clock = now;
    const s = this.state;
    if (s.kind === 'pending' && !s.exploded && this.clock - s.t0 >= HOLD_MS) {
      // Hold satisfied: drag begins at the pointer's position as it was, not where a later event says.
      this.state = { kind: 'drag', p: s.p, flowerId: s.flowerId };
      this.deps.emit({ type: 'pressFeedback', id: null });
      this.deps.emit({ type: 'dragStart', id: s.flowerId, x: s.p.x, y: s.p.y });
    }
  }

  private beginPinch(a: Ptr, b: Ptr): void {
    this.state = {
      kind: 'pinch',
      a,
      b,
      dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), MIN_PINCH_DIST),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
  }

  private finish(id: number, t: number, allowTap: boolean): void {
    const s = this.state;
    switch (s.kind) {
      case 'pending':
        if (s.p.id !== id) return;
        this.state = { kind: 'idle' };
        if (!s.exploded) this.deps.emit({ type: 'pressFeedback', id: null });
        if (allowTap) this.deps.emit({ type: 'tap', id: s.flowerId });
        break;
      case 'orbit': {
        if (s.p.id !== id) return;
        this.state = { kind: 'idle' };
        const v = allowTap ? velocity(s.samples, t) : { vx: 0, vy: 0 };
        this.deps.emit({ type: 'orbitRelease', vx: v.vx, vy: v.vy });
        if (allowTap && s.tapOk) this.deps.emit({ type: 'tap', id: null });
        break;
      }
      case 'drag':
        if (s.p.id !== id) return;
        this.state = { kind: 'idle' };
        this.deps.emit({ type: 'dragEnd' });
        break;
      case 'pinch': {
        const rest = s.a.id === id ? s.b : s.b.id === id ? s.a : null;
        if (!rest) return;
        // The remaining finger carries on as an orbit from where it is: no jump, never a drag or tap.
        this.state = { kind: 'orbit', p: rest, sx: rest.x, sy: rest.y, tapOk: false, samples: [] };
        break;
      }
      default:
        break;
    }
  }
}

/** Average velocity (units per second) over the last VELOCITY_WINDOW_MS before `now`; zero if the pointer rested. */
export function velocity(samples: readonly Sample[], now: number): { vx: number; vy: number } {
  const from = now - VELOCITY_WINDOW_MS;
  let first: Sample | null = null;
  let last: Sample | null = null;
  for (const s of samples) {
    if (s.t < from || s.t > now) continue;
    if (!first) first = s;
    last = s;
  }
  if (!first || !last || last === first) return { vx: 0, vy: 0 };
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}
