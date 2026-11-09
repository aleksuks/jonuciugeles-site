import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { CameraRigApi } from '../types';
import { DEFAULT_VIEW } from '../bouquet/layout';

/** Radius of the sphere around the target that must stay in frame (bouquet ~0.6 tall, stems and exploded fan included). */
const FRAME_RADIUS = 0.52;
/** Frame radius when fully exploded (the exploded sphere plus stems), see EXPLODED in layout.ts. */
export const FRAME_RADIUS_EXPLODED = 0.72;
const MIN_POLAR = 0.2;
const MAX_POLAR = 1.75;
const MIN_ZOOM = 0.45; // multipliers of the fit distance
const MAX_ZOOM = 1.5;
const ORBIT_SPEED = 0.0055; // radians per pixel
const INERTIA_DECAY = 3.2; // 1/s
const MAX_SPIN = 6; // rad/s, cap on release velocity (about 1100 px/s of flick)
const ZOOM_SMOOTH = 12; // 1/s
/** Camera never goes below this height, so it cannot end up under the floor. */
const MIN_CAMERA_Y = 0.06;

export class CameraRig implements CameraRigApi {
  readonly camera: PerspectiveCamera;
  readonly target = new Vector3(0, 0.55, 0);
  azimuth = DEFAULT_VIEW.azimuth;
  polar = DEFAULT_VIEW.polar; // about 25 degrees above the horizon
  /** Extra view angles added on top (pointer parallax); not clamped into azimuth/polar, so they never accumulate. */
  offsetAz = 0;
  offsetPol = 0;

  private zoom = 1;
  private zoomTarget = 1;
  private vAz = 0; // rad/s
  private vPol = 0;
  private fitDistance = 2;
  private frameRadius = FRAME_RADIUS;
  private aspect = 1;
  private free: { x: number; y: number; w: number; h: number } | null = null;
  private lastOffset = '';

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
    this.setAspect(camera.aspect);
    this.update(0);
  }

  /** Recompute the distance that frames the bouquet for this aspect ratio (portrait pulls back). */
  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.refit();
  }

  /** Radius of the sphere that must stay in frame; grows when the bouquet explodes so the fan fits. */
  setFrameRadius(r: number): void {
    if (Math.abs(r - this.frameRadius) < 1e-4) return;
    this.frameRadius = r;
    this.refit();
  }

  private refit(): void {
    const vHalf = MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.aspect);
    this.fitDistance = this.frameRadius / Math.sin(Math.min(vHalf, hHalf));
    this.applyFree();
  }

  /**
   * Frame the bouquet inside the part of the canvas that no UI covers (CSS pixels, canvas-local).
   * Uses camera.setViewOffset, so raycasting and projection stay correct. Null = whole canvas.
   */
  setFreeRect(rect: { x: number; y: number; w: number; h: number } | null, canvasW: number, canvasH: number): void {
    this.free = rect;
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.applyFree();
  }

  private canvasW = 0;
  private canvasH = 0;

  private applyFree(): void {
    const cam = this.camera;
    const W = this.canvasW;
    const H = this.canvasH;
    const f = this.free;
    if (!f || W < 1 || H < 1 || f.w < 1 || f.h < 1) {
      if (this.lastOffset) { cam.clearViewOffset(); this.lastOffset = ''; }
      return;
    }
    // Distance: the framing sphere must fit the smaller side of the free rect.
    const vHalf = MathUtils.degToRad(cam.fov) / 2;
    const ang = Math.atan((Math.tan(vHalf) * Math.min(f.w, f.h)) / H);
    this.fitDistance = this.frameRadius / Math.sin(ang);
    const dx = f.x + f.w / 2 - W / 2;
    const dy = f.y + f.h / 2 - H / 2;
    const key = `${W}|${H}|${dx}|${dy}`;
    if (key !== this.lastOffset) {
      cam.setViewOffset(W, H, -dx, -dy, W, H);
      this.lastOffset = key;
    }
  }

  get distance(): number {
    return this.fitDistance * this.zoom;
  }

  orbitBy(dx: number, dy: number): void {
    this.vAz = 0;
    this.vPol = 0;
    this.azimuth -= dx * ORBIT_SPEED;
    this.polar = this.clampPolar(this.polar - dy * ORBIT_SPEED);
  }

  zoomBy(factor: number): void {
    this.zoomTarget = MathUtils.clamp(this.zoomTarget * factor, MIN_ZOOM, MAX_ZOOM);
  }

  release(vx: number, vy: number): void {
    // A flick measured over a few milliseconds can read as tens of thousands of px/s; cap the spin so it stays a nudge.
    this.vAz = MathUtils.clamp(-vx * ORBIT_SPEED, -MAX_SPIN, MAX_SPIN);
    this.vPol = MathUtils.clamp(-vy * ORBIT_SPEED, -MAX_SPIN, MAX_SPIN);
  }

  update(dt: number): void {
    if (dt > 0) {
      if (this.vAz !== 0 || this.vPol !== 0) {
        this.azimuth += this.vAz * dt;
        this.polar = this.clampPolar(this.polar + this.vPol * dt);
        const k = Math.exp(-INERTIA_DECAY * dt);
        this.vAz *= k;
        this.vPol *= k;
        if (Math.abs(this.vAz) < 1e-3 && Math.abs(this.vPol) < 1e-3) { this.vAz = 0; this.vPol = 0; }
      }
      this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-ZOOM_SMOOTH * dt));
    }
    this.polar = this.clampPolar(this.polar);
    const d = this.distance;
    const pol = this.clampPolar(this.polar + this.offsetPol);
    const az = this.azimuth + this.offsetAz;
    const sp = Math.sin(pol);
    this.camera.position.set(
      this.target.x + d * sp * Math.sin(az),
      this.target.y + d * Math.cos(pol),
      this.target.z + d * sp * Math.cos(az),
    );
    this.camera.lookAt(this.target);
  }

  private clampPolar(p: number): number {
    // Largest polar angle that keeps the camera above MIN_CAMERA_Y at the current distance.
    const c = (MIN_CAMERA_Y - this.target.y) / Math.max(this.distance, 1e-3);
    const floorLimit = Math.acos(MathUtils.clamp(c, -1, 1));
    return MathUtils.clamp(p, MIN_POLAR, Math.min(MAX_POLAR, floorLimit));
  }
}
