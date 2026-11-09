import { connected, readForm, send, validate, type Errors } from './inquiry';

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

  openNow();
  actionBar();
  orderForm(h, (b) => { breathing = b; h.loosen(b); });
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
