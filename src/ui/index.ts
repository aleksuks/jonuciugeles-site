import type { VarietyId, VarietyInfo } from '../types';
import './ui.css';

export interface UiOptions {
  root: HTMLElement;
  varieties: readonly VarietyInfo[];
  /** Optional: returns a thumbnail image URL or null. The integrator wires real rendered thumbnails later. Show the swatch-based fallback until it resolves. */
  thumbnail?: (variety: VarietyId, paletteIndex: number) => Promise<string | null>;
  onAdd(variety: VarietyId, paletteIndex: number): void;
  onToggleExplode(): void;
  onRemoveSelected(): void;
  onDeselect(): void;
  /** Most flowers the bouquet holds; Add is disabled at this count. The single source is Bouquet's MAX_FLOWERS. */
  maxFlowers?: number;
}

export interface UiApi {
  setExploded(on: boolean): void;
  setSelection(sel: { variety: VarietyId; label: string; paletteIndex?: number } | null): void;
  setFlowerCount(n: number): void;
  /** Rooted hint text for first-time use; dismissible by interaction. */
  dismissHint(): void;
  dispose(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | boolean | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs: Attrs = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Builds an SVG fragment from a trusted, static markup string (never user data). */
function svg(markup: string, cls?: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = markup;
  return s;
}

/** Small botanical drawings in the variety colour: the fallback until a rendered thumbnail arrives. */
function botanical(variety: VarietyId): string {
  const stem = '#6b7a52';
  const edge = 'stroke="rgba(53,51,31,.32)" stroke-width=".7"';
  const c = 'var(--fl-c)';
  switch (variety) {
    case 'rose':
      return `<path d="M30 44 C29 56 31 64 30 78" stroke="${stem}" stroke-width="2" fill="none"/>
        <ellipse cx="38" cy="62" rx="7" ry="3.2" transform="rotate(-30 38 62)" fill="${stem}"/>
        <circle cx="30" cy="31" r="17" fill="${c}" ${edge}/>
        <circle cx="30" cy="31" r="12" fill="${c}" ${edge} opacity=".85"/>
        <path d="M30 31 m-6 0 a6 6 0 1 1 6 6 a9 9 0 0 1 -9 -9 a12 12 0 0 1 12 -12" fill="none" stroke="rgba(53,51,31,.38)" stroke-width="1"/>`;
    case 'tulip':
      return `<path d="M30 46 C30 58 31 68 30 80" stroke="${stem}" stroke-width="2" fill="none"/>
        <path d="M30 60 C20 56 16 46 16 40 C22 48 28 52 30 60 Z" fill="${stem}"/>
        <path d="M16 20 C16 42 44 42 44 20 L37 27 L30 12 L23 27 Z" fill="${c}" ${edge} stroke-linejoin="round"/>
        <path d="M30 12 L30 38" stroke="rgba(53,51,31,.25)" stroke-width=".8"/>`;
    case 'daisy': {
      let petals = '';
      for (let i = 0; i < 14; i++) petals += `<ellipse cx="30" cy="16" rx="3" ry="9" transform="rotate(${(i * 360) / 14} 30 31)" fill="${c}" ${edge}/>`;
      return `<path d="M30 40 C31 56 29 66 30 80" stroke="${stem}" stroke-width="2" fill="none"/>${petals}<circle cx="30" cy="31" r="6" fill="#d6a42c"/>`;
    }
    case 'peony': {
      let ring = '';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ring += `<circle cx="${(30 + Math.cos(a) * 11).toFixed(1)}" cy="${(31 + Math.sin(a) * 11).toFixed(1)}" r="9" fill="${c}" ${edge}/>`;
      }
      return `<path d="M30 46 C29 58 31 66 30 80" stroke="${stem}" stroke-width="2" fill="none"/>${ring}
        <circle cx="30" cy="31" r="11" fill="${c}" ${edge}/><circle cx="30" cy="31" r="6.5" fill="${c}" ${edge} opacity=".8"/><circle cx="30" cy="31" r="3" fill="rgba(53,51,31,.22)"/>`;
    }
    case 'eucalyptus': {
      let leaves = '';
      for (let i = 0; i < 6; i++) {
        const y = 16 + i * 10;
        leaves += `<ellipse cx="${22 - (i % 2) * 1}" cy="${y}" rx="6.5" ry="5" transform="rotate(-20 22 ${y})" fill="${c}" ${edge}/>`;
        leaves += `<ellipse cx="${38 + (i % 2)}" cy="${y + 5}" rx="6.5" ry="5" transform="rotate(20 38 ${y + 5})" fill="${c}" ${edge}/>`;
      }
      return `<path d="M30 8 C27 30 33 52 30 80" stroke="${stem}" stroke-width="1.6" fill="none"/>${leaves}`;
    }
  }
}

const ICON_HERO = `
  <line class="fl-s1" x1="20" y1="34" x2="20" y2="8"/>
  <line class="fl-s2" x1="20" y1="34" x2="20" y2="5"/>
  <line class="fl-s3" x1="20" y1="34" x2="20" y2="3"/>
  <line class="fl-s4" x1="20" y1="34" x2="20" y2="5"/>
  <line class="fl-s5" x1="20" y1="34" x2="20" y2="8"/>
  <circle class="fl-bind" cx="20" cy="28" r="2.4"/>`;

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createUi(opts: UiOptions): UiApi {
  const { root, varieties } = opts;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const ui = el('div', 'fl-ui');
  const cleanups: Array<() => void> = [];
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };

