import { connected, readForm, send, validate, type Errors } from './inquiry';
import { loadReviews } from './reviews';

interface Hooks {
  loosen(amount: number): void;
  spin(): void;
  flourish(): void;
}


const PHONE = '+370 667 06022';

export function initSite(h: Hooks): void {
  // Buttons and links nudge the bouquet.
  let breathing = 0;
  for (const el of document.querySelectorAll<HTMLElement>('[data-bouquet="loosen"]')) {
    const on = (): void => h.loosen(0.22);
    const off = (): void => h.loosen(breathing);
    el.addEventListener('pointerenter', on);
    el.addEventListener('pointerleave', off);
    el.addEventListener('focus', on);
    el.addEventListener('blur', off);
  }
  for (const el of document.querySelectorAll('[data-bouquet="spin"]')) el.addEventListener('click', () => h.spin());

  const nav = document.querySelector('.nav');
  const onScroll = (): void => { nav?.classList.toggle('is-scrolled', scrollY > 8); };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  gallery();
  shopVideo();
  openNow();
  void loadReviews();
  actionBar();
  orderForm(h, (b) => { breathing = b; h.loosen(b); });
}

/**
 * The shop's films in "Mes esame". A film downloads and plays only while it is on screen and stops when it leaves;
 * its button pauses it for good. Reduced motion or data saver: the poster stands until the visitor presses play.
 */
function shopVideo(): void {
  filmPick();
  const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches
    || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.target as HTMLElement).dispatchEvent(new CustomEvent('film:view', { detail: e.isIntersecting }));
  }, { threshold: 0.35 });

  for (const film of document.querySelectorAll<HTMLElement>('[data-film]')) {
    const video = film.querySelector('video');
    const toggle = film.querySelector('button');
    if (!video || !toggle) continue;
    let wanted = !quiet; // does the visitor want it running while on screen
    let inView = false;
    const sync = (): void => {
      if (wanted && inView) void video.play().catch(() => { /* autoplay refused: the poster and the play button stay */ });
      else video.pause();
    };
    const show = (): void => {
      const on = !video.paused;
      film.classList.toggle('is-playing', on);
      toggle.setAttribute('aria-label', on ? 'Sustabdyti filmą' : 'Leisti filmą');
    };
    video.addEventListener('play', show);
    video.addEventListener('pause', show);
    toggle.addEventListener('click', () => { wanted = video.paused; sync(); });
    // A film whose layout is not chosen has no box, so it never intersects and never downloads.
    film.addEventListener('film:view', (e) => { inView = (e as CustomEvent<boolean>).detail; sync(); });
    io.observe(film);
  }
}

/** Review-only: the links beside the heading move the film (also ?video=); the choice is kept in this browser. */
function filmPick(): void {
  const pick = document.querySelector<HTMLElement>('[data-film-pick]');
  if (!pick) return;
  const buttons = [...pick.querySelectorAll('button')];
  const set = (v: string | null): void => {
    if (!buttons.some((b) => b.value === v)) return;
    document.documentElement.dataset.video = v!;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.value === v));
  };
  let saved: string | null = null;
  try { saved = localStorage.getItem('film'); } catch { /* storage blocked */ }
  set(document.documentElement.dataset.video ?? null);
  set(saved);
  set(new URLSearchParams(location.search).get('video'));
  for (const b of buttons) {
    b.addEventListener('click', () => {
      set(b.value);
      try { localStorage.setItem('film', b.value); } catch { /* storage blocked */ }
    });
  }
}

/** Photo wall: first 12 shown, the rest on request; a photo opens large in a dialog. */
function gallery(): void {
  const wall = document.querySelector<HTMLElement>('[data-wall]');
  const more = document.querySelector<HTMLButtonElement>('[data-wall-more]');
  const box = document.querySelector<HTMLDialogElement>('.lightbox');
  if (!wall || !box) return;
  more?.addEventListener('click', () => {
    wall.classList.add('is-open');
    more.remove();
  });
  const big = box.querySelector('img');
  wall.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a');
    if (!a || !big) return;
    e.preventDefault();
    const img = a.querySelector('img');
    big.src = a.href;
    big.alt = img?.alt ?? '';
    box.showModal();
  });
  box.addEventListener('click', () => box.close());
}

