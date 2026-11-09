// Screenshots the UI preview at three sizes and three states into .verify/ui/, and asserts that the centre of
// the viewport is not a UI element (so empty space still reaches the 3D canvas). Fails on console errors.
// Usage: node scripts/preview-ui.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.verify', 'ui');
const PORT = 5173;
const BASE = `http://localhost:${PORT}`;
const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 }, small: { width: 360, height: 640 } };
const STATES = { default: '', selected: '&selected=1&hint=0', exploded: '&exploded=1&selected=1&hint=0' };

async function reachable() { try { return (await fetch(BASE)).ok; } catch { return false; } }
async function ensureServer() {
  if (await reachable()) return null;
  const bin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { if (await reachable()) return child; await new Promise((r) => setTimeout(r, 200)); }
  child.kill();
  throw new Error('vite did not start');
}

mkdirSync(outDir, { recursive: true });
const server = await ensureServer();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
let failed = false;
try {
  for (const [sn, viewport] of Object.entries(SIZES)) {
    for (const [stn, query] of Object.entries(STATES)) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
      await page.goto(`${BASE}/preview/ui.html?x=1${query}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1600); // hint entrance and transitions settle
      const hit = await page.evaluate(() => {
        const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return { tag: e?.id || e?.className || e?.tagName, ui: !!e?.closest('.fl-ui') };
      });
      const geo = await page.evaluate(() => {
        const c = document.querySelector('.fl-catalogue')?.getBoundingClientRect();
        const h = document.querySelector('.fl-hero')?.getBoundingClientRect();
        const docOverflow = document.documentElement.scrollWidth > innerWidth;
        const small = [...document.querySelectorAll('.fl-ui button')].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width < 43.5 || r.height < 43.5;
        }).map((b) => b.className);
        return { sheetFrac: c ? +(c.height / innerHeight).toFixed(3) : null, panelRight: c?.right, heroTop: h?.top, heroBottom: h?.bottom, docOverflow, small };
      });
      const ok = !hit.ui && !geo.docOverflow && geo.small.length === 0 && errors.length === 0;
      const file = join(outDir, `${sn}-${stn}.png`);
      await page.screenshot({ path: file });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${sn}-${stn} centre=${hit.tag} uiAtCentre=${hit.ui} ${JSON.stringify(geo)}`);
      for (const e of errors) console.log(`     ${e}`);
      if (!ok) failed = true;
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server?.kill();
}
if (failed) { console.error('preview-ui failed'); process.exit(1); }
console.log('preview-ui passed');