  let exploded = false;
  let count = 0;
  let selected = false;
  const palette = new Map<VarietyId, number>();
  const thumbs = new Map<VarietyId, { box: HTMLElement; svgEl: SVGSVGElement; img: HTMLImageElement }>();
  const thumbToken = new Map<VarietyId, number>();
  const addButtons: HTMLButtonElement[] = [];

  /* ---------- catalogue ---------- */
  const catalogue = el('aside', 'fl-catalogue', { 'aria-label': 'Flower catalogue' });
  const head = el('div', 'fl-catalogue-head');
  const brandBase = import.meta.env.BASE_URL;
  const lockup = el('img', 'fl-lockup', { src: `${brandBase}brand/lockup-olive.png`, alt: 'Jonučių gėlės', width: 1438, height: 725, decoding: 'async', draggable: 'false' });
  head.append(lockup, el('h2', 'fl-title', {}, 'Choose your stems'), el('p', 'fl-lede', {}, 'Pick a colour, then add it to the bouquet.'));
  const list = el('ul', 'fl-list');

  const loadThumb = (v: VarietyInfo): void => {
    if (!opts.thumbnail) return;
    const t = thumbs.get(v.id);
    if (!t) return;
    const idx = palette.get(v.id) ?? 0;
    const token = (thumbToken.get(v.id) ?? 0) + 1;
    thumbToken.set(v.id, token);
    opts.thumbnail(v.id, idx).then((url) => {
      if (thumbToken.get(v.id) !== token || !url) return;
      t.img.onload = () => { t.img.classList.add('fl-in'); t.box.classList.add('fl-has-img'); };
      t.img.src = url;
    }, () => { /* keep the fallback */ });
  };

  const paintFallback = (v: VarietyInfo): void => {
    const t = thumbs.get(v.id);
    if (!t) return;
    const colour = v.swatches[palette.get(v.id) ?? 0] ?? '#ccc';
    t.box.style.setProperty('--fl-c', colour);
    t.img.classList.remove('fl-in');
    t.box.classList.remove('fl-has-img');
  };