/** Today's hours row, and whether the shop is open right now (Vilnius time). */
function openNow(): void {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const row = [...document.querySelectorAll<HTMLElement>('.hours tr')].find((r) => r.dataset.days?.split(' ').includes(String(day)));
  const line = document.querySelector<HTMLElement>('[data-open-now]');
  if (!row || !line) return;
  row.classList.add('is-today');
  const [from, to] = (row.querySelector('td')?.textContent ?? '').split('–').map((t) => {
    const [hh, mm] = t.split(':').map(Number);
    return hh * 60 + mm;
  });
  const open = mins >= from && mins < to;
  line.textContent = open ? `Atidaryta iki ${row.querySelector('td')?.textContent?.split('–')[1]}` : 'Šiuo metu uždaryta';
  line.classList.toggle('is-open', open);
}

/** Phone bar: once the hero button has scrolled away, and not over the form or footer. */
function actionBar(): void {
  const bar = document.querySelector('.bar');
  const watch = ['#hero-cta', '#uzsakymas', '.foot'].map((s) => document.querySelector(s)).filter((e): e is Element => !!e);
  if (!bar || !watch.length) return;
  const seen = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target));
    bar.classList.toggle('is-on', seen.size === 0);
  });
  watch.forEach((el) => io.observe(el));
}

function orderForm(h: Hooks, breathe: (b: number) => void): void {
  const form = document.getElementById('order-form') as HTMLFormElement | null;
  if (!form) return;
  const status = form.querySelector<HTMLElement>('.form__status');
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  const address = document.getElementById('address-field');
  const fieldIds: Record<string, string> = { name: 'f-name', phone: 'f-phone', email: 'f-email', needed_by: 'f-when', address: 'f-address', message: 'f-message' };

  form.addEventListener('focusin', () => breathe(0.1));
  form.addEventListener('focusout', (e) => { if (!form.contains(e.relatedTarget as Node)) breathe(0); });
  form.addEventListener('change', () => {
    if (address) address.hidden = (new FormData(form).get('delivery')) !== 'yes';
  });

  const say = (text: string, error = false): void => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };
  const showErrors = (errs: Errors): void => {
    for (const [key, id] of Object.entries(fieldIds)) {
      const input = document.getElementById(id);
      const msg = document.getElementById(`${id}-err`);
      const text = errs[key as keyof Errors] ?? '';
      if (msg) msg.textContent = text;
      if (input) {
        input.setAttribute('aria-invalid', text ? 'true' : 'false');
        if (text) input.setAttribute('aria-describedby', `${id}-err`);
        else input.removeAttribute('aria-describedby');
      }
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (new FormData(form).get('website')) return;
    const inquiry = readForm(form);
    const errs = validate(inquiry);
    showErrors(errs);
    const first = Object.keys(fieldIds).find((k) => errs[k as keyof Errors]);
    if (first) {
      say('');
      document.getElementById(fieldIds[first])?.focus();
      return;
    }
    if (!connected) {
      say(`Forma dar neprijungta. Skambinkite ${PHONE}.`, true);
      return;
    }
    if (button) { button.disabled = true; button.textContent = 'Siunčiama…'; }
    say('');
    try {
      await send(inquiry);
      form.reset();
      if (address) address.hidden = true;
      say('Užsakymas išsiųstas. Susisieksime.');
      h.flourish();
    } catch {
      say(`Nepavyko išsiųsti. Bandykite dar kartą arba skambinkite ${PHONE}.`, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Siųsti užsakymą'; }
    }
  });
}
