/**
 * The shop's rose mark over its film. The section is two screens or more tall and its stage sticks (CSS position: sticky,
 * so the compositor holds it; no scroll is taken over), giving the line a long run. The film fills the section from the start; over it sits the wine disc of the
 * logo, and as the section rises the rose's line draws itself as a cut through the disc (wine where the stem leaves
 * it). By the time the section fills the screen the mark has come at the visitor and they have gone through the line
 * into the film. The film itself (play while on screen, pause button) is handled by shopVideo() in page.ts.
 *
 * The rose path in index.html (.reel__path) was traced from public/brand/lockup-olive.png, drawn from the hook to the
 * stem's tail, in the mark's own units: the disc's centre at 0,0.
 */
const R = 138.5; // disc radius
const LINE = 11.7; // line width
const TOP = -R - 4; // the mark's extent: disc top to the stem's tail
const BOTTOM = 181;
const DIVE = [-15, 56.1]; // a straight run of the stem inside the disc: the zoom goes through here
const PAD = 24;

export function reel(): void {
  const sec = document.querySelector<HTMLElement>('[data-reel]');
  const stage = sec?.querySelector<HTMLElement>('.reel__stage');
  const video = sec?.querySelector('video');
  const canvas = sec?.querySelector<HTMLCanvasElement>('canvas.reel__mask');
  const line = sec?.querySelector<SVGPathElement>('.reel__path path');
  const ctx = canvas?.getContext('2d');
  if (!sec || !stage || !video || !canvas || !line || !ctx) return;

  // The upright film on an upright screen, the counter film on a wide one. Picked once; poster first.
  const base = `${import.meta.env.BASE_URL}video/${innerHeight > innerWidth ? 'puokste' : 'dirbtuve'}`;
  video.poster = `${base}.webp`;
  video.src = `${base}.mp4`;

  const rose = new Path2D(line.getAttribute('d') ?? '');
  const length = line.getTotalLength();
  const outside = new Path2D(); // everything but the disc, for the stem where it leaves it
  outside.rect(-1e4, -1e4, 2e4, 2e4);
  outside.arc(0, 0, R, 0, Math.PI * 2);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, k = 1, zMax = 1, dpr = 1;
  let shown = '';
  let wine = '#7b2639';

  const layout = (): void => {
    W = stage.clientWidth;
    H = stage.clientHeight;
    if (!W || !H) return;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    k = Math.min(W * 0.56, H * 0.46) / (2 * R);
    // Deep enough that the line's half-width covers the whole screen from wherever it sits.
    zMax = (2.2 * Math.hypot(W, H)) / (LINE * k);
    wine = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || wine;
    shown = '';
    draw();
  };

  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  /**
   * The section is taller than the screen and its stage sticks under the nav (CSS), so the browser's own scrolling holds
   * the film still while t, the pixels of section risen so far, runs on. The mark sits mid-film: the line starts once the
   * whole mark is on screen, finishes a little past halfway through the held run, then the dive goes through it.
   */
  const draw = (): void => {
    if (!W) return;
    const t = innerHeight - sec.getBoundingClientRect().top;
    const L = Math.max(1, sec.offsetHeight - H); // the held run
    const markH = (BOTTOM - TOP) * k;
    const t0 = Math.min(H * 0.9, H / 2 + markH / 2 + PAD);
    const t1 = H + L * 0.55;
    const t2 = H + L * 0.9;
    const drawn = still.matches ? 1 : smooth(clamp((t - t0) / (t1 - t0)));
    const dive = still.matches ? 0 : clamp((t - t1) / (t2 - t1));
    const cx = W / 2;
    const cy = H / 2 - ((TOP + BOTTOM) / 2) * k;
    const z = zMax ** (dive * dive); // starts gently, then the exponential carries it through the line
    const key = `${z}|${drawn}|${cy}`;
    if (key === shown) return;
    shown = key;
    stage.dataset.drawn = drawn.toFixed(3);
    stage.classList.toggle('is-open', dive >= 1);
    if (dive >= 1) return;

    const sx = cx + DIVE[0] * k;
    const sy = cy + DIVE[1] * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(sx, sy);
    ctx.scale(z, z);
    ctx.translate(cx - sx, cy - sy);
    ctx.scale(k, k);
    ctx.fillStyle = ctx.strokeStyle = wine;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    if (drawn <= 0) return;
    ctx.lineWidth = LINE;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.setLineDash([length * drawn, length * 2]);
    ctx.globalCompositeOperation = 'destination-out'; // the line cuts the disc...
    ctx.stroke(rose);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); // ...and is wine where the stem leaves it
    ctx.clip(outside, 'evenodd');
    ctx.stroke(rose);
    ctx.restore();
  };

  let queued = false;
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; draw(); });
  };
  let near = false;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting === near) return;
    near = e.isIntersecting;
    if (near) { addEventListener('scroll', onScroll, { passive: true }); draw(); } else removeEventListener('scroll', onScroll);
  }, { rootMargin: '25% 0px' }).observe(sec);

  new ResizeObserver(layout).observe(stage);
  still.addEventListener('change', () => { shown = ''; draw(); });
}
