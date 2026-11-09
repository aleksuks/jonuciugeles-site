// Dev-only preview of the UI over a static backdrop. Not part of the app.
//   /preview/ui.html?selected=1&exploded=1&hint=0&thumbs=1
import { createUi } from '../src/ui';
import type { VarietyInfo } from '../src/types';

const q = new URLSearchParams(window.location.search);
const varieties: VarietyInfo[] = [
  { id: 'rose', label: 'Rose', blurb: 'Tight spiral heart, softly rolled petals.', swatches: ['#dd9aa9', '#f3e1bd', '#6a1a33', '#eb9a6c'] },
  { id: 'tulip', label: 'Tulip', blurb: 'Six smooth petals closed into a goblet.', swatches: ['#f2bccb', '#ee7f80', '#f6e6d9'] },
  { id: 'peony', label: 'Peony', blurb: 'Lush, ruffled and layered to the heart.', swatches: ['#ecb5c1', '#ec9c5b', '#ece9cb', '#5d1530'] },
  { id: 'daisy', label: 'Daisy', blurb: 'Bright white rays around a golden dome.', swatches: ['#fbf8ee', '#f2d5d3'] },
  { id: 'eucalyptus', label: 'Eucalyptus', blurb: 'Silvery round leaves on a branching spray.', swatches: ['#98b0a2', '#74998f'] },
];

let exploded = q.get('exploded') === '1';
let count = 17;

const tile = (v: string, i: number): string => {
  const colour = varieties.find((x) => x.id === v)?.swatches[i] ?? '#ccc';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${colour}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const ui = createUi({
  root: document.getElementById('ui') as HTMLElement,
  varieties,
  thumbnail: q.get('thumbs') === '1' ? (v, i) => new Promise((r) => setTimeout(() => r(tile(v, i)), 400)) : undefined,
  onAdd: () => ui.setFlowerCount(++count),
  onToggleExplode: () => { exploded = !exploded; ui.setExploded(exploded); },
  onRemoveSelected: () => { ui.setFlowerCount(--count); ui.setSelection(null); },
  onDeselect: () => ui.setSelection(null),
});
ui.setFlowerCount(count);
ui.setExploded(exploded);
if (q.get('selected') === '1') ui.setSelection({ variety: 'rose', label: 'Burgundy rose', paletteIndex: 2 });
if (q.get('hint') === '0') ui.dismissHint();
(window as unknown as { __ui: unknown }).__ui = ui;
