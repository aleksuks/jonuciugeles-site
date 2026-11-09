// Browser walkthrough: starts (or reuses) the Vite dev server, drives Chromium, collects console and page
// errors, writes screenshots to .verify/, exits non-zero on any error or failed check.
//
// Scenarios (see SCENARIOS below):
//   <tier>-<landscape|portrait>   assembled screenshot at each quality tier and size (forced tier, deterministic)
//   walkthrough-desktop/-phone    real pointer gestures: hero button, reversal, hold-drag, swipe, tap/remove,
//                                 add from the catalogue, orbit/zoom, simulated touch, exploded drag
//   governor-auto                 no ?quality= override: proves the frame-time governor lowers the tier
// Usage: node scripts/verify.mjs [--filter=substring]
//
// Software rendering (SwiftShader) is slow, so frames take 0.3 to several seconds. Everything is therefore
// measured in simulated time or frame counts, never wall-clock, and quick gestures (tap, swipe) are sent to the
// browser as one CDP batch: awaiting each event would let a slow frame push the gesture past the 180 ms hold.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.verify');
const PORT = Number(process.env.VERIFY_PORT ?? 5175);
const BASE = `http://localhost:${PORT}`;

const VIEWPORTS = {
  landscape: { width: 1280, height: 800 },
  portrait: { width: 390, height: 844 },
};
const TIERS = ['high', 'medium', 'low'];

/**
 * Largest allowed speeds, in simulated time (frame step divided by min(frame dt, 1/20)).
 * Calibrated on this app: explode, reversal, grab and drag peak at 1.3 to 1.55 m/s (heads), 1.3 m/s (roots), 3.0 rad/s (roll). 1.9 m/s is
 * 0.095 m in one 50 ms step: any teleport of 10 cm or more fails, normal spring motion passes. Roots and roll
 * are bounded from their own observed peaks (see the calibration line printed by the hero section).
 */
const SPEED_BOUND = 1.9;
const ROOT_BOUND = 1.7;
const ROLL_BOUND = 4.5; // rad/s
const SPEED_SLACK = 0; // no extra allowance

const filter = (process.argv.find((a) => a.startsWith('--filter=')) ?? '').slice(9);
/** --inject=teleport: deliberately teleport a flower mid-explosion, stop after the hero section; the check must FAIL (proof the check works). */
const inject = (process.argv.find((a) => a.startsWith('--inject=')) ?? '').slice(9);

/** @type {Array<{name:string, query:string, viewport:{width:number,height:number}, expectTier?:string, steps?:Function, run?:Function}>} */
const SCENARIOS = [];
for (const tier of TIERS) {
  for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
    SCENARIOS.push({ name: `${tier}-${vp}`, query: `?quality=${tier}`, viewport, expectTier: tier });
  }
}
SCENARIOS.push({ name: 'walkthrough-desktop', query: '?quality=low', viewport: VIEWPORTS.landscape, expectTier: 'low', run: walkthrough, full: true });
SCENARIOS.push({ name: 'walkthrough-phone', query: '?quality=low', viewport: VIEWPORTS.portrait, expectTier: 'low', run: walkthrough, full: false });
SCENARIOS.push({ name: 'walkthrough-medium', query: '?quality=medium', viewport: VIEWPORTS.landscape, expectTier: 'medium', run: walkthrough, full: false, core: true });
SCENARIOS.push({ name: 'phone-landscape', query: '?quality=low', viewport: { width: 844, height: 390 }, expectTier: 'low', run: landscapePhone });
SCENARIOS.push({ name: 'governor-auto', query: '', viewport: VIEWPORTS.landscape, run: governorScenario });

async function reachable() {
  try { return (await fetch(BASE)).ok; } catch { return false; }
}

