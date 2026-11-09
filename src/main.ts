import { Vector3 } from 'three';
import './site/styles.css';
import { createStage } from './scene/stage';
import { CameraRig, FRAME_RADIUS_EXPLODED } from './scene/cameraRig';
import { Bouquet } from './bouquet/bouquet';
import { createBinding } from './bouquet/binding';
import { createFlower, VARIETIES } from './flowers';
import { initSite } from './site/page';
import type { VarietyId } from './types';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage(canvas);
const rig = new CameraRig(stage.camera);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const q = new URLSearchParams(location.search);

// A new bouquet every visit (?seed= pins one).
const seed = Number(q.get('seed')) || Math.floor(Math.random() * 1e9);
const paletteCount = (v: VarietyId): number => VARIETIES.find((x) => x.id === v)?.swatches.length ?? 1;
const bouquet = new Bouquet({
  scene: stage.scene,
  seed,
  paletteCount,
  bindingPoint: new Vector3(0, 0.35, 0),
  createVisual: (v, o) => createFlower(v, { ...o, paletteIndex: o.paletteIndex % paletteCount(v) }),
});
const binding = createBinding();
binding.object.position.copy(bouquet.bindingPoint);
stage.scene.add(binding.object);
stage.setFocus(new Vector3(0, 0.6, 0));
bouquet.addStarterBouquet({ random: true });
rig.azimuth = (seed % 628) / 100;

// ---- what the page asks of the bouquet ----
let spinTarget = rig.azimuth;
let loosenTarget = 0;
let flourishUntil = 0;
let px = 0;
let py = 0;
let lastScroll = scrollY;
addEventListener('scroll', () => {
  if (!reduce) spinTarget += (scrollY - lastScroll) * 0.0016;
  lastScroll = scrollY;
}, { passive: true });
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  px = e.clientX / innerWidth - 0.5;
  py = e.clientY / innerHeight - 0.5;
}, { passive: true });

initSite({
  loosen: (on) => { loosenTarget = on; },
  spin: () => { spinTarget += 1.1; },
  flourish: () => { flourishUntil = performance.now() + 1100; },
});

// ---- framing: follow the stage-slot in view ----
const slots = [...document.querySelectorAll<HTMLElement>('.stage-slot')];
type Rect = { x: number; y: number; w: number; h: number };
function activeSlot(): { el: HTMLElement; r: DOMRect } | null {
  let best: { el: HTMLElement; r: DOMRect } | null = null;
  let bestArea = 0;
  for (const el of slots) {
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (area > bestArea) { bestArea = area; best = { el, r }; }
  }
  return best;
}

let rect: Rect | null = null;
let hiddenAt = 0;
let lastSlot: HTMLElement | null = null;
let envReady = false;
let groundSampled = false;
void stage.ready.then(() => { envReady = true; });
stage.onQualityChange(() => { groundSampled = false; });
stage.onResize((_w, _h, aspect) => rig.setAspect(aspect));

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const slot = activeSlot();
  // Off every slot: keep riding the last one off-screen while the canvas fades.
  if (!slot && lastSlot && rect) {
    const r = lastSlot.getBoundingClientRect();
    rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    rig.setFreeRect(rect, W, H);
  }

  if (slot) {
    lastSlot = slot.el;
    const t: Rect = { x: slot.r.left, y: slot.r.top, w: slot.r.width, h: slot.r.height };
    if (!rect || hiddenAt) rect = t;
    else {
      const k = 1 - Math.exp(-16 * dt);
      rect = { x: rect.x + (t.x - rect.x) * k, y: rect.y + (t.y - rect.y) * k, w: rect.w + (t.w - rect.w) * k, h: rect.h + (t.h - rect.h) * k };
    }
    rig.setFreeRect(rect, W, H);
    hiddenAt = 0;
    const state = slot.el.closest<HTMLElement>('[data-stage]')?.dataset.stage;
    bouquet.setExploded(!reduce && (state === 'exploded' || now < flourishUntil), 0.35);
  } else if (!hiddenAt) hiddenAt = now;

  if (!reduce) {
    spinTarget += 0.06 * dt;
    rig.azimuth += (spinTarget - rig.azimuth) * (1 - Math.exp(-3.5 * dt));
    const kp = 1 - Math.exp(-4 * dt);
    rig.offsetAz += (-px * 0.35 - rig.offsetAz) * kp;
    rig.offsetPol += (py * 0.16 - rig.offsetPol) * kp;
    bouquet.loosen += (loosenTarget - bouquet.loosen) * (1 - Math.exp(-6 * dt));
  }
  bouquet.update(dt);
  const prog = bouquet.explodeProgress;
  const base = 0.52 + Math.min(0.08, Math.max(0, bouquet.flowers.length - 17) * 0.0035);
  rig.setFrameRadius(base + (FRAME_RADIUS_EXPLODED - base) * prog);
  rig.update(dt);
  binding.setProgress(prog);

  // Render while a slot shows, plus a moment after it leaves so the fade-out is not a frozen frame.
  const show = envReady && !hiddenAt;
  if (envReady && (!hiddenAt || now - hiddenAt < 600)) {
    stage.render();
    if (!groundSampled) {
      const c = stage.sampleBackdrop();
      document.documentElement.style.setProperty('--ground', c);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c);
      groundSampled = true;
    }
  }
  canvas.style.opacity = show ? '1' : '0';
  requestAnimationFrame(frame);
}

// Intro: scattered flowers gather and tie once the environment is in.
void stage.ready.then(() => { if (!reduce) bouquet.gather(0.9); });
requestAnimationFrame(frame);

declare global { interface Window { __flowers: Record<string, unknown> } }
window.__flowers = { bouquet, stage, rig, seed };
