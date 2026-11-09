import { Vector3 } from 'three';
import { createStage } from './scene/stage';
import { CameraRig, FRAME_RADIUS_EXPLODED } from './scene/cameraRig';
import { Bouquet, MAX_FLOWERS } from './bouquet/bouquet';
import { createBinding } from './bouquet/binding';
import { InputController } from './input/input';
import { createFlower, VARIETIES } from './flowers';
import { PALETTES } from './flowers/palettes';
import { createUi, type UiApi } from './ui';
import type { FlowerVisual, VarietyId } from './types';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const stage = createStage(canvas);
const rig = new CameraRig(stage.camera);

const BINDING_POINT = new Vector3(0, 0.35, 0);
stage.setFocus(new Vector3(0, 0.6, 0));

// ---- varieties and palettes: each variety has its own number of palettes ----
const paletteCount = (v: VarietyId): number => VARIETIES.find((x) => x.id === v)?.swatches.length ?? 1;
const paletteOf = new WeakMap<FlowerVisual, number>();
function createVisual(variety: VarietyId, opts: { paletteIndex: number; seed: number }): FlowerVisual {
  const n = paletteCount(variety);
  const paletteIndex = ((Math.floor(opts.paletteIndex) % n) + n) % n; // never an out-of-range index
  const visual = createFlower(variety, { ...opts, paletteIndex });
  paletteOf.set(visual, paletteIndex);
  return visual;
}

// ---- bouquet, binding twine ----
let ui: UiApi | null = null;
const bouquet = new Bouquet({
  scene: stage.scene,
  createVisual,
  bindingPoint: BINDING_POINT,
  paletteCount,
  events: {
    onChange() {
      ui?.setExploded(bouquet.exploded);
      ui?.setFlowerCount(bouquet.flowers.length);
    },
  },
});
const binding = createBinding();
binding.object.position.copy(bouquet.bindingPoint);
stage.scene.add(binding.object);

// ---- input ----
function describe(id: number | null): { variety: VarietyId; label: string; paletteIndex: number } | null {
  if (id === null) return null;
  const rec = bouquet.flowers.find((f) => f.id === id);
  if (!rec) return null;
  const info = VARIETIES.find((v) => v.id === rec.variety);
  const paletteIndex = paletteOf.get(rec.visual) ?? 0;
  const pal = PALETTES[rec.variety][paletteIndex];
  return { variety: rec.variety, label: `${info?.label ?? rec.variety}${pal ? `, ${pal.name.toLowerCase()}` : ''}`, paletteIndex };
}

const input = new InputController({
  canvas,
  camera: stage.camera,
  rig,
  bouquet,
  onSelect(id) {
    ui?.setSelection(describe(id));
  },
});

// ---- ui ----
ui = createUi({
  root: uiRoot,
  varieties: VARIETIES,
  maxFlowers: MAX_FLOWERS,
  onAdd(variety, paletteIndex) {
    ui?.dismissHint();
    if (bouquet.full) return;
    bouquet.add(variety, paletteIndex);
  },
  onToggleExplode() {
    ui?.dismissHint();
    bouquet.toggleExploded();
  },
  onRemoveSelected() {
    const id = input.selected;
    if (id === null) return;
    input.select(null);
    bouquet.remove(id);
  },
  onDeselect() {
    input.select(null);
  },
});
bouquet.addStarterBouquet();
ui.setExploded(bouquet.exploded);
ui.setFlowerCount(bouquet.flowers.length);
// First touch of the 3D view retires the hint.
canvas.addEventListener('pointerdown', () => ui?.dismissHint(), { capture: true, once: true });
canvas.addEventListener('wheel', () => ui?.dismissHint(), { once: true });

