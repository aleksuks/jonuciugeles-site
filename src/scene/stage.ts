import {
  ACESFilmicToneMapping,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { QualityTier } from '../types';
import { SLOW_FRAME_MS, initialTier } from './tier';

// 512x256 (downsampled from the 1k original): petals are rough, so the smaller file lights the same and loads 3x faster.
export const HDRI_FILE = 'hdri/studio_small_09_512.hdr';

const TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

interface TierSettings {
  maxPixelRatio: number;
  shadowMapSize: number;
  shadowBlurSamples: number;
  composer: boolean;
  ao: boolean;
  aoScale: number; // fraction of full resolution for the AO pass
  dof: boolean;
  msaa: number;
}

const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  high: { maxPixelRatio: 2, shadowMapSize: 2048, shadowBlurSamples: 20, composer: true, ao: true, aoScale: 1, dof: true, msaa: 4 },
  // Medium (phones start here) renders straight to the canvas: the AO/MSAA post chain was what made phones lag.
  medium: { maxPixelRatio: 1.5, shadowMapSize: 1024, shadowBlurSamples: 10, composer: false, ao: false, aoScale: 1, dof: false, msaa: 0 },
  low: { maxPixelRatio: 1, shadowMapSize: 1024, shadowBlurSamples: 12, composer: false, ao: false, aoScale: 1, dof: false, msaa: 0 },
};

/** Frame-time governor: downgrade when the smoothed frame time stays above this for DOWNGRADE_AFTER_S. */
const DOWNGRADE_AFTER_S = 2.5;
const WARMUP_S = 2;
/**
 * Only true stalls are discarded: a frame that spans a hidden tab, or one longer than this. A device whose
 * real frames take 300 ms or 2 s must still count, or it could never be downgraded.
 */
const STALL_MS = 8000;
/** The first frames after startup or a tier change compile shaders and build targets; they say nothing about steady state. */
const SETTLE_FRAMES = 3;

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Current tier. */
  readonly quality: QualityTier;
  /** True when ?quality= pinned the tier, which disables automatic downgrade. */
  readonly qualityForced: boolean;
  /** Resolves when the HDRI (or the RoomEnvironment fallback) is applied. */
  readonly ready: Promise<void>;
  /** 'hdri' once the bundled file loaded, 'room' if the fallback is in use, 'none' while loading. */
  readonly environment: 'hdri' | 'room' | 'none';
  /** Frame counters for tests and debugging. */
  readonly stats: { frames: number; frameMs: number; downgrades: number; samples: number };
  /** The key light, so other modules can aim or tune it. */
  readonly keyLight: DirectionalLight;
  render(): void;
  /** The backdrop colour as it reached the screen (tone mapping included), read from the canvas corner right after a render. */
  sampleBackdrop(): string;
  /** Backdrop colour fed to the shader (linear, before tone mapping). */
  readonly backdrop: Color;
  setBackdrop(c: Color): void;
  setQuality(tier: QualityTier): void;
  /** Debug: switch the AO pass or the key light's shadow on or off independently of the tier. */
  debugToggle(what: 'ao' | 'shadow', on: boolean): void;
  /** Depth of field focuses at this world point (distance along the view axis). */
  setFocus(worldPoint: Vector3): void;
  /** Called after every resize with CSS pixel size. */
  onResize(cb: (width: number, height: number, aspect: number) => void): void;
  /** Called whenever the tier changes (manual or automatic). */
  onQualityChange(cb: (tier: QualityTier) => void): void;
  dispose(): void;
}

function parseQualityParam(): QualityTier | null {
  const q = new URLSearchParams(window.location.search).get('quality');
  return q === 'high' || q === 'medium' || q === 'low' ? q : null;
}

