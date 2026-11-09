import { describe, expect, it } from 'vitest';
import { SLOW_FRAME_MS, initialTier } from '../src/scene/tier';

describe('quality tier decision', () => {
  it('?quality= always wins', () => {
    expect(initialTier('low', false)).toBe('low');
    expect(initialTier('high', true)).toBe('high');
  });
  it('starts at medium on touch-first devices and high elsewhere', () => {
    expect(initialTier(null, true)).toBe('medium');
    expect(initialTier(null, false)).toBe('high');
  });
  it('a healthy 30 fps device (33.3 ms) is not treated as slow', () => {
    expect(1000 / 30).toBeLessThan(SLOW_FRAME_MS);
  });
});