async function ensureServer() {
  if (await reachable()) { console.log(`reusing server at ${BASE}`); return null; }
  console.log(`starting a stable (no HMR, no watcher) vite dev server on ${PORT}`);
  const bin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', env: { ...process.env, FLOWERS_STABLE: '1' } });
  for (let i = 0; i < 100; i++) {
    if (await reachable()) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('vite did not start');
}

// ------------------------------------------------------------------------------------------------ helpers

/** Collects named checks for one scenario. */
function makeChecks() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`     ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
    return !!ok;
  };
  return { results, check };
}

async function bootPage(browser, sc, { hasTouch = false } = {}) {
  const ctx = await browser.newContext({ viewport: sc.viewport, deviceScaleFactor: 1, hasTouch });
  const page = await ctx.newPage();
  const errors = [];
  const warnings = [];
  const infos = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    else if (m.type() === 'warning') warnings.push(m.text());
    else if (m.type() === 'info') infos.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('crash', () => errors.push('page crashed'));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`     (navigated: ${f.url()})`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  await page.goto(BASE + '/' + sc.query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__flowers?.stage?.ready, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.__flowers.stage.ready);
  const f0 = await page.evaluate(() => window.__flowers.stage.stats.frames);
  await page.waitForFunction((n) => window.__flowers.stage.stats.frames > n + 12, f0, { timeout: 240000, polling: 200 });
  const shot = async (label) => {
    const file = join(outDir, `${sc.name}${label ? '-' + label : ''}.png`);
    await page.screenshot({ path: file, timeout: 240000 });
    return file;
  };
  return { ctx, page, errors, warnings, infos, shot };
}

/** Page-side helpers: sampler, picking, projection. Installed once per page. */
async function installPageHelpers(page) {
  await page.evaluate(() => {
    const F = window.__flowers;
    const T = (window.__t = {});
    const V = F.bouquet.bindingPoint.constructor; // THREE.Vector3 without importing three here
    T.samplers = {};
    /** Samples head positions every frame. Speed is normalised by simulated dt = min(frame dt, 1/20). */
    T.startSampler = (name, watchId) => {
      const s = (T.samplers[name] = { running: true, last: null, lastT: 0, frames: 0, maxSpeed: 0, maxStep: 0, worst: null, series: [], maxRoot: 0, maxRoll: 0, worstRoot: null, worstRoll: null });
      const tick = (now) => {
        if (!s.running) return;
        const cur = {};
        for (const f of F.bouquet.flowers) {
          const p = F.bouquet.headPosition(f.id);
          const i = F.bouquet.inspect(f.id);
          cur[f.id] = [p.x, p.y, p.z, i.root.x, i.root.y, i.root.z, i.roll];
        }
        if (s.last) {
          const dt = Math.min((now - s.lastT) / 1000, 1 / 20);
          if (dt > 1e-4) {
            s.frames++;
            for (const id in cur) {
              const a = s.last[id];
              if (!a) continue;
              const b = cur[id];
              const step = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
              const speed = step / dt;
              if (speed > s.maxSpeed) { s.maxSpeed = speed; s.maxStep = step; s.worst = { id: +id, speed, step, dt }; }
              const rs = Math.hypot(b[3] - a[3], b[4] - a[4], b[5] - a[5]) / dt;
              if (rs > s.maxRoot) { s.maxRoot = rs; s.worstRoot = { id: +id, rs, dt }; }
              const rl = Math.abs(b[6] - a[6]) / dt;
              if (rl > s.maxRoll) { s.maxRoll = rl; s.worstRoll = { id: +id, rl, dt }; }
              if (watchId !== undefined && +id === watchId) s.series.push({ step, dt, p: b });
            }
          }
        }
        s.last = cur;
        s.lastT = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    T.stopSampler = (name) => {
      const s = T.samplers[name];
      s.running = false;
      return { frames: s.frames, maxSpeed: s.maxSpeed, maxStep: s.maxStep, worst: s.worst, series: s.series, maxRoot: s.maxRoot, maxRoll: s.maxRoll, worstRoot: s.worstRoot, worstRoll: s.worstRoll };
    };
    T.canvasPoint = (x, y) => document.elementFromPoint(x, y) === document.getElementById('stage');
    /** Flowers whose bloom centre is under the pointer as picked (not hidden behind another flower or UI). */
    T.pickable = () => {
      const out = [];
      for (const f of F.bouquet.flowers) {
        const p = F.flowerScreenPosition(f.id);
        if (!p) continue;
        if (p.x < 5 || p.y < 5 || p.x > innerWidth - 5 || p.y > innerHeight - 5) continue;
        if (!T.canvasPoint(p.x, p.y)) continue;
        if (F.pickAt(p.x, p.y) !== f.id) continue;
        out.push({ id: f.id, variety: f.variety, x: p.x, y: p.y });
      }
      return out;
    };
    T.emptyPoints = () => {
      const out = [];
      for (let y = 90; y < innerHeight - 90; y += 40) {
        for (let x = 20; x < innerWidth - 20; x += 40) {
          if (T.canvasPoint(x, y) && F.pickAt(x, y) === null) out.push({ x, y });
        }
      }
      return out;
    };
    T.cameraStill = () => F.rig.vAz === 0 && F.rig.vPol === 0 && Math.abs(F.rig.zoom - F.rig.zoomTarget) < 1e-3;
    T.zoomRatio = () => F.rig.distance / F.rig.fitDistance;
    T.toScreen = (x, y, z) => {
      const v = new V(x, y, z).project(F.stage.camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    };
    T.camRight = () => {
      const m = F.stage.camera.matrixWorld.elements;
      return [m[0], m[1], m[2]];
    };
    T.head = (id) => { const p = F.bouquet.headPosition(id); return [p.x, p.y, p.z]; };
    /** Distance from the binding point to the stem segment root -> head. */
    T.stemToBinding = (id) => {
      const i = F.bouquet.inspect(id);
      const b = F.bouquet.bindingPoint;
      const r = i.root, h = i.head;
      const d = [h.x - r.x, h.y - r.y, h.z - r.z];
      const w = [b.x - r.x, b.y - r.y, b.z - r.z];
      const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9;
      const t = Math.min(1, Math.max(0, (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / l2));
      return Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]);
    };
    T.sideOf = (id) => {
      const r = T.camRight();
      const h = F.bouquet.headPosition(id);
      const b = F.bouquet.bindingPoint;
      return (h.x - b.x) * r[0] + (h.y - b.y) * r[1] + (h.z - b.z) * r[2];
    };
    T.mode = () => F.input.gesture.mode;
    T.anyDragging = () => F.bouquet.flowers.some((f) => F.bouquet.inspect(f.id).dragging);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDriver(page, cdp) {
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = (fn, arg, timeout = 120000) => page.waitForFunction(fn, arg, { timeout, polling: 60 });
  const frames = async (n) => {
    const f0 = await ev(() => window.__flowers.stage.stats.frames);
    await until((x) => window.__flowers.stage.stats.frames >= x, f0 + n, 240000);
  };
  const settle = async () => {
    await frames(2);
    await until(() => !window.__flowers.bouquet.settling && window.__t.cameraStill(), null, 240000);
    await frames(1);
  };
  const progress = () => ev(() => window.__flowers.bouquet.explodeProgress);
  const waitProgress = (pred, timeout = 120000) =>
    page.waitForFunction((src) => new Function('p', `return (${src})(p)`)(window.__flowers.bouquet.explodeProgress), pred.toString(), { timeout, polling: 30 });
  // CDP batches: everything is sent without awaiting between events, so the page sees them back to back.
  const mouse = {
    down: (x, y) => ({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }),
    move: (x, y) => ({ type: 'mouseMoved', x, y, button: 'left', buttons: 1 }),
    up: (x, y) => ({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }),
  };
  const batchMouse = (evts) => Promise.all(evts.map((e) => cdp.send('Input.dispatchMouseEvent', e)));
  const tap = (x, y) => batchMouse([mouse.down(x, y), mouse.up(x, y)]);
  const swipe = (x, y, dx, dy, n = 5) => {
    const evts = [mouse.down(x, y)];
    for (let i = 1; i <= n; i++) evts.push(mouse.move(x + (dx * i) / n, y + (dy * i) / n));
    evts.push(mouse.up(x + dx, y + dy));
    return batchMouse(evts);
  };
  const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  const touchBatch = (steps) => Promise.all(steps.map(([type, pts]) => touch(type, pts)));
  return { ev, until, frames, settle, progress, waitProgress, mouse, batchMouse, tap, swipe, touch, touchBatch };
}

// ------------------------------------------------------------------------------------------------ walkthrough

async function walkthrough(browser, sc, h) {
  const { check, results } = makeChecks();
  const full = sc.full;
  const { ctx, page, errors, warnings, shot } = await bootPage(browser, sc, { hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  await installPageHelpers(page);
  const d = makeDriver(page, cdp);
  const { ev } = d;
  const vp = sc.viewport;
  const shots = [];
  const snap = async (label) => { const t0 = Date.now(); const f = await shot(label); shots.push(f); console.log(`     shot ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); return f; };

  // A screenshot takes ~10 s under software rendering, longer than the whole animation, so freeze the simulation
  // (rendering continues) while capturing a mid-animation pose.
  const snapFrozen = async (label) => {
    await ev(() => window.__flowers.setPaused(true));
    await d.frames(2);
    const f = await snap(label);
    await ev(() => window.__flowers.setPaused(false));
    return f;
  };

  const motionChecks = (label, m) => {
    check(`${label}: head speed ${m.maxSpeed.toFixed(2)} m/s <= ${SPEED_BOUND}`, m.maxSpeed <= SPEED_BOUND, `${m.frames} frames, worst ${JSON.stringify(m.worst)}`);
    check(`${label}: root speed ${m.maxRoot.toFixed(2)} m/s <= ${ROOT_BOUND}`, m.maxRoot <= ROOT_BOUND, JSON.stringify(m.worstRoot));
    check(`${label}: roll speed ${m.maxRoll.toFixed(2)} rad/s <= ${ROLL_BOUND}`, m.maxRoll <= ROLL_BOUND, JSON.stringify(m.worstRoll));
  };

  // ---- load
  const loaded = await ev(() => ({ n: window.__flowers.bouquet.flowers.length, q: window.__flowers.stage.quality, exploded: window.__flowers.bouquet.exploded }));
  check(`load: 17 flowers, assembled, quality=${sc.expectTier}`, loaded.n === 17 && !loaded.exploded && loaded.q === sc.expectTier, JSON.stringify(loaded));
  check('load: no console errors so far', errors.length === 0, errors.join(' | '));
  await d.settle();
  await snap('assembled');

  // ---- binding twine present and visible when assembled
  const bind0 = await ev(() => { const b = window.__flowers.binding.object; return { visible: b.visible, scale: b.scale.x }; });
  check('binding twine visible and full size when assembled', bind0.visible && bind0.scale > 0.98, JSON.stringify(bind0));

  // ---- hero button: explode / reverse / assemble, real mouse, with a continuity sampler
  await ev(() => window.__t.startSampler('hero'));
  const heroBox = await page.locator('.fl-hero').boundingBox();
  check('hero button is on screen', !!heroBox && heroBox.y + heroBox.height <= vp.height + 1 && heroBox.x >= 0, JSON.stringify(heroBox));
  await page.click('.fl-hero');
  await d.waitProgress((p) => p > 0.3 && p < 0.7);
  if (inject === 'teleport') {
    // deliberately break continuity: shove one flower's head spring 0.3 m sideways in a single frame
    await ev(() => { const F = window.__flowers; const i = F.bouquet.inspect(F.bouquet.flowers[3].id); i.head.x += 0.3; i.root.x += 0.3; });
  }
  const pMid = await snapFrozen('explode-mid');
  const pMidVal = await d.progress();
  const midBind = await ev(() => window.__flowers.binding.object.scale.x);
  check('mid-explosion captured with the simulation frozen (0.05 < progress < 0.95)', pMidVal > 0.05 && pMidVal < 0.95, `progress ${pMidVal.toFixed(2)} after screenshot ${pMid.split(/[\\/]/).pop()}`);
  check('binding shrinks while exploding (scale < 1 mid-way)', midBind < 1, `scale ${midBind.toFixed(2)}`);
  await d.settle();
  await snap('exploded');
  const exploded1 = await ev(() => ({ e: window.__flowers.bouquet.exploded, p: window.__flowers.bouquet.explodeProgress, bs: window.__flowers.binding.object.scale.x, vis: window.__flowers.binding.object.visible, ui: document.querySelector('.fl-hero').dataset.exploded }));
  check('exploded: progress ~1, twine gone, hero label flipped', exploded1.e && exploded1.p > 0.95 && !exploded1.vis && exploded1.ui === 'true', JSON.stringify(exploded1));

  // projected overlap of blooms on screen, exploded, from the live camera and canvas size (worst case reported)
  const ov = await ev(() => {
    const APPARENT = { rose: 0.07, peony: 0.08, tulip: 0.045, daisy: 0.09, eucalyptus: 0.085 }; // same table as tests/projection.test.ts
    const F = window.__flowers;
    const cam = F.stage.camera;
    cam.updateMatrixWorld();
    const W = innerWidth, H = innerHeight;
    const items = F.bouquet.flowers.map((f) => {
      const t = f.visual.pickTargets[0];
      t.updateWorldMatrix(true, false);
      const c = new F.bindingPoint.constructor();
      t.getWorldPosition(c);
      const cv = c.clone().applyMatrix4(cam.matrixWorldInverse);
      const p = c.clone().project(cam);
      const ppu = H / (2 * Math.tan((cam.fov * Math.PI) / 360) * -cv.z);
      return { v: f.variety, x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H, r: APPARENT[f.variety] * ppu };
    });
    let worst = 0, pair = '';
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const d = Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y);
      const o = (items[i].r + items[j].r - d) / Math.min(items[i].r, items[j].r);
      if (o > worst) { worst = o; pair = items[i].v + '/' + items[j].v; }
    }
    const out = items.filter((p) => p.x - p.r < 0 || p.x + p.r > W || p.y - p.r < 0 || p.y + p.r > H).length;
    return { worst, pair, out };
  });
  check('exploded: projected blooms (apparent radii) overlap by less than 10% of the smaller one', ov.worst < 0.1, `worst ${(ov.worst * 100).toFixed(0)}% (${ov.pair || 'none'})`);
  check('exploded: every bloom inside the canvas', ov.out === 0, `${ov.out} outside`);

  // reassemble, screenshot mid-assembly, then reverse twice mid-animation
  await page.click('.fl-hero');
  await d.waitProgress((p) => p < 0.6 && p > 0.25);
  await snapFrozen('assemble-mid');
  await page.click('.fl-hero'); // reversal 1: back to exploding mid-assembly
  await d.waitProgress((p) => p > 0.5 || p < 0.1, 120000).catch(() => {});
  await page.click('.fl-hero'); // reversal 2
  await d.settle();
  const hs = await ev(() => window.__t.stopSampler('hero'));
  const finalState = await ev(() => ({ e: window.__flowers.bouquet.exploded, p: window.__flowers.bouquet.explodeProgress }));
  motionChecks('motion continuity over explode, reversals, assemble', hs);
  if (inject) {
    console.log('     (inject mode: stopping after the hero section; the continuity checks above are EXPECTED to FAIL)');
    await ctx.close();
    return { results, errors, warnings, info: { quality: 'low', env: '-', frames: 0, ms: 0 }, shots };
  }
  check('hero reversals ended in a consistent state', finalState.e === (finalState.p > 0.5) && (finalState.p > 0.95 || finalState.p < 0.05), JSON.stringify(finalState));
  // make sure we end assembled for the next sections
  if (finalState.e) { await page.click('.fl-hero'); await d.settle(); }
  const bindBack = await ev(() => window.__flowers.binding.object.scale.x);
  check('assembled again: twine back at full size', bindBack > 0.98, `scale ${bindBack.toFixed(2)}`);
  check('no console errors after explode cycles', errors.length === 0, errors.join(' | '));

  // ---- hold and drag on a flower (assembled), real mouse
  let cands = await ev(() => window.__t.pickable());
  const prefer = ['rose', 'peony', 'daisy', 'tulip', 'eucalyptus'];
  cands.sort((a, b) => prefer.indexOf(a.variety) - prefer.indexOf(b.variety));
  check('there are flowers that can be picked at their bloom centre', cands.length >= 4, `${cands.length} pickable`);
  const dragC = cands[0];
  const head0 = await ev((id) => window.__t.head(id), dragC.id);
  await ev((id) => window.__t.startSampler('drag', id), dragC.id);
  await page.mouse.move(dragC.x, dragC.y);
  await page.mouse.down();
  await sleep(250);
  await d.until(() => window.__t.mode() === 'drag', null, 120000);
  const dragStartHead = await ev((id) => window.__t.head(id), dragC.id);
  await d.frames(2);
  const dragStillHead = await ev((id) => window.__t.head(id), dragC.id);
  const idle = Math.hypot(...dragStillHead.map((v, i) => v - dragStartHead[i]));
  check('hold 180ms starts a drag (selected, mode=drag)', await ev((id) => window.__flowers.input.selected === id && window.__flowers.bouquet.inspect(id).dragging, dragC.id));
  check('no jump when the drag begins (held still 2 frames)', idle < 0.012, `${(idle * 1000).toFixed(1)} mm`);
  const dx = vp.width < 600 ? 70 : 150;
  for (let i = 1; i <= 8; i++) { await page.mouse.move(dragC.x + (dx * i) / 8, dragC.y - (30 * i) / 8); }
  await d.frames(6);
  await snap('drag-mid');
  const dragHead = await ev((id) => window.__t.head(id), dragC.id);
  const moved = Math.hypot(...dragHead.map((v, i) => v - head0[i]));
  const stemTol = await ev((id) => window.__t.stemToBinding(id), dragC.id);
  check('dragged flower moved', moved > 0.05, `${(moved * 100).toFixed(1)} cm`);
  check('stem still crosses the binding point while dragging', stemTol < 0.04, `${(stemTol * 100).toFixed(1)} cm from binding`);
  await page.mouse.up();
  await d.settle();
  const drag1 = await ev(({ id }) => ({ stem: window.__t.stemToBinding(id), any: window.__t.anyDragging(), mode: window.__t.mode() }), { id: dragC.id });
  const dsamp = await ev(() => window.__t.stopSampler('drag'));
  check('after release: stem at binding, no stuck drag, gesture idle', drag1.stem < 0.04 && !drag1.any && drag1.mode === 'idle', JSON.stringify(drag1));
  motionChecks('drag follows without a jump', dsamp);

  // ---- grabbing a flower mid-explosion must not jump
  await d.settle();
  cands = await ev(() => window.__t.pickable());
  cands.sort((a, b) => prefer.indexOf(a.variety) - prefer.indexOf(b.variety));
  const mid = cands[Math.min(1, cands.length - 1)];
  await ev(() => window.__t.startSampler('grab'));
  await page.click('.fl-hero');
  await d.waitProgress((p) => p > 0.35 && p < 0.8);
  // The flower is moving: look it up fresh and press where it is now.
  const nowPos = await ev((id) => window.__flowers.flowerScreenPosition(id), mid.id);
  const hit = await ev(({ x, y }) => window.__flowers.pickAt(x, y), nowPos);
  await page.mouse.move(nowPos.x, nowPos.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(nowPos.x + 12 * i, nowPos.y - 6 * i);
  await d.frames(6);
  await page.mouse.up();
  await d.settle();
  const gs = await ev(() => window.__t.stopSampler('grab'));
  check('grab during explosion: pressed on a flower', hit !== null, `picked id ${hit}`);
  motionChecks('grab during explosion: no jump', gs);
  const grabEnd = await ev(() => ({ any: window.__t.anyDragging(), mode: window.__t.mode() }));
  check('grab during explosion: nothing stuck afterwards', !grabEnd.any && grabEnd.mode === 'idle', JSON.stringify(grabEnd));
  await page.click('.fl-hero'); // back to assembled
  await d.settle();
  if (await ev(() => window.__flowers.bouquet.exploded)) { await page.click('.fl-hero'); await d.settle(); }

  // ---- quick swipe starting on a flower orbits and does not move it
  cands = await ev(() => window.__t.pickable());
  cands.sort((a, b) => prefer.indexOf(a.variety) - prefer.indexOf(b.variety));
  const sw = cands[0];
  const swHead0 = await ev((id) => window.__t.head(id), sw.id);
  const az0 = await ev(() => window.__flowers.rig.azimuth);
  await d.swipe(sw.x, sw.y, vp.width < 600 ? 70 : 140, 0, 5);
  await d.frames(4);
  await d.settle();
  const az1 = await ev(() => window.__flowers.rig.azimuth);
  const swHead1 = await ev((id) => window.__t.head(id), sw.id);
  const swMoved = Math.hypot(...swHead1.map((v, i) => v - swHead0[i]));
  check('quick swipe on a flower: camera azimuth changed', Math.abs(az1 - az0) > 0.05, `${az0.toFixed(2)} -> ${az1.toFixed(2)}`);
  check('quick swipe on a flower: flower did NOT move', swMoved < 0.005 && !(await ev(() => window.__t.anyDragging())), `${(swMoved * 1000).toFixed(1)} mm`);

  // ---- tap selects, Remove removes, empty tap deselects
  cands = await ev(() => window.__t.pickable());
  cands.sort((a, b) => prefer.indexOf(a.variety) - prefer.indexOf(b.variety));
  const tapC = cands[0];
  await d.tap(tapC.x, tapC.y);
  await d.frames(3);
  const sel = await ev(() => ({ sel: window.__flowers.input.selected, open: !!document.querySelector('.fl-sel.fl-open'), text: document.querySelector('.fl-sel-name')?.textContent }));
  check('tap selects the flower and shows the selection tag', sel.sel === tapC.id && sel.open && !!sel.text, JSON.stringify(sel));
  await snap('selected');
  // watch the removed flower: its scale each frame until it leaves the scene
  await ev((id) => {
    const rec = window.__flowers.bouquet.flowers.find((f) => f.id === id);
    const o = rec.visual.object;
    const s = (window.__rm = { scales: [], frames: 0, gone: false });
    const tick = () => {
      s.frames++;
      s.scales.push(o.scale.x);
      if (!o.parent) { s.gone = true; return; }
      requestAnimationFrame(tick);
    };
    window.__rmStart = () => requestAnimationFrame(tick);
  }, tapC.id);
  await page.evaluate(() => window.__rmStart());
  await page.click('.fl-remove');
  await d.until(() => window.__rm.gone, null, 240000);
  const rm = await ev(() => ({ ...window.__rm, count: window.__flowers.bouquet.flowers.length, label: document.querySelector('.fl-hero-count')?.textContent, selected: window.__flowers.input.selected }));
  const lastScale = rm.scales[rm.scales.length - 2] ?? 1;
  check('Remove: count is 16 (model and hero label)', rm.count === 16 && /16/.test(rm.label ?? ''), `${rm.count}, "${rm.label}"`);
  check('Remove: selection cleared', rm.selected === null);
  check('Remove: flower leaves within ~0.5 s of simulated time', rm.frames <= 16, `${rm.frames} frames (sim dt capped at 1/20 s, so ~${(rm.frames * 0.05).toFixed(2)} s; wall time is longer under software rendering)`);
  check('Remove: exit does not pop (scale reaches ~0 before the flower is dropped)', lastScale < 0.08, `last visible scale ${lastScale.toFixed(3)}; series ${rm.scales.slice(-6).map((v) => v.toFixed(2)).join(' ')}`);
  let mono = true;
  for (let i = 1; i < rm.scales.length; i++) if (rm.scales[i] > rm.scales[i - 1] + 1e-6) mono = false;
  check('Remove: scale only ever decreases', mono);
  await d.settle();
  // empty tap deselects: select first, then tap empty space
  cands = await ev(() => window.__t.pickable());
  cands.sort((a, b) => prefer.indexOf(a.variety) - prefer.indexOf(b.variety));
  await d.tap(cands[0].x, cands[0].y);
  await d.frames(3);
  const empties = await ev(() => window.__t.emptyPoints());
  const ep = empties[Math.floor(empties.length / 3)];
  const sel2 = await ev(() => window.__flowers.input.selected);
  await d.tap(ep.x, ep.y);
  await d.frames(3);
  const sel3 = await ev(() => ({ s: window.__flowers.input.selected, open: !!document.querySelector('.fl-sel.fl-open') }));
  check('tap on empty space deselects', sel2 !== null && sel3.s === null && !sel3.open, `before ${sel2}, after ${JSON.stringify(sel3)}`);

  // ---- core run (medium): resize and tier switches exercise the composer path, and texture memory must stay flat
  if (sc.core) {
    await page.setViewportSize({ width: 1000, height: 640 });
    await d.frames(3);
    await d.settle();
    await snap('resized-1000x640');
    const fit = await ev(() => { const F = window.__flowers; const p = F.flowerScreenPosition(F.bouquet.flowers[0].id); return { w: F.stage.renderer.domElement.clientWidth, h: F.stage.renderer.domElement.clientHeight, p }; });
    check('resize: canvas follows the window and flowers still project onto it', fit.w === 1000 && fit.h === 640 && fit.p.x > 0 && fit.p.x < 1000, JSON.stringify(fit));
    const counts = [];
    const tex = () => ev(() => ({ t: window.__flowers.stage.renderer.info.memory.textures, g: window.__flowers.stage.renderer.info.memory.geometries }));
    counts.push(await tex());
    for (let i = 0; i < 4; i++) {
      await ev(() => window.__flowers.stage.setQuality('low'));
      await d.frames(3);
      await ev(() => window.__flowers.stage.setQuality('medium'));
      await d.frames(3);
      counts.push(await tex());
    }
    check('tier cycles medium->low->medium x4: texture count flat (composer passes are disposed)', counts.every((c) => c.t === counts[1].t), JSON.stringify(counts.map((c) => c.t)));
    const q = await ev(() => window.__flowers.stage.quality);
    check('back at medium after the cycles, rendering continues', q === 'medium');
    check('no console errors during the medium core run', errors.length === 0, errors.join(' | '));
    const info0 = await ev(() => ({ quality: window.__flowers.stage.quality, env: window.__flowers.stage.environment, frames: window.__flowers.stage.stats.frames, ms: Math.round(window.__flowers.stage.stats.frameMs), n: window.__flowers.bouquet.flowers.length }));
    await ctx.close();
    return { results, errors, warnings, info: info0, shots };
  }

  // ---- add from the catalogue through the real buttons
  if (full) {
    const nVar = await page.locator('.fl-card').count();
    check('catalogue lists 5 varieties', nVar === 5, `${nVar}`);
    for (let i = 0; i < nVar; i++) {
      const before = await ev(() => window.__flowers.bouquet.flowers.length);
      const name = await page.locator('.fl-card .fl-name').nth(i).textContent();
      await page.locator('.fl-card .fl-add').nth(i).click();
      await d.until((n) => window.__flowers.bouquet.flowers.length === n + 1, before);
      await d.settle();
      const info = await ev(() => {
        const f = window.__flowers.bouquet.flowers.at(-1);
        const p = window.__flowers.flowerScreenPosition(f.id);
        return { id: f.id, variety: f.variety, inScene: !!f.visual.object.parent, p, w: innerWidth, h: innerHeight, settled: !window.__flowers.bouquet.settling };
      });
      const visible = info.p && info.p.x > 0 && info.p.y > 0 && info.p.x < info.w && info.p.y < info.h;
      check(`add ${name}: count ${before} -> ${before + 1}, flower in scene and on screen`, info.inScene && visible && info.variety.toLowerCase() === name.toLowerCase(), `at ${Math.round(info.p?.x)},${Math.round(info.p?.y)}`);
    }
    await snap('after-adds');
    const nSw = await page.locator('.fl-card').first().locator('.fl-swatch').count();
    const seen = [];
    for (let i = 0; i < nSw; i++) {
      await page.locator('.fl-card').first().locator('.fl-swatch').nth(i).click();
      await page.locator('.fl-card').first().locator('.fl-add').click();
      await d.frames(2);
      const got = await ev(() => { const f = window.__flowers.bouquet.flowers.at(-1); return { v: f.variety, pal: window.__flowers.describe(f.id).paletteIndex }; });
      seen.push(got);
    }
    check(`rose: all ${nSw} swatches add a rose with that palette`, seen.length === nSw && seen.every((s, i) => s.v === 'rose' && s.pal === i), JSON.stringify(seen));
    await d.settle();
    await snap('after-rose-swatches');
    const bad = await ev(() => {
      const out = [];
      for (const f of window.__flowers.bouquet.flowers) if (!Number.isFinite(window.__flowers.describe(f.id)?.paletteIndex)) out.push(f.id);
      return out;
    });
    check('every flower has a valid palette index', bad.length === 0, JSON.stringify(bad));
    // the cap: fill to 39 directly, add the 40th through the UI, then Add must be disabled with a message
    await ev(() => { const F = window.__flowers; while (F.bouquet.flowers.length < 39) F.bouquet.add('tulip', 0); });
    await page.locator('.fl-card .fl-add').nth(1).click();
    await d.frames(2);
    const cap = await ev(() => ({ n: window.__flowers.bouquet.flowers.length, dis: [...document.querySelectorAll('.fl-add')].every((b) => b.disabled), note: !document.querySelector('.fl-note').hidden, text: document.querySelector('.fl-note').textContent, threw: (() => { try { window.__flowers.bouquet.add('rose', 0); return false; } catch { return true; } })(), after: window.__flowers.bouquet.flowers.length }));
    check('cap: 40 flowers, every Add disabled, message shown, Bouquet.add refuses', cap.n === 40 && cap.dis && cap.note && cap.threw && cap.after === 40, JSON.stringify(cap));
    await snap('full-40');
    await d.settle();
  }
  check('no console errors after adding flowers', errors.length === 0, errors.join(' | '));

  // ---- orbit and zoom with mouse
  await d.settle();
  const empties2 = await ev(() => window.__t.emptyPoints());
  const ep2 = empties2[Math.floor(empties2.length / 2)];
  const azA = await ev(() => window.__flowers.rig.azimuth);
  await page.mouse.move(ep2.x, ep2.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(ep2.x + i * 15, ep2.y);
  await page.mouse.up();
  await d.settle();
  const azB = await ev(() => window.__flowers.rig.azimuth);
  check('empty-space drag orbits the camera', Math.abs(azB - azA) > 0.2, `${azA.toFixed(2)} -> ${azB.toFixed(2)}`);
  // empty region that sits inside the #ui container (and inside the dock's box) still reaches the canvas
  const dockPt = await ev(() => {
    const r = document.querySelector('.fl-dock').getBoundingClientRect();
    return { x: r.left + 4, y: r.top + 4, tag: document.elementFromPoint(r.left + 4, r.top + 4)?.id ?? document.elementFromPoint(r.left + 4, r.top + 4)?.className };
  });
  const uiBox = await ev(() => { const r = document.getElementById('ui').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  check('point inside #ui and the dock box hits the canvas (UI container does not swallow input)', dockPt.tag === 'stage' && uiBox.w >= vp.width - 1, `${JSON.stringify(dockPt)} #ui ${uiBox.w}x${uiBox.h}`);
  const azC = await ev(() => window.__flowers.rig.azimuth);
  await page.mouse.move(dockPt.x, dockPt.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(dockPt.x - i * 12, dockPt.y - i * 3);
  await page.mouse.up();
  await d.settle();
  const azD = await ev(() => window.__flowers.rig.azimuth);
  check('drag starting on empty space over the UI container orbits', Math.abs(azD - azC) > 0.15, `${azC.toFixed(2)} -> ${azD.toFixed(2)}`);
  // wheel
  await page.mouse.move(ep2.x, ep2.y);
  const z0 = await ev(() => window.__t.zoomRatio());
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
  await d.frames(8);
  await d.settle();
  const zIn = await ev(() => window.__t.zoomRatio());
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -600);
  await d.frames(6);
  await d.settle();
  const zMin = await ev(() => window.__t.zoomRatio());
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 600);
  await d.frames(6);
  await d.settle();
  const zMax = await ev(() => window.__t.zoomRatio());
  check('wheel up zooms in', zIn < z0 - 0.05, `${z0.toFixed(2)} -> ${zIn.toFixed(2)}`);
  check('wheel zoom stays inside clamps [0.45, 1.5] of the fit distance', zMin >= 0.449 && zMin < 0.5 && zMax <= 1.501 && zMax > 1.4, `min ${zMin.toFixed(3)}, max ${zMax.toFixed(3)}`);
  await page.mouse.move(ep2.x, ep2.y);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -300); // return to roughly the default
  await d.settle();
  await ev(() => { window.__flowers.rig.zoomBy(1 / window.__flowers.rig.zoomTarget); }); // reset zoom target to 1
  await d.settle();

  // ---- simulated touch via CDP (not a physical device)
  console.log('     note: touch below is simulated with CDP Input.dispatchTouchEvent, not a physical device');
  await d.settle();
  // tap selects
  cands = await ev(() => window.__t.pickable());
  cands.sort((a, b) => prefer.indexOf(a.variety) - prefer.indexOf(b.variety));
  const tc = cands[0];
  await d.touchBatch([['touchStart', [[tc.x, tc.y, 1]]], ['touchEnd', []]]);
  await d.frames(3);
  const tsel = await ev(() => window.__flowers.input.selected);
  check('touch: tap selects', tsel === tc.id, `selected ${tsel}, expected ${tc.id}`);
  await ev(() => window.__flowers.input.select(null));
  // hold and drag
  cands = await ev(() => window.__t.pickable());
  cands.sort((a, b) => prefer.indexOf(a.variety) - prefer.indexOf(b.variety));
  const hc = cands[0];
  const th0 = await ev((id) => window.__t.head(id), hc.id);
  await d.touch('touchStart', [[hc.x, hc.y, 1]]);
  await sleep(300);
  await d.until(() => window.__t.mode() === 'drag', null, 120000);
  const tdx = vp.width < 600 ? 60 : 130;
  for (let i = 1; i <= 6; i++) await d.touch('touchMove', [[hc.x + (tdx * i) / 6, hc.y - (25 * i) / 6, 1]]);
  await d.frames(6);
  await snap('touch-drag-mid');
  const th1 = await ev((id) => window.__t.head(id), hc.id);
  const tmoved = Math.hypot(...th1.map((v, i) => v - th0[i]));
  check('touch: hold then drag moves the flower', tmoved > 0.04, `${(tmoved * 100).toFixed(1)} cm`);
  // a second finger arrives mid-drag: drag must end cleanly and hand over to pinch
  const fx = hc.x + tdx;
  const fy = hc.y - 25;
  await d.touch('touchStart', [[fx, fy, 1], [fx - 90, fy + 60, 2]]);
  await d.frames(3);
  const two = await ev(() => ({ mode: window.__t.mode(), dragging: window.__t.anyDragging() }));
  check('touch: second finger cancels the drag and starts a pinch', two.mode === 'pinch' && !two.dragging, JSON.stringify(two));
  // pinch zoom: spread the fingers apart
  const zp0 = await ev(() => window.__t.zoomRatio());
  for (let i = 1; i <= 8; i++) await d.touch('touchMove', [[fx + i * 6, fy - i * 3, 1], [fx - 90 - i * 10, fy + 60 + i * 6, 2]]);
  await d.frames(6);
  await d.settle();
  const zp1 = await ev(() => window.__t.zoomRatio());
  check('touch: pinch (fingers apart) zooms in', zp1 < zp0 - 0.05, `${zp0.toFixed(2)} -> ${zp1.toFixed(2)}`);
  await d.touch('touchEnd', []);
  await d.settle();
  const after = await ev(() => ({ mode: window.__t.mode(), dragging: window.__t.anyDragging() }));
  check('touch: after lifting both fingers nothing is stuck (idle, no flower dragging)', after.mode === 'idle' && !after.dragging, JSON.stringify(after));
  // pinch out again, then orbit with one finger
  await ev(() => window.__flowers.rig.zoomBy(1 / window.__flowers.rig.zoomTarget));
  await d.settle();
  const tAz0 = await ev(() => window.__flowers.rig.azimuth);
  const e3 = await ev(() => window.__t.emptyPoints());
  const tp = e3[Math.floor(e3.length / 2)];
  await d.touchBatch([['touchStart', [[tp.x, tp.y, 1]]], ['touchMove', [[tp.x + 30, tp.y, 1]]], ['touchMove', [[tp.x + 60, tp.y, 1]]], ['touchMove', [[tp.x + 90, tp.y, 1]]], ['touchEnd', []]]);
  await d.settle();
  const tAz1 = await ev(() => window.__flowers.rig.azimuth);
  check('touch: one-finger drag on empty space orbits', Math.abs(tAz1 - tAz0) > 0.1, `${tAz0.toFixed(2)} -> ${tAz1.toFixed(2)}`);

  // ---- exploded drag carries through reassembly
  await d.settle();
  await page.click('.fl-hero');
  await d.settle();
  cands = await ev(() => window.__t.pickable());
  const withSide = [];
  for (const c of cands) withSide.push({ ...c, side: await ev((id) => window.__t.sideOf(id), c.id) });
  withSide.sort((a, b) => a.side - b.side); // left-most first
  const ec = withSide[0];
  const target = await ev(({ id }) => {
    const r = window.__t.camRight();
    const b = window.__flowers.bouquet.bindingPoint;
    const k = 0.42;
    return window.__t.toScreen(b.x + r[0] * k, b.y + 0.2 + r[1] * k, b.z + r[2] * k);
  }, { id: ec.id });
  const ex0 = await ev((id) => window.__t.sideOf(id), ec.id);
  await page.mouse.move(ec.x, ec.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) await page.mouse.move(ec.x + ((target.x - ec.x) * i) / steps, ec.y + ((target.y - ec.y) * i) / steps);
  await d.frames(8);
  const ex1 = await ev((id) => window.__t.sideOf(id), ec.id);
  await snap('exploded-drag-mid');
  await page.mouse.up();
  await d.settle();
  const ex2 = await ev((id) => window.__t.sideOf(id), ec.id);
  check('exploded drag moves the flower across the bouquet', ex1 > ex0 + 0.2, `side ${ex0.toFixed(2)} -> ${ex1.toFixed(2)} m (screen-right positive)`);
  await page.click('.fl-hero'); // reassemble
  await d.settle();
  const ex3 = await ev((id) => ({ side: window.__t.sideOf(id), stem: window.__t.stemToBinding(id), exploded: window.__flowers.bouquet.exploded }), ec.id);
  await snap('reassembled-after-exploded-drag');
  check('exploded move survives reassembly (flower ends on the side it was dragged to)', !ex3.exploded && ex0 < 0 && ex3.side > 0.1 && ex3.stem < 0.04, `before ${ex0.toFixed(2)}, exploded ${ex2.toFixed(2)}, assembled ${ex3.side.toFixed(2)}`);

  // ---- final
  check('no console errors during the whole walkthrough', errors.length === 0, errors.join(' | '));
  const info = await ev(() => ({ quality: window.__flowers.stage.quality, env: window.__flowers.stage.environment, frames: window.__flowers.stage.stats.frames, ms: Math.round(window.__flowers.stage.stats.frameMs), n: window.__flowers.bouquet.flowers.length }));
  await ctx.close();
  return { results, errors, warnings, info, shots };
}

// ------------------------------------------------------------------------------------------------ governor

async function landscapePhone(browser, sc) {
  const { check, results } = makeChecks();
  const { ctx, page, errors, warnings, shot } = await bootPage(browser, sc, { hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  await installPageHelpers(page);
  const d = makeDriver(page, cdp);
  const { ev } = d;
  const shots = [];
  await d.settle();
  shots.push(await shot('assembled'));
  const m = await ev(() => {
    const F = window.__flowers;
    const cat = document.querySelector('.fl-catalogue').getBoundingClientRect();
    const list = document.querySelector('.fl-list');
    const hero = document.querySelector('.fl-hero').getBoundingClientRect();
    const ys = F.bouquet.flowers.map((f) => F.flowerScreenPosition(f.id).y);
    const xs = F.bouquet.flowers.map((f) => F.flowerScreenPosition(f.id).x);
    return { catRight: cat.right, scrolls: list.scrollHeight > list.clientHeight + 4, overflowY: getComputedStyle(list).overflowY, hero: { x: hero.x, y: hero.y, w: hero.width, h: hero.height }, bouquetH: Math.max(...ys) - Math.min(...ys), minX: Math.min(...xs), H: innerHeight, W: innerWidth };
  });
  check('landscape phone: side panel layout (panel at the left, not a bottom sheet)', m.catRight < 400 && m.hero.y + m.hero.h <= m.H, JSON.stringify(m));
  check('landscape phone: catalogue list scrolls', m.scrolls && m.overflowY === 'auto');
  check('landscape phone: bloom span is at least 30% of the screen height (was ~35 px of 390)', m.bouquetH >= 0.3 * m.H, `${m.bouquetH.toFixed(0)} px of ${m.H} (blooms only; stems add ~100 px)`);
  check('landscape phone: bouquet sits right of the panel', m.minX > m.catRight, `min bloom x ${m.minX.toFixed(0)}, panel right ${m.catRight.toFixed(0)}`);
  await page.click('.fl-hero');
  await d.settle();
  shots.push(await shot('exploded'));
  const ex = await ev(() => window.__flowers.bouquet.exploded);
  check('landscape phone: hero button reachable and explodes the bouquet', ex);
  const pts = await ev(() => { const F = window.__flowers; return F.bouquet.flowers.map((f) => F.flowerScreenPosition(f.id)).filter((p) => p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > innerHeight).length; });
  check('landscape phone: exploded blooms all on screen', pts === 0, `${pts} outside`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  return { results, errors, warnings, info: { quality: 'low', env: 'hdri', frames: 0, ms: 0 }, shots };
}

async function governorScenario(browser, sc) {
  const { check, results } = makeChecks();
  const ctx = await browser.newContext({ viewport: sc.viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    // independent wall-clock frame intervals from rAF, recorded from the very first frame
    const m = (window.__gov = { ms: [] });
    let last = 0;
    const tick = (now) => { if (last) m.ms.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const page = await ctx.newPage();
  const errors = [];
  const warnings = [];
  const infos = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); else if (m.type() === 'warning') warnings.push(m.text()); else if (m.type() === 'info') infos.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE + '/' + sc.query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__flowers?.stage?.stats.downgrades >= 1, null, { timeout: 600000, polling: 500 });
  const forced = await page.evaluate(() => window.__flowers.stage.qualityForced);
  check('no ?quality= override: tier is not forced', forced === false);
  // let a few frames pass at the new tier so the smoothed value reflects it
  const f0 = await page.evaluate(() => window.__flowers.stage.stats.frames);
  await page.waitForFunction((n) => window.__flowers.stage.stats.frames > n + 8, f0, { timeout: 300000, polling: 500 });
  const r = await page.evaluate(() => {
    const s = window.__flowers.stage;
    const ms = window.__gov.ms.slice(-8);
    return { q: s.quality, downgrades: s.stats.downgrades, frameMs: s.stats.frameMs, rafMean: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length) };
  });
  check('governor: tier dropped automatically from high with no override', r.q !== 'high' && r.downgrades >= 1, `now ${r.q}, downgrades ${r.downgrades}`);
  check('governor: stats.frameMs tracks real frame time (0.4x to 2.5x of an independent rAF measurement; was stuck near 17)', r.frameMs > 32 && r.frameMs / r.rafMean < 2.5 && r.frameMs / r.rafMean > 0.4, `frameMs ${r.frameMs.toFixed(0)}, rAF mean ${r.rafMean.toFixed(0)}`);
  check('governor: downgrade was logged from high', infos.some((m) => m.includes('downgrading high')), infos.join(' | ').slice(0, 200));
  await page.screenshot({ path: join(outDir, 'governor-auto-after-downgrade.png'), timeout: 240000 });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  return { results, errors, warnings, info: { quality: r.q, env: '-', frames: 0, ms: Math.round(r.frameMs) }, shots: [] };
}

// ------------------------------------------------------------------------------------------------ runner

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const failures = [];
  try {
    for (const sc of SCENARIOS) {
      if (filter && !sc.name.includes(filter)) continue;
      console.log(`--- ${sc.name}`);
      let out;
      if (sc.run) {
        try {
          out = await sc.run(browser, sc, {});
        } catch (e) {
          console.log(`FAIL ${sc.name}: threw ${e.stack ?? e}`);
          failures.push(`${sc.name} (threw)`);
          continue;
        }
      } else {
        const { ctx, page, errors, warnings, shot } = await bootPage(browser, sc);
        const file = await shot('');
        if (sc.steps) await sc.steps(page, { shot });
        const info = await page.evaluate(() => {
          const s = window.__flowers.stage;
          return { quality: s.quality, env: s.environment, frames: s.stats.frames, ms: Math.round(s.stats.frameMs), n: window.__flowers.bouquet.flowers.length };
        });
        const { results, check } = makeChecks();
        check('17 flowers on load', info.n === 17, `${info.n}`);
        check(`tier is ${sc.expectTier}`, info.quality === sc.expectTier, info.quality);
        out = { results, errors, warnings, info, shots: [file] };
        await ctx.close();
      }
      const failed = out.results.filter((r) => !r.ok);
      const bad = failed.length > 0 || out.errors.length > 0 || (sc.expectTier && out.info.quality !== sc.expectTier);
      console.log(`${bad ? 'FAIL' : 'ok  '} ${sc.name}  tier=${out.info.quality} env=${out.info.env} frames=${out.info.frames} ~${out.info.ms}ms  checks ${out.results.length - failed.length}/${out.results.length}`);
      for (const f of out.shots) console.log(`     shot ${f}`);
      for (const w of out.warnings) console.log(`     warn: ${w}`);
      for (const e of out.errors) console.log(`     ${e}`);
      if (bad) failures.push(sc.name);
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  if (failures.length) { console.error(`verify failed: ${failures.join(', ')}`); process.exit(1); }
  console.log('verify passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