  for (const v of varieties) {
    palette.set(v.id, 0);
    const li = el('li', 'fl-card');
    const box = el('div', 'fl-thumb');
    const svgEl = svg(botanical(v.id), undefined, '0 0 60 80');
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    const img = el('img', '', { alt: '', draggable: false });
    box.append(svgEl, img);
    thumbs.set(v.id, { box, svgEl, img });

    const text = el('div', 'fl-text');
    text.append(el('h3', 'fl-name', {}, v.label), el('p', 'fl-blurb', {}, v.blurb));

    const actions = el('div', 'fl-actions');
    const group = el('div', 'fl-swatches', { role: 'radiogroup', 'aria-label': `${v.label} colour` });
    const swatchBtns: HTMLButtonElement[] = [];
    v.swatches.forEach((colour, i) => {
      const b = el('button', 'fl-swatch', { type: 'button', role: 'radio', 'aria-checked': i === 0, 'aria-label': `${v.label}, colour ${i + 1} of ${v.swatches.length}` });
      b.style.setProperty('--fl-c', colour);
      b.addEventListener('click', () => {
        palette.set(v.id, i);
        swatchBtns.forEach((o, j) => o.setAttribute('aria-checked', String(j === i)));
        paintFallback(v);
        loadThumb(v);
      });
      swatchBtns.push(b);
      group.append(b);
    });

    const add = el('button', 'fl-add', { type: 'button', 'aria-label': `Add ${v.label} to the bouquet` });
    const plus = el('span', 'fl-plus');
    plus.append(svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>'), document.createTextNode('Add'));
    const added = el('span', 'fl-added', { 'aria-hidden': true });
    added.append(svg('<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>', 'fl-tick'), document.createTextNode('Added'));
    add.append(plus, added);
    addButtons.push(add);
    let resetTimer = 0;
    add.addEventListener('click', () => {
      if (add.disabled) return;
      opts.onAdd(v.id, palette.get(v.id) ?? 0);
      add.classList.add('fl-did');
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => add.classList.remove('fl-did'), 1300);
      timers.add(resetTimer);
      if (!prefersReducedMotion()) {
        box.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07) rotate(-1.5deg)' }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.34,1.56,.5,1)' });
      }
    });

    actions.append(group, add);
    li.append(box, text, actions);
    list.append(li);
    paintFallback(v);
    loadThumb(v);
  }
  catalogue.append(head, list);

  /* ---------- hero tag + selection ---------- */
  const dock = el('div', 'fl-dock');

  const sel = el('div', 'fl-sel', { role: 'group', 'aria-label': 'Selected flower', inert: true });
  const selDot = el('span', 'fl-sel-dot', { hidden: true });
  const selName = el('span', 'fl-sel-name');
  const removeBtn = el('button', 'fl-sel-btn fl-remove', { type: 'button' }, 'Remove');
  const closeBtn = el('button', 'fl-sel-btn fl-close', { type: 'button', 'aria-label': 'Deselect flower' });
  closeBtn.append(svg('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>'));
  sel.append(selDot, selName, removeBtn, closeBtn);
  removeBtn.addEventListener('click', () => opts.onRemoveSelected());
  closeBtn.addEventListener('click', () => opts.onDeselect());

  const hero = el('button', 'fl-hero', { type: 'button', 'data-exploded': 'false' });
  hero.append(svg(ICON_HERO, 'fl-hero-icon', '0 0 40 40'));
  const heroText = el('span', 'fl-hero-text');
  const lblA = el('span', 'fl-hero-label fl-l-assembled fl-l-on', { 'aria-hidden': true }, 'Unbind');
  const lblE = el('span', 'fl-hero-label fl-l-exploded fl-l-on', { 'aria-hidden': true }, 'Tie together');
  const countEl = el('span', 'fl-hero-count');
  const countNum = el('span', '', {}, '0');
  const countWord = el('span', '', {}, ' stems');
  countEl.append(countNum, countWord);
  const stack = el('span', '', { style: 'display:grid' });
  const row = el('span', 'fl-hero-text');
  row.append(lblA, lblE);
  stack.append(row, countEl);
  heroText.append(stack);
  hero.append(heroText);
  hero.addEventListener('click', () => opts.onToggleExplode());
  dock.append(sel, hero);

  const syncHero = (): void => {
    hero.dataset.exploded = String(exploded);
    hero.setAttribute('aria-label', `${exploded ? 'Tie the bouquet together' : 'Unbind the bouquet'}, ${count} ${count === 1 ? 'stem' : 'stems'}`);
  };

  /* ---------- hint ---------- */
  const hint = el('p', 'fl-hint', { role: 'status' });
  hint.textContent = coarse
    ? 'Drag empty space to turn. Tap and hold a flower to move it, tap to select.'
    : 'Drag empty space to turn. Click and hold a flower to move it, click to select.';

  const note = el('p', 'fl-note', { role: 'status' });
  note.textContent = 'The bouquet is full. Take a stem out to make room for another.';
  note.hidden = true;
  /* Small brand mark for the narrow layout (the catalogue head, with the lockup, is hidden there). */
  const brandMark = el('img', 'fl-brandmark', { src: `${brandBase}brand/mark-olive.png`, alt: 'Jonučių gėlės', width: 302, height: 349, decoding: 'async', draggable: 'false' });
  ui.append(hint, note, brandMark, catalogue, dock);
  root.append(ui);
  syncHero();

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && selected) opts.onDeselect();
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  /* ---------- api ---------- */
  let hintGone = false;
  const dismissHint = (): void => {
    if (hintGone) return;
    hintGone = true;
    hint.classList.add('fl-gone');
    later(() => hint.remove(), 900);
  };

  return {
    setExploded(on) {
      if (exploded === on) return;
      exploded = on;
      syncHero();
    },
    setSelection(s) {
      selected = s !== null;
      if (s) {
        selName.textContent = s.label;
        const info = varieties.find((v) => v.id === s.variety);
        const colour = s.paletteIndex !== undefined ? info?.swatches[s.paletteIndex] : undefined;
        selDot.hidden = !colour;
        if (colour) selDot.style.setProperty('--fl-c', colour);
        removeBtn.setAttribute('aria-label', `Remove ${s.label}`);
        sel.removeAttribute('inert');
        sel.classList.add('fl-open'); ui.classList.add('fl-has-sel');
        dismissHint();
      } else {
        sel.classList.remove('fl-open'); ui.classList.remove('fl-has-sel');
        sel.setAttribute('inert', '');
      }
    },
    setFlowerCount(n) {
      const changed = n !== count;
      count = n;
      countNum.textContent = String(n);
      countWord.textContent = n === 1 ? ' stem' : ' stems';
      syncHero();
      const full = opts.maxFlowers !== undefined && n >= opts.maxFlowers;
      for (const b of addButtons) { b.disabled = full; b.setAttribute('aria-disabled', String(full)); }
      note.hidden = !full;
      if (changed && !prefersReducedMotion()) {
        countNum.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)', opacity: 0.4 }, { transform: 'translateY(0)' }], { duration: 360, easing: 'ease-out' });
      }
    },
    dismissHint,
    dispose() {
      cleanups.forEach((fn) => fn());
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      ui.remove();
    },
  };
}
