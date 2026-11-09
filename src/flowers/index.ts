import {
  BufferGeometry,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { FlowerVisual, VarietyId, VarietyInfo } from '../types';
import { buildDaisy } from './daisy';
import { buildEucalyptus } from './eucalyptus';
import type { Bloom } from './leaves';
import { foliageMaterial, matteMaterial, petalMaterial, stemMaterial } from './materials';
import type { MatPair } from './materials';
import { PALETTES } from './palettes';
import { triCount } from './petal';
import { buildPeony } from './peony';
import { buildRose } from './rose';
import { stemGeometry } from './stem';
import { buildTulip } from './tulip';

export const VARIETIES: readonly VarietyInfo[] = [
  { id: 'rose', label: 'Rose', blurb: 'Tight spiral heart, softly rolled petals.', swatches: PALETTES.rose.map((p) => p.swatch) },
  { id: 'tulip', label: 'Tulip', blurb: 'Six smooth petals closed into a goblet.', swatches: PALETTES.tulip.map((p) => p.swatch) },
  { id: 'daisy', label: 'Daisy', blurb: 'Bright white rays around a golden dome.', swatches: PALETTES.daisy.map((p) => p.swatch) },
  { id: 'peony', label: 'Peony', blurb: 'Lush, ruffled and layered to the heart.', swatches: PALETTES.peony.map((p) => p.swatch) },
  { id: 'eucalyptus', label: 'Eucalyptus', blurb: 'Silvery round leaves on a branching spray.', swatches: PALETTES.eucalyptus.map((p) => p.swatch) },
];

const VARIANTS = 3;
const BUILDERS: Record<VarietyId, (variant: number) => Bloom> = {
  rose: buildRose,
  tulip: buildTulip,
  daisy: buildDaisy,
  peony: buildPeony,
  eucalyptus: buildEucalyptus,
};

const bloomCache = new Map<string, Bloom>();
function getBloom(variety: VarietyId, variant: number): Bloom {
  const key = `${variety}:${variant}`;
  let b = bloomCache.get(key);
  if (!b) {
    b = BUILDERS[variety](variant);
    bloomCache.set(key, b);
  }
  return b;
}

/** Triangle counts for one variant of a variety (bloom = petals + centre, foliage = leaves/sepals, stem). */
export function triangleReport(variety: VarietyId, variant = 0): { bloom: number; foliage: number; stem: number; total: number } {
  const b = getBloom(variety, variant);
  const bloom = triCount(b.petals) + (b.centre ? triCount(b.centre) : 0);
  const foliage = b.foliage ? triCount(b.foliage) : 0;
  const stem = triCount(stemGeometry(variety));
  return { bloom, foliage, stem, total: bloom + foliage + stem };
}

// Pick proxies: shared geometry, one shared invisible material.
const pickMat = new MeshBasicMaterial({ visible: false });
const sphereCache = new Map<number, BufferGeometry>();
function pickSphere(r: number): BufferGeometry {
  let g = sphereCache.get(r);
  if (!g) {
    g = new SphereGeometry(r, 10, 8);
    sphereCache.set(r, g);
  }
  return g;
}
let stemProxyGeo: BufferGeometry | null = null;
function stemProxy(): BufferGeometry {
  if (!stemProxyGeo) {
    stemProxyGeo = new CylinderGeometry(0.026, 0.026, 1, 8, 1);
    stemProxyGeo.translate(0, 0.5, 0);
  }
  return stemProxyGeo;
}

interface Part {
  mesh: Mesh;
  mats: MatPair;
}

const Y = new Vector3(0, 1, 0);
const _dir = new Vector3();
const _q = new Quaternion();
const _qr = new Quaternion();

function shadowed(m: Mesh): Mesh {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createFlower(variety: VarietyId, opts: { paletteIndex: number; seed: number }): FlowerVisual {
  const palettes = PALETTES[variety];
  const pIndex = ((Math.floor(opts.paletteIndex) % palettes.length) + palettes.length) % palettes.length;
  const seed = Math.floor(opts.seed);
  const variant = ((seed % VARIANTS) + VARIANTS) % VARIANTS;
  const bloom = getBloom(variety, variant);
  const bowAngle = (Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1) * Math.PI * 2;

  const object = new Group();
  object.name = `flower-${variety}`;
  const stemGroup = new Group();
  const headGroup = new Group();
  object.add(stemGroup, headGroup);

  const parts: Part[] = [];
  const addPart = (parent: Group, geo: BufferGeometry, mats: MatPair): Mesh => {
    const m = shadowed(new Mesh(geo, mats.base));
    parent.add(m);
    parts.push({ mesh: m, mats });
    return m;
  };

  const stemMesh = addPart(stemGroup, stemGeometry(variety), stemMaterial(variety));
  stemMesh.rotation.y = bowAngle;
  addPart(headGroup, bloom.petals, petalMaterial(variety, pIndex, palettes[pIndex]));
  if (bloom.foliage) addPart(headGroup, bloom.foliage, foliageMaterial());
  if (bloom.centre) addPart(headGroup, bloom.centre, matteMaterial());

  const bloomPick = new Mesh(pickSphere(bloom.pickRadius), pickMat);
  bloomPick.position.y = bloom.pickY;
  const stemPick = new Mesh(stemProxy(), pickMat);
  for (const m of [bloomPick, stemPick]) {
    m.visible = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.name = 'pick';
  }
  headGroup.add(bloomPick);
  stemGroup.add(stemPick);

  let highlighted = false;

  return {
    object,
    variety,
    pickTargets: [bloomPick, stemPick],
    setPose(root, head, roll) {
      _dir.subVectors(head, root);
      const len = _dir.length();
      if (len < 1e-5) return;
      _dir.multiplyScalar(1 / len);
      _q.setFromUnitVectors(Y, _dir);
      stemGroup.position.copy(root);
      stemGroup.quaternion.copy(_q);
      stemGroup.scale.set(1, len, 1); // non-uniform along the stem axis only; children inherit it
      headGroup.position.copy(head);
      _qr.setFromAxisAngle(Y, roll);
      headGroup.quaternion.copy(_q).multiply(_qr);
      stemGroup.matrixWorldNeedsUpdate = true;
    },
    setHighlighted(on) {
      if (on === highlighted) return;
      highlighted = on;
      for (const p of parts) p.mesh.material = (on ? p.mats.hi : p.mats.base) as Material;
    },
    dispose() {
      // geometry and materials are shared; only detach
      object.removeFromParent();
    },
  };
}
