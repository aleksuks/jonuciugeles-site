/**
 * The shop's rose mark over its film. The section is one screen tall and simply scrolls by (nothing pins), so one swipe
 * carries a phone straight through. The film fills the section from the start; over it sits the wine disc of the
 * logo, and as the section rises the rose's line draws itself as a cut through the disc (wine where the stem leaves
 * it). By the time the section fills the screen the mark has come at the visitor and they have gone through the line
 * into the film. The film itself (play while on screen, pause button) is handled by shopVideo() in page.ts.
 *
 * The rose path in index.html (#reel-rose) was traced from public/brand/lockup-olive.png, drawn from the hook to the
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
  const svg = sec?.querySelector('svg');
  const mark = svg?.querySelector<SVGGElement>('.reel__mark');
  if (!sec || !stage || !video || !svg || !mark) return;

  // The upright film on an upright screen, the counter film on a wide one. Picked once; poster first.
  const base = `${import.meta.env.BASE_URL}video/${innerHeight > innerWidth ? 'puokste' : 'dirbtuve'}`;
  video.poster = `${base}.webp`;
  video.src = `${base}.mp4`;

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const nav = document.querySelector<HTMLElement>('.nav');
  let W = 0, H = 0, k = 1, zMax = 1;
  let shown = '';

  const layout = (): void => {
    W = stage.clientWidth;
    H = stage.clientHeight;
    if (!W || !H) return;
    k = Math.min(W * 0.56, H * 0.46) / (2 * R);
    // Deep enough that the line's half-width covers the whole screen from wherever it sits.
    zMax = (2.2 * Math.hypot(W, H)) / (LINE * k);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    shown = '';
    draw();
  };

  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  /** p runs 0 to 1 while the section rises from the bottom of the screen to just under the nav. */
  const draw = (): void => {
    if (!W) return;
    const top = sec.getBoundingClientRect().top;
    const navH = nav?.offsetHeight ?? 0;
    const p = clamp((innerHeight - top) / (innerHeight - navH));
    const drawn = still.matches ? 1 : smooth(clamp((p - 0.12) / 0.56));
    const dive = still.matches ? 0 : clamp((p - 0.64) / 0.34); // done a hair before p = 1, which scroll rounding can miss
    // The mark rides the middle of the part of the section on screen, kept whole inside the section.
    const markH = (BOTTOM - TOP) * k;
    const seen = (Math.max(0, navH - top) + Math.min(H, innerHeight - top)) / 2;
    const mid = still.matches ? H / 2 : Math.min(H - markH / 2 - PAD, Math.max(markH / 2 + PAD, seen));
    const cx = W / 2;
    const cy = mid - ((TOP + BOTTOM) / 2) * k;
    const z = zMax ** (dive * dive); // starts gently, then the exponential carries it through the line
    const sx = cx + DIVE[0] * k;
    const sy = cy + DIVE[1] * k;
    const t = `translate(${sx} ${sy}) scale(${z}) translate(${-sx} ${-sy}) translate(${cx} ${cy}) scale(${k})`;
    const key = `${t}|${drawn}`;
    if (key === shown) return;
    shown = key;
    mark.setAttribute('transform', t);
    mark.style.strokeDashoffset = String((1 - drawn) * 1.002); // just past the start, so no round cap shows at 0
    stage.classList.toggle('is-open', dive >= 1);
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
