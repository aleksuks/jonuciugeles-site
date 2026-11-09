import type { VarietyId } from '../types';
import type { Palette } from './materials';

export const PALETTES: Record<VarietyId, Palette[]> = {
  rose: [
    { name: 'Dusty pink', base: '#9c3358', tip: '#e48ea3', accent: '#f4c6cd', accentAmt: 0.55, swatch: '#dd9aa9' },
    { name: 'Cream', base: '#dcb87c', tip: '#fcf2df', accent: '#ffffff', accentAmt: 0.5, swatch: '#f3e1bd' },
    { name: 'Burgundy', base: '#2a0614', tip: '#6b1636', accent: '#8f2a4a', accentAmt: 0.5, swatch: '#6a1a33' },
    { name: 'Apricot', base: '#c3532b', tip: '#f2a070', accent: '#f9cfaa', accentAmt: 0.5, swatch: '#eb9a6c' },
  ],
  peony: [
    { name: 'Blush', base: '#d4688a', tip: '#f5c0cd', accent: '#fde9e8', accentAmt: 0.55, swatch: '#f2bccb' },
    { name: 'Coral', base: '#c93550', tip: '#f28c7c', accent: '#fbc7b3', accentAmt: 0.5, swatch: '#ee7f80' },
    { name: 'Ivory', base: '#ecc3b0', tip: '#fffaf0', accent: '#ffffff', accentAmt: 0.5, swatch: '#f6e6d9' },
  ],
  tulip: [
    { name: 'Blush', base: '#f1e7cf', tip: '#d9668a', accent: '#f3bccb', accentAmt: 0.55, swatch: '#ecb5c1' },
    { name: 'Apricot', base: '#f3d78f', tip: '#e57d46', accent: '#cf5636', accentAmt: 0.7, swatch: '#ec9c5b' },
    { name: 'Cream', base: '#c9d6a0', tip: '#fbf5e3', accent: '#fffdf5', accentAmt: 0.5, swatch: '#ece9cb' },
    { name: 'Burgundy', base: '#3a0f20', tip: '#7c1a3c', accent: '#a02a52', accentAmt: 0.6, swatch: '#5d1530' },
  ],
  daisy: [
    { name: 'White', base: '#f1e6a8', tip: '#ffffff', accent: '#ffffff', accentAmt: 0.3, swatch: '#fbf8ee' },
    { name: 'Blush', base: '#f3e0a8', tip: '#f4cdd3', accent: '#eaa6b6', accentAmt: 0.5, swatch: '#f2d5d3' },
  ],
  eucalyptus: [
    { name: 'Silver sage', base: '#587a69', tip: '#a3bcae', accent: '#a8837b', accentAmt: 0.6, swatch: '#98b0a2' },
    { name: 'Blue green', base: '#3e6a5f', tip: '#86a89d', accent: '#94696f', accentAmt: 0.6, swatch: '#74998f' },
  ],
};
