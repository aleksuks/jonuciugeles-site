import { Color, DoubleSide, FrontSide, Material, MeshPhysicalMaterial, ShaderChunk, Texture } from 'three';
import { leafVeinTexture, petalVeinTexture, silkTexture } from './textures';
import type { VarietyId } from '../types';

export interface MatPair {
  base: Material;
  hi: Material;
}

export interface Palette {
  name: string;
  /** Deep colour near the petal base / flower heart. */
  base: string;
  /** Colour toward the petal tips. */
  tip: string;
  /** Edge, flame or blush accent. */
  accent: string;
  accentAmt: number;
  /** CSS swatch shown in the catalogue (a blend of what is actually visible). */
  swatch: string;
}

interface PetalLook {
  roughness: number;
  sheen: number;
  sheenRoughness: number;
  specular: number;
  trans: number;
  bump: () => Texture;
  bumpScale: number;
}

export const LOOKS: Record<VarietyId, PetalLook> = {
  rose: { roughness: 0.66, sheen: 0.6, sheenRoughness: 0.5, specular: 0.25, trans: 0.5, bump: petalVeinTexture, bumpScale: 1.4 },
  peony: { roughness: 0.7, sheen: 0.6, sheenRoughness: 0.55, specular: 0.2, trans: 0.5, bump: petalVeinTexture, bumpScale: 1.1 },
  tulip: { roughness: 0.55, sheen: 0.8, sheenRoughness: 0.35, specular: 0.35, trans: 0.5, bump: silkTexture, bumpScale: 1.0 },
  daisy: { roughness: 0.62, sheen: 0.6, sheenRoughness: 0.5, specular: 0.2, trans: 0.95, bump: silkTexture, bumpScale: 1.2 },
  eucalyptus: { roughness: 0.5, sheen: 0.9, sheenRoughness: 0.6, specular: 0.3, trans: 0.2, bump: leafVeinTexture, bumpScale: 1.2 },
};

const HI_WARM = new Color('#ffb48a');

interface PatchOpts {
  palette?: { base: Color; tip: Color; accent: Color; accentAmt: number };
  trans: number;
  hi: number;
}

/**
 * Patches a MeshPhysicalMaterial with: (1) palette mapping of the vertex colour channels, (2) a cheap back-light
 * transmission term toward the first directional light (the key), (3) a soft warm lift + rim for selection.
 * Programs are shared between materials (same cache key), only uniform values differ.
 */
function patch(mat: MeshPhysicalMaterial, o: PatchOpts): void {
  const u = {
    uBase: { value: o.palette?.base ?? new Color() },
    uTip: { value: o.palette?.tip ?? new Color() },
    uAccent: { value: o.palette?.accent ?? new Color() },
    uAccentAmt: { value: o.palette?.accentAmt ?? 0 },
    uTrans: { value: o.trans },
    uHi: { value: o.hi },
    uHiColor: { value: HI_WARM },
  };
  const usePal = !!o.palette;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    let f = shader.fragmentShader;
    f = f.replace(
      '#include <common>',
      `#include <common>
      uniform vec3 uBase; uniform vec3 uTip; uniform vec3 uAccent; uniform float uAccentAmt;
      uniform float uTrans; uniform float uHi; uniform vec3 uHiColor;`,
    );
    if (usePal) {
      f = f.replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
          vec3 petalCol = mix(mix(uBase, uTip, vColor.r), uAccent, vColor.b * uAccentAmt);
          petalCol = pow(petalCol, vec3(1.3));
          diffuseColor.rgb *= petalCol * vColor.g;
        #endif`,
      );
    }
    f = f.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += uHi * (diffuseColor.rgb * 0.16 + uHiColor * (0.035 + 0.22 * rimF));
      }`,
    );
    f = f.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
      if (uTrans > 0.0) {
        vec3 Lk = directionalLights[0].direction;
        vec3 Vk = normalize(vViewPosition);
        float behind = clamp(-dot(normal, Lk), 0.0, 1.0);
        float toward = pow(clamp(dot(Vk, -Lk), 0.0, 1.0), 2.0);
        float glow = behind * (0.25 + 0.45 * toward);
        // thin tissue: tint toward a warmer, more saturated version of its own colour
        vec3 tc = diffuseColor.rgb * mix(vec3(1.0), vec3(1.25, 1.0, 0.85), 0.5);
        reflectedLight.directDiffuse += uTrans * glow * tc * directionalLights[0].color * 0.3;
      }
      #endif`,
    );
    // Self-shadowing between crowded thin petals is noisy with VSM and far too dark; keep only part of it.
    f = f.replace(
      '#include <lights_fragment_begin>',
      ShaderChunk.lights_fragment_begin.replace(
        /getShadow\( directionalShadowMap\[ i \]([^;]*?)\) : 1\.0;/,
        'mix( 1.0, getShadow( directionalShadowMap[ i ]$1), 0.7 ) : 1.0;',
      ),
    );
    shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => `flowerpatch-${usePal ? 'pal' : 'plain'}`;
}

