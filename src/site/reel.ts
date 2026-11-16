/**
 * The film inside the word. The section is tall and its stage sticks: at first the shop's film plays inside the letters
 * of "Gėlės" set across the screen, then scrolling dives into the stem of the "l" until the film fills the screen.
 * The film itself (play while on screen, pause button) is handled by shopVideo() in page.ts through [data-film].
 */
const WORD = 'Gėlės';
const STEM = 2; // the "l": its stem is the widest straight run in the word, so the dive lands inside the film
const FONT = (px: number): string => `900 ${px}px Fraunces, Georgia, serif`;

export function reel(): void {
  const sec = document.querySelector<HTMLElement>('[data-reel]');
  const stage = sec?.querySelector<HTMLElement>('.reel__stage');
  const video = sec?.querySelector('video');
  const svg = sec?.querySelector('svg');
  const text = svg?.querySelector('text');
  if (!sec || !stage || !video || !svg || !text) return;

  // The upright film on an upright screen, the counter film on a wide one. Picked once; poster first.
  const tall = innerHeight > innerWidth;
  const base = `${import.meta.env.BASE_URL}video/${tall ? 'puokste' : 'dirbtuve'}`;
  video.poster = `${base}.webp`;
  video.src = `${base}.mp4`;

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, ox = 0, oy = 0, zMax = 1, ready = false;

  /**
   * Size the word to the stage and find the middle of the "l" stem (drawn once on a 2D canvas: same font, same box).
   * Upright screens set the word up the side like a book spine, so it fills the height instead of a thin strip.
   */
  let spin = '';
  const layout = (): void => {
    W = stage.clientWidth;
    H = stage.clientHeight;
    if (!W || !H) return;
    const up = H > W * 1.2;
    const [fw, fh] = up ? [H, W] : [W, H]; // the word's own frame, before turning
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!c) return;
    c.font = FONT(100);
    const size = Math.min((fw * (up ? 0.86 : 0.9)) / (c.measureText(WORD).width / 100), fh * (up ? 0.8 : 0.62));
    c.canvas.width = fw;
    c.canvas.height = fh;
    c.font = FONT(size);
    const m = c.measureText(WORD);
    const left = (fw - m.width) / 2;
    const baseline = fh / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    c.fillText(WORD, left, baseline);
    const x0 = Math.floor(left + c.measureText(WORD.slice(0, STEM)).width);
    const x1 = Math.ceil(left + c.measureText(WORD.slice(0, STEM + 1)).width);
    const row = Math.round(baseline - size * 0.3);
    const px = c.getImageData(x0, row, Math.max(1, x1 - x0), 1).data;
    let best = 0, bestAt = 0, run = 0;
    for (let i = 0; i < px.length / 4; i++) {
      run = px[i * 4 + 3] > 128 ? run + 1 : 0;
      if (run > best) { best = run; bestAt = i; }
    }
    const stem = Math.max(best, size * 0.08);
    const dx = x0 + bestAt - best / 2 + 0.5 - fw / 2;
    const dy = row - fh / 2;
    // rotate(-90) takes (dx, dy) to (dy, -dx).
    [ox, oy] = up ? [W / 2 + dy, H / 2 - dx] : [W / 2 + dx, H / 2 + dy];
    // Deep enough that the stem's half-width covers the far edge of the screen across it, with room to spare.
    zMax = (2.4 * (up ? Math.max(oy, H - oy) : Math.max(ox, W - ox))) / stem;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    text.setAttribute('x', String(W / 2));
    text.setAttribute('y', String(H / 2 + baseline - fh / 2));
    text.setAttribute('font-size', String(size));
    spin = up ? ` rotate(-90 ${W / 2} ${H / 2})` : '';
    ready = true;
    shown = -1;
    draw();
  };

  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let shown = -1;
  /** 0 to 0.14 holds the word, 0.14 to 0.78 dives, the rest holds the open film. */
  const draw = (): void => {
    if (!ready) return;
    const travel = sec.offsetHeight - H;
    const p = still.matches || travel <= 0 ? 0 : clamp(-sec.getBoundingClientRect().top / travel);
    const t = ease(clamp((p - 0.14) / 0.64));
    const z = zMax ** t; // exponential: the dive reads as one steady speed
    if (z === shown) return;
    shown = z;
    text.setAttribute('transform', `translate(${ox} ${oy}) scale(${z}) translate(${-ox} ${-oy})${spin}`);
    stage.classList.toggle('is-open', t >= 1);
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
  }, { rootMargin: '50% 0px' }).observe(sec);

  new ResizeObserver(layout).observe(stage);
  still.addEventListener('change', () => { shown = -1; draw(); });
  void document.fonts.load(FONT(100), WORD).then(layout, layout);
}
