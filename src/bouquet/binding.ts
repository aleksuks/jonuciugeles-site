import {
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mulberry32 } from './spring';

export interface Binding {
  readonly object: Group;
  /** 0 = bouquet assembled (twine visible), 1 = fully exploded (twine gone). Smooth in between. */
  setProgress(p: number): void;
  dispose(): void;
}

/** Raffia fibres: fine lengthwise streaks of slightly different tan, so the band reads as natural twine, not plastic. */
function fibreTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const rnd = mulberry32(7);
    g.fillStyle = '#d6c093';
    g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      const l = 0.78 + rnd() * 0.3;
      g.fillStyle = `rgba(${Math.round(255 * l * 0.9)},${Math.round(225 * l * 0.9)},${Math.round(170 * l * 0.85)},${0.35 + rnd() * 0.4})`;
      g.fillRect(0, y, c.width, 1 + (rnd() < 0.3 ? 1 : 0));
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A small raffia band wound around the stems where they cross, with a knot and two short tails.
 * Generated geometry, one shared matte material. Origin is the binding point.
 */
export function createBinding(opts: { radius?: number; height?: number } = {}): Binding {
  const R = opts.radius ?? 0.034;
  const H = opts.height ?? 0.06;
  const rnd = mulberry32(11);
  const object = new Group();
  object.name = 'binding';

  const tex = fibreTexture();
  tex.repeat.set(10, 1);
  const material = new MeshStandardMaterial({
    color: new Color('#e2cfa4'),
    map: tex,
    roughness: 0.96,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  const geos: BufferGeometry[] = [];
  const add = (g: BufferGeometry): Mesh => {
    geos.push(g);
    const m = new Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    object.add(m);
    return m;
  };

  // Five-and-a-half wraps, slightly uneven, climbing the bundle.
  const turns = 5.5;
  const pts: Vector3[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const r = R * (1 + 0.05 * Math.sin(a * 0.7) + (rnd() - 0.5) * 0.04);
    pts.push(new Vector3(Math.cos(a) * r, (t - 0.5) * H + Math.sin(a * 2.0) * 0.0015, Math.sin(a) * r));
  }
  const band = add(new TubeGeometry(new CatmullRomCurve3(pts), 220, 0.0042, 6, false));
  band.name = 'wraps';

  // Knot at the front of the last wrap.
  const endA = turns * Math.PI * 2;
  const kx = Math.cos(endA) * R;
  const kz = Math.sin(endA) * R;
  const ky = H / 2;
  const knot = add(new SphereGeometry(0.0085, 12, 8));
  knot.position.set(kx * 1.05, ky, kz * 1.05);
  knot.scale.set(1.15, 0.8, 1);
  knot.name = 'knot';

  // Two tails hanging from the knot, one longer, each drooping and splaying a little.
  const out = new Vector3(Math.cos(endA), 0, Math.sin(endA));
  const side = new Vector3(-out.z, 0, out.x);
  const tail = (len: number, splay: number): void => {
    const p0 = new Vector3(kx, ky, kz).multiplyScalar(1.04);
    const c: Vector3[] = [
      p0.clone(),
      p0.clone().addScaledVector(out, 0.008).addScaledVector(side, splay * 0.3).add(new Vector3(0, -len * 0.35, 0)),
      p0.clone().addScaledVector(out, 0.016).addScaledVector(side, splay * 0.7).add(new Vector3(0, -len * 0.7, 0)),
      p0.clone().addScaledVector(out, 0.012).addScaledVector(side, splay).add(new Vector3(0, -len, 0)),
    ];
    add(new TubeGeometry(new CatmullRomCurve3(c), 20, 0.0034, 5, false));
  };
  tail(0.07, 0.014);
  tail(0.045, -0.012);

  return {
    object,
    setProgress(p: number): void {
      const x = Math.min(1, Math.max(0, (p - 0.1) / 0.5)); // stays tied until the stems start to splay
      const s = 1 - x * x * (3 - 2 * x);
      object.visible = s > 0.003;
      object.scale.setScalar(Math.max(s, 1e-3));
      object.rotation.y = x * 1.4; // loosens as it shrinks
    },
    dispose(): void {
      for (const g of geos) g.dispose();
      material.dispose();
      tex.dispose();
      object.removeFromParent();
    },
  };
}
