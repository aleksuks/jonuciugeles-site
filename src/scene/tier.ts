import type { QualityTier } from '../types';

/**
 * Starting quality: an explicit ?quality= wins; touch-first devices (coarse primary pointer) start at medium,
 * everything else at high. The frame-time governor still moves it down from there.
 */
export function initialTier(forced: QualityTier | null, coarsePointer: boolean): QualityTier {
  if (forced) return forced;
  return coarsePointer ? 'medium' : 'high';
}

/** Smoothed frame time above which the governor counts a frame as slow. A healthy 30 fps device (33.3 ms) is not slow. */
export const SLOW_FRAME_MS = 40;