// ---- layout: frame the bouquet in the part of the canvas the UI leaves free ----
/** Side-docked panel: wide screens, and landscape phones (kept in step with the CSS media query). */
const sideDocked = (): boolean => window.innerWidth >= 900 || (window.innerWidth > window.innerHeight && window.innerHeight < 520);
function layoutFrame(): void {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W < 1 || H < 1) return;
  const q = (sel: string): DOMRect | null => {
    const e = uiRoot.querySelector(sel);
    return e ? e.getBoundingClientRect() : null;
  };
  if (sideDocked()) {
    const cat = q('.fl-catalogue');
    const left = cat ? Math.min(W * 0.5, cat.right + 8) : 0;
    rig.setFreeRect({ x: left, y: 0, w: W - left, h: H }, W, H);
  } else {
    // Narrow: below the hint/selection tag at the top, above the hero button and the bottom sheet.
    const hero = q('.fl-hero');
    const sheet = q('.fl-catalogue');
    const bottom = Math.min(hero ? hero.top : H, sheet ? sheet.top : H) - 6;
    const top = 62;
    rig.setFreeRect({ x: 0, y: top, w: W, h: Math.max(60, bottom - top) }, W, H);
  }
}
stage.onResize((_w, _h, aspect) => {
  rig.setAspect(aspect);
  layoutFrame();
});
rig.setAspect(stage.camera.aspect);
layoutFrame();
new ResizeObserver(layoutFrame).observe(uiRoot);
for (const sel of ['.fl-catalogue', '.fl-hero']) {
  const e = uiRoot.querySelector(sel);
  if (e) new ResizeObserver(layoutFrame).observe(e);
}
void document.fonts?.ready.then(layoutFrame);

// ---- frame loop with clamped dt ----
// The first visible frame waits for the HDRI, so materials compile once with the final environment (no recompile
// hitch during the first interaction). The canvas fades in over 0.4 s; the page background is the same warm paper.
let envReady = false;
canvas.style.opacity = '0';
canvas.style.transition = 'opacity 400ms ease';
void stage.ready.then(() => { envReady = true; });
let last = performance.now();
let paused = false; // debug: freeze simulation (not rendering) so screenshots of a mid-animation pose are stable
function frame(now: number): void {
  const dt = paused ? 0 : Math.min((now - last) / 1000, 1 / 20);
  last = now;
  input.update(performance.now());
  bouquet.update(dt);
  const prog = bouquet.explodeProgress;
  // a crowded dome grows a little taller and wider, so 40 flowers still fit the frame
  const base = 0.52 + Math.min(0.08, Math.max(0, bouquet.flowers.length - 17) * 0.0035);
  rig.setFrameRadius(base + (FRAME_RADIUS_EXPLODED - base) * prog);
  rig.update(dt);
  binding.setProgress(prog);
  if (envReady) {
    stage.render();
    if (canvas.style.opacity === '0') canvas.style.opacity = '1';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- debug hook (all builds) ----
/** Canvas-pixel position of a flower's bloom (the centre of its pick sphere), for real pointer gestures. */
function flowerScreenPosition(id: number): { x: number; y: number } | null {
  const rec = bouquet.flowers.find((f) => f.id === id);
  if (!rec) return null;
  const target = rec.visual.pickTargets[0];
  const v = new Vector3();
  target.updateWorldMatrix(true, false);
  target.getWorldPosition(v);
  stage.camera.updateMatrixWorld();
  v.project(stage.camera);
  const r = canvas.getBoundingClientRect();
  return { x: ((v.x + 1) / 2) * r.width + r.left, y: ((1 - v.y) / 2) * r.height + r.top };
}

declare global {
  interface Window { __flowers: Record<string, unknown>; }
}
window.__flowers = {
  bouquet,
  rig,
  stage,
  input,
  ui,
  binding,
  bindingPoint: BINDING_POINT,
  flowerScreenPosition,
  /** Flower id under a canvas point, as a pointer-down there would pick it. */
  pickAt: (x: number, y: number): number | null => (input as unknown as { pick(x: number, y: number): number | null }).pick(x, y),
  describe,
  /** Debug: freeze or resume the simulation; rendering continues. */
  setPaused: (on: boolean): void => { paused = on; },
};