function make(
  params: ConstructorParameters<typeof MeshPhysicalMaterial>[0],
  o: Omit<PatchOpts, 'hi'>,
): MatPair {
  const mk = (hi: number): MeshPhysicalMaterial => {
    const m = new MeshPhysicalMaterial(params);
    patch(m, { ...o, hi });
    return m;
  };
  return { base: mk(0), hi: mk(1) };
}

const petalCache = new Map<string, MatPair>();

export function petalMaterial(variety: VarietyId, index: number, palette: Palette): MatPair {
  const key = `${variety}:${index}`;
  const hit = petalCache.get(key);
  if (hit) return hit;
  const look = LOOKS[variety];
  const tip = new Color(palette.tip);
  const pair = make(
    {
      vertexColors: true,
      side: DoubleSide,
      roughness: look.roughness,
      metalness: 0,
      sheen: look.sheen,
      sheenRoughness: look.sheenRoughness,
      sheenColor: tip.clone().lerp(new Color('#ffffff'), 0.12),
      specularIntensity: look.specular,
      ior: 1.4,
      bumpMap: look.bump(),
      bumpScale: look.bumpScale,
    },
    {
      palette: { base: new Color(palette.base), tip, accent: new Color(palette.accent), accentAmt: palette.accentAmt },
      trans: look.trans,
    },
  );
  petalCache.set(key, pair);
  return pair;
}

let foliage: MatPair | null = null;
/** Shared green material for leaves and sepals; colour comes straight from vertex colours. */
export function foliageMaterial(): MatPair {
  if (foliage) return foliage;
  foliage = make(
    {
      vertexColors: true, side: DoubleSide, roughness: 0.58, metalness: 0, sheen: 0.6, sheenRoughness: 0.55,
      sheenColor: new Color('#cfe3b0'), specularIntensity: 0.3, bumpMap: leafVeinTexture(), bumpScale: 1.5,
    },
    { trans: 0.7 },
  );
  return foliage;
}

const stemCache = new Map<string, MatPair>();
export function stemMaterial(variety: VarietyId): MatPair {
  const hit = stemCache.get(variety);
  if (hit) return hit;
  const pair = make(
    { vertexColors: true, side: FrontSide, roughness: 0.62, metalness: 0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new Color('#dfeccc'), specularIntensity: 0.3 },
    { trans: 0 },
  );
  stemCache.set(variety, pair);
  return pair;
}

let matte: MatPair | null = null;
/** Daisy centre: rough, matte, vertex coloured. */
export function matteMaterial(): MatPair {
  if (matte) return matte;
  matte = make(
    { vertexColors: true, side: FrontSide, roughness: 0.9, metalness: 0, sheen: 0.3, sheenRoughness: 0.8, specularIntensity: 0.15 },
    { trans: 0 },
  );
  return matte;
}
