// Screenshots the flower preview: the row, then a close-up of each variety, into .verify/flowers/.
// Usage: node scripts/preview-flowers.mjs [--quality=medium] [--only=rose] [--extra="&polar=0.5"] [--tag=name] [--row]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.verify', 'flowers');
const PORT = 5173;
const BASE = `http://localhost:${PORT}`;
const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const quality = arg('quality', 'medium');
const only = arg('only');
const extra = arg('extra');
const tag = arg('tag');
const rowOnly = process.argv.includes('--row');

async function reachable() {
  try { return (await fetch(BASE)).ok; } catch { return false; }
}
async function ensureServer() {
  if (await reachable()) return null;
  const bin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (await reachable()) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('vite did not start');
}

const shots = [];
if (!only) shots.push({ name: 'row', query: '', viewport: { width: 1400, height: 760 } });
if (!rowOnly) {
  for (const v of ['rose', 'tulip', 'daisy', 'peony', 'eucalyptus']) {
    if (only && only !== v) continue;
    shots.push({ name: `close-${v}`, query: `&variety=${v}&close=1`, viewport: { width: 900, height: 900 } });
  }
}

mkdirSync(outDir, { recursive: true });
const server = await ensureServer();
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
let failed = false;
try {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      else if (m.type() === 'log' && m.text().startsWith('triangles')) console.log(m.text());
      else if (m.type() === 'warning') console.log(`warn: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
    await page.goto(`${BASE}/preview/flowers.html?quality=${quality}${s.query}${extra}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__preview?.ready === true, null, { timeout: 240000, polling: 500 });
    const file = join(outDir, `${s.name}${tag ? '-' + tag : ''}.png`);
    await page.screenshot({ path: file, timeout: 240000 });
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${s.name} ${file}`);
    for (const e of errors) console.log(`     ${e}`);
    if (errors.length) failed = true;
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
process.exit(failed ? 1 : 0);
