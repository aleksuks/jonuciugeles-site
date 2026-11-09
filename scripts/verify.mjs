// Browser walkthrough of the store page on its own stable dev server (port 5175). Screenshots in .verify/.
// Fails on console errors or failed checks. Usage: node scripts/verify.mjs [--filter=name]
// Software WebGL is slow, so the bouquet simulation is fast-forwarded in-page instead of waited for.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.verify');
const PORT = Number(process.env.VERIFY_PORT ?? 5175);
const BASE = `http://localhost:${PORT}`;
const filter = (process.argv.find((a) => a.startsWith('--filter=')) ?? '').slice(9);

const SCENARIOS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, quality: 'low' },
  { name: 'phone', viewport: { width: 390, height: 844 }, quality: 'low', touch: true },
  { name: 'desktop-high', viewport: { width: 1440, height: 900 }, quality: 'high', heroOnly: true },
];

async function reachable() { try { return (await fetch(BASE)).ok; } catch { return false; } }
async function ensureServer() {
  if (await reachable()) return null;
  const bin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', env: { ...process.env, FLOWERS_STABLE: '1' } });
  for (let i = 0; i < 100; i++) { if (await reachable()) return child; await new Promise((r) => setTimeout(r, 200)); }
  child.kill();
  throw new Error('vite did not start');
}

async function run(browser, sc) {
  const ctx = await browser.newContext({ viewport: sc.viewport, deviceScaleFactor: 1, hasTouch: !!sc.touch, isMobile: !!sc.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
  const shot = async (tag) => { const f = join(outDir, `${sc.name}-${tag}.png`); await page.screenshot({ path: f, timeout: 120000 }); return f; };
  /** Advance the bouquet simulation, then let a few real frames render. */
  const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const settle = async (simSeconds = 2.5, n = 3) => {
    await frames(2);
    await page.evaluate((s) => { const b = window.__flowers.bouquet; for (let i = 0; i < s * 60; i++) b.update(1 / 60); }, simSeconds);
    await frames(n);
  };
  const scrollTo = async (sel) => {
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ behavior: 'instant', block: 'start' }), sel);
    await settle(1.5, 4);
  };

  await page.goto(`${BASE}/?quality=${sc.quality}&seed=4242`);
  await page.waitForFunction(() => window.__flowers && window.__flowers.stage.environment !== 'none', null, { timeout: 120000 });
  await settle(3, 4);
  await page.waitForTimeout(600); // canvas fade-in
  const hero = await page.evaluate(() => ({
    n: window.__flowers.bouquet.flowers.length,
    prog: window.__flowers.bouquet.explodeProgress,
    opacity: getComputedStyle(document.getElementById('stage')).opacity,
    ground: getComputedStyle(document.documentElement).getPropertyValue('--ground').trim(),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  check('bouquet has 15+ flowers', hero.n >= 15, hero.n);
  check('bouquet gathered after intro', hero.prog < 0.08, hero.prog.toFixed(3));
  check('canvas visible in hero', hero.opacity === '1', hero.opacity);
  check('ground sampled from canvas', /^#[0-9a-f]{6}$/.test(hero.ground) && hero.ground !== '#000000', hero.ground);
  check('no sideways scroll', hero.overflow <= 0, hero.overflow);
  const shots = [await shot('hero')];
  if (!sc.heroOnly) {
    await scrollTo('#mes-esame');
    shots.push(await shot('visit'));
    await scrollTo('#paslaugos');
    const ex = await page.evaluate(() => ({ exploded: window.__flowers.bouquet.exploded, prog: window.__flowers.bouquet.explodeProgress }));
    check('bouquet loosens in the flowers section', ex.exploded && ex.prog > 0.8, `${ex.exploded} ${ex.prog.toFixed(2)}`);
    shots.push(await shot('offer'));
    await scrollTo('#darbai');
    await page.waitForTimeout(700);
    await settle(0.5, 2);
    const op = await page.evaluate(() => getComputedStyle(document.getElementById('stage')).opacity);
    check('canvas hidden over the photos', op === '0', op);
    shots.push(await shot('work'));
    await scrollTo('#uzsakymas');
    const asm = await page.evaluate(() => window.__flowers.bouquet.exploded);
    check('bouquet ties again at the form', asm === false, asm);
    await page.click('#order-form button[type=submit]');
    const errs = await page.$$eval('.field__err', (els) => els.filter((e) => e.textContent).length);
    check('empty form shows field errors', errs === 3, errs);
    await page.fill('#f-name', 'Ona');
    await page.fill('#f-phone', '+370 600 12345');
    await page.check('input[name=delivery][value=yes]');
    check('address appears for delivery', await page.isVisible('#f-address'));
    await page.fill('#f-address', 'Artojų g. 3, Teleičiai');
    await page.fill('#f-message', 'Rožių puokštė gimtadieniui');
    await page.click('#order-form button[type=submit]');
    const status = await page.textContent('.form__status');
    check('form reports its state', /neprijungta|išsiųstas/.test(status ?? ''), status);
    shots.push(await shot('order'));
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await settle(0.2, 2);
    shots.push(await shot('footer'));
  }
  await ctx.close();
  return { results, errors, shots };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const failures = [];
  try {
    for (const sc of SCENARIOS) {
      if (filter && !sc.name.includes(filter)) continue;
      let out;
      try { out = await run(browser, sc); } catch (e) { console.log(`FAIL ${sc.name}: ${e.stack ?? e}`); failures.push(sc.name); continue; }
      const bad = out.results.some((r) => !r.ok) || out.errors.length > 0;
      console.log(`${bad ? 'FAIL' : 'ok  '} ${sc.name}`);
      for (const r of out.results) console.log(`  ${r.ok ? 'ok ' : 'BAD'} ${r.name}${r.detail !== '' ? ` (${r.detail})` : ''}`);
      for (const e of out.errors) console.log(`  console: ${e}`);
      for (const f of out.shots) console.log(`  shot ${f}`);
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
