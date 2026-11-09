import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, Texture } from 'three';
import { mulberry32 } from './rng';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('flowers: 2d canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, amount: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

let petal: Texture | null = null;
let leaf: Texture | null = null;
let silk: Texture | null = null;

/** Fine longitudinal veins fanning out from the petal base, as a bump map (u across, v along). */
export function petalVeinTexture(): Texture {
  if (petal) return petal;
  const w = 128;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  const rnd = mulberry32(4242);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  ctx.filter = 'blur(0.7px)';
  for (let i = 0; i < 46; i++) {
    const x1 = rnd() * w;
    const x0 = w / 2 + (x1 - w / 2) * (0.25 + rnd() * 0.25);
    const y1 = h * (0.55 + rnd() * 0.45);
    ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '40,40,40' : '200,200,200'},${0.22 + rnd() * 0.3})`;
    ctx.lineWidth = 0.9 + rnd() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 6, y1 * 0.5, x1, y1);
    ctx.stroke();
  }
  ctx.filter = 'none';
  speckle(ctx, w, h, rnd, 26);
  petal = finish(c);
  return petal;
}

/** Silky, crinkled fine grain for tulip tepals and daisy rays. */
export function silkTexture(): Texture {
  if (silk) return silk;
  const w = 64;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  const rnd = mulberry32(777);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) {
    const x = rnd() * w;
    ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '30,30,30' : '220,220,220'},${0.2 + rnd() * 0.25})`;
    ctx.lineWidth = 0.7 + rnd();
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rnd() - 0.5) * 5, h * (0.6 + rnd() * 0.4));
    ctx.stroke();
  }
  speckle(ctx, w, h, rnd, 14);
  silk = finish(c);
  return silk;
}

/** Midrib plus pinnate side veins for leaves. */
export function leafVeinTexture(): Texture {
  if (leaf) return leaf;
  const w = 128;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  const rnd = mulberry32(99);
  ctx.fillStyle = '#909090';
  ctx.fillRect(0, 0, w, h);
  ctx.filter = 'blur(0.8px)';
  ctx.strokeStyle = 'rgba(20,20,20,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  for (let y = 12; y < h; y += 17 + rnd() * 5) {
    for (const s of [-1, 1]) {
      ctx.strokeStyle = 'rgba(30,30,30,0.5)';
      ctx.beginPath();
      ctx.moveTo(w / 2, y);
      ctx.quadraticCurveTo(w / 2 + s * 24, y + 14, w / 2 + s * 52, y + 38);
      ctx.stroke();
    }
  }
  ctx.filter = 'none';
  speckle(ctx, w, h, rnd, 22);
  leaf = finish(c);
  return leaf;
}