/** Seamless backdrop: a huge inside-out sphere with a smooth vertical gradient, so no horizon line exists. */
function createBackdrop(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      // Flat on purpose: the page around the canvas is one paper colour, sampled from this (see sampleBackdrop).
      top: { value: new Color('#fde4c8') },
      mid: { value: new Color('#fde4c8') },
      bottom: { value: new Color('#fde4c8') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        float t = smoothstep(-0.8, 0.9, y);
        vec3 c = mix(mix(bottom, mid, t), mix(mid, top, t), t);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new Mesh(new SphereGeometry(60, 32, 16), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.name = 'backdrop';
  return dome;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const forced = parseQualityParam();
  let quality: QualityTier = initialTier(forced, window.matchMedia?.('(pointer: coarse)').matches ?? false);

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap;

  const scene = new Scene();
  scene.background = new Color('#fde4c8');
  scene.environmentIntensity = 0.85;

  const camera = new PerspectiveCamera(35, 1, 0.05, 150);
  camera.position.set(0, 1.0, 1.7);

  const backdrop = createBackdrop();
  const backdropUniforms = (backdrop.material as ShaderMaterial).uniforms;
  scene.add(backdrop);

  // Contact-shadow catcher: invisible except for shadows, so nothing but the soft shadow marks the floor.
  const floor = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ color: new Color('#7a5a3a'), opacity: 0.15 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'shadowFloor';
  scene.add(floor);

  // Soft contact pool under the bouquet: a radial gradient on the floor, so it reads as grounded at every tier.
  const poolCanvas = document.createElement('canvas');
  poolCanvas.width = poolCanvas.height = 128;
  const pg = poolCanvas.getContext('2d');
  if (pg) {
    const grad = pg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(90,64,40,0.55)');
    grad.addColorStop(0.45, 'rgba(90,64,40,0.22)');
    grad.addColorStop(1, 'rgba(90,64,40,0)');
    pg.fillStyle = grad;
    pg.fillRect(0, 0, 128, 128);
  }
  const poolTex = new CanvasTexture(poolCanvas);
  poolTex.colorSpace = SRGBColorSpace;
  const pool = new Mesh(new PlaneGeometry(0.9, 0.9), new MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, toneMapped: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.002, 0);
  pool.renderOrder = -5;
  pool.name = 'contactPool';
  scene.add(pool);

  // Key light: soft warm daylight from almost overhead, so the shadow pools under the bouquet.
  const keyLight = new DirectionalLight('#fff1dc', 2.2);
  keyLight.position.set(-0.3, 4.2, 0.45);
  keyLight.target.position.set(0, 0.4, 0);
  keyLight.castShadow = true;
  const sc = keyLight.shadow.camera;
  sc.left = -1.3; sc.right = 1.3; sc.top = 1.3; sc.bottom = -1.3; sc.near = 0.5; sc.far = 7;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.01;
  keyLight.shadow.radius = 12;
  scene.add(keyLight, keyLight.target);

  // Environment: bundled CC0 HDRI, RoomEnvironment fallback.
  const pmrem = new PMREMGenerator(renderer);
  let environment: 'hdri' | 'room' | 'none' = 'none';
  const ready = (async () => {
    try {
      const tex = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}${HDRI_FILE}`);
      tex.mapping = EquirectangularReflectionMapping;
      const rt = pmrem.fromEquirectangular(tex);
      scene.environment = rt.texture;
      tex.dispose();
      environment = 'hdri';
    } catch (err) {
      console.warn('[stage] HDRI failed to load, falling back to RoomEnvironment', err);
      const rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = rt.texture;
      environment = 'room';
    }
    pmrem.dispose();
    // Compile shaders off the main thread where supported, so the first frame does not freeze the page.
    await renderer.compileAsync(scene, camera);
  })();

  // Post chain
  let composer: EffectComposer | null = null;
  let aoPass: GTAOPass | null = null;
  let dofPass: BokehPass | null = null;
  let composerMsaa = -1;
  const focusPoint = new Vector3(0, 0.6, 0);
  const tmp = new Vector3();

  /** EffectComposer.dispose() does not dispose its passes (GTAO and Bokeh own render targets), so do that first. */
  function disposeComposer(): void {
    if (!composer) return;
    for (const pass of composer.passes) pass.dispose();
    composer.dispose();
    composer = null;
    aoPass = null;
    dofPass = null;
    composerMsaa = -1;
  }

  function buildComposer(msaa: number): void {
    disposeComposer();
    const size = renderer.getSize(new Vector2());
    const pr = renderer.getPixelRatio();
    const target = new WebGLRenderTarget(size.x * pr, size.y * pr, { type: HalfFloatType, samples: msaa });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    aoPass = new GTAOPass(scene, camera, size.x * pr, size.y * pr);
    // Radius is kept small against a ~0.08 bloom: a large radius makes thin overlapping petals shade each other
    // into dark blotches (isolated by toggling AO and shadows separately: it was AO, not shadows).
    aoPass.updateGtaoMaterial({ radius: 0.06, distanceExponent: 1.6, thickness: 0.5, scale: 1, samples: 16 });
    aoPass.blendIntensity = 0.5;
    composer.addPass(aoPass);
    dofPass = new BokehPass(scene, camera, { focus: 2, aperture: 0.0008, maxblur: 0.0035 });
    composer.addPass(dofPass);
    composer.addPass(new OutputPass());
    composerMsaa = msaa;
  }

  const resizeCbs: Array<(w: number, h: number, a: number) => void> = [];
  const qualityCbs: Array<(t: QualityTier) => void> = [];
  let cssW = 1;
  let cssH = 1;

  function resizeAo(): void {
    if (!aoPass) return;
    const s = TIER_SETTINGS[quality].aoScale;
    const pr = renderer.getPixelRatio();
    aoPass.setSize(Math.max(1, Math.floor(cssW * pr * s)), Math.max(1, Math.floor(cssH * pr * s)));
  }

  /** Resizing clears the canvas, so a resize event with an unchanged size (phone address bar) must not touch it. */
  function applySize(force = true): void {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    if (!force && w === cssW && h === cssH) return;
    cssW = w;
    cssH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      resizeAo();
    }
    for (const cb of resizeCbs) cb(w, h, camera.aspect);
  }

  function applyQuality(tier: QualityTier): void {
    quality = tier;
    const s = TIER_SETTINGS[tier];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.maxPixelRatio));

    const sh = keyLight.shadow;
    if (sh.mapSize.x !== s.shadowMapSize) {
      sh.mapSize.set(s.shadowMapSize, s.shadowMapSize);
      sh.map?.dispose();
      sh.map = null;
    }
    sh.blurSamples = s.shadowBlurSamples;

    if (s.composer) {
      if (!composer || composerMsaa !== s.msaa) buildComposer(s.msaa);
      if (aoPass) aoPass.enabled = s.ao;
      if (dofPass) dofPass.enabled = s.dof;
    } else if (composer) {
      disposeComposer();
    }
    applySize();
  }

  // Frame time governor
  const stats = { frames: 0, frameMs: 16, downgrades: 0, samples: 0 };
  let lastT = 0;
  let slowFor = 0;
  let sinceChange = 0;
  let framesSinceChange = 0;
  let wasHidden = false;
  document.addEventListener('visibilitychange', () => { if (document.hidden) wasHidden = true; });

  function governor(): void {
    const now = performance.now();
    if (lastT === 0) { lastT = now; return; }
    const ms = now - lastT;
    lastT = now;
    const hidden = wasHidden;
    wasHidden = document.hidden;
    if (hidden || ms >= STALL_MS) { slowFor = 0; return; } // hidden tab or a one-off stall; not sustained slowness
    if (++framesSinceChange <= SETTLE_FRAMES) return;
    stats.frameMs = stats.samples === 0 ? ms : stats.frameMs + (ms - stats.frameMs) * 0.12;
    stats.samples++;
    sinceChange += ms / 1000;
    if (forced || sinceChange < WARMUP_S) return;
    if (stats.frameMs > SLOW_FRAME_MS) slowFor += ms / 1000;
    else slowFor = Math.max(0, slowFor - ms / 1000);
    if (slowFor > DOWNGRADE_AFTER_S) {
      const next = TIERS[TIERS.indexOf(quality) + 1];
      if (next) {
        console.info(`[stage] sustained ${stats.frameMs.toFixed(1)} ms frames, downgrading ${quality} -> ${next}`);
        stats.downgrades++;
        api.setQuality(next);
      }
      slowFor = 0;
    }
  }

  function updateFocus(): void {
    if (!dofPass) return;
    camera.getWorldDirection(tmp);
    const d = tmp.dot(focusPoint.clone().sub(camera.position));
    dofPass.materialBokeh.uniforms['focus'].value = Math.max(camera.near, d);
    dofPass.materialBokeh.uniforms['aspect'].value = camera.aspect;
  }

  const api: Stage = {
    renderer,
    scene,
    camera,
    get quality() { return quality; },
    qualityForced: forced !== null,
    ready,
    get environment() { return environment; },
    stats,
    keyLight,
    render() {
      governor();
      stats.frames++;
      if (composer) {
        updateFocus();
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
    get backdrop() { return backdropUniforms.mid.value as Color; },
    setBackdrop(c) {
      for (const k of ['top', 'mid', 'bottom']) (backdropUniforms[k].value as Color).copy(c);
    },
    sampleBackdrop() {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      renderer.setRenderTarget(null);
      gl.readPixels(2, gl.drawingBufferHeight - 3, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    },
    setQuality(tier) {
      if (tier === quality && (TIER_SETTINGS[tier].composer === !!composer)) return;
      applyQuality(tier);
      sinceChange = 0;
      framesSinceChange = 0;
      stats.samples = 0;
      slowFor = 0;
      for (const cb of qualityCbs) cb(tier);
    },
    debugToggle(what, on) {
      if (what === 'ao') { if (aoPass) aoPass.enabled = on && TIER_SETTINGS[quality].ao; }
      else keyLight.castShadow = on;
    },
    setFocus(p) { focusPoint.copy(p); },
    onResize(cb) { resizeCbs.push(cb); },
    onQualityChange(cb) { qualityCbs.push(cb); },
    dispose() {
      ro.disconnect();
      disposeComposer();
      renderer.dispose();
    },
  };

  const ro = new ResizeObserver(() => applySize(false));
  ro.observe(canvas);
  window.addEventListener('resize', () => applySize(false));

  applyQuality(quality);


  return api;
}
