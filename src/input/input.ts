import { Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import type { BouquetApi, CameraRigApi } from '../types';
import { Gesture, type Command } from './gesture';

/** The bouquet as input sees it: the shared contract plus the pick list the concrete Bouquet exposes. */
export type InputBouquet = BouquetApi & { readonly pickTargets: readonly Object3D[] };

export interface InputOptions {
  canvas: HTMLCanvasElement;
  camera: Camera;
  rig: CameraRigApi;
  bouquet: InputBouquet;
  onSelect?(id: number | null): void;
}

const WHEEL_SENSITIVITY = 0.0015;
const WHEEL_PINCH_SENSITIVITY = 0.01; // trackpad pinch arrives as ctrl+wheel with small deltas
const WHEEL_MIN = 0.85;
const WHEEL_MAX = 1.18;

interface DragState {
  id: number;
  plane: Plane;
  head: Vector3;
  offset: Vector3 | null; // head - hit, captured at drag start
}

/**
 * Pointer Events and wheel to camera and flower actions. All decisions live in Gesture (tested);
 * this class only converts coordinates, raycasts and calls the bouquet and rig.
 *
 * Time base: event.timeStamp and the `now` passed to update() must both be performance.now() milliseconds.
 */
export class InputController {
  selected: number | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly rig: CameraRigApi;
  private readonly bouquet: InputBouquet;
  private readonly onSelect?: (id: number | null) => void;
  private readonly gesture: Gesture;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly scratch = new Vector3();
  private readonly normal = new Vector3();
  private drag: DragState | null = null;
  private pressed: number | null = null;
  private hover: { x: number; y: number } | null = null;
  private cursor = '';
  private disposed = false;
  private readonly prevTouchAction: string;

  constructor(opts: InputOptions) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.rig = opts.rig;
    this.bouquet = opts.bouquet;
    this.onSelect = opts.onSelect;
    this.gesture = new Gesture({
      pick: (x, y) => this.pick(x, y),
      isExploded: () => this.bouquet.exploded,
      emit: (c) => this.handle(c),
    });
    this.prevTouchAction = this.canvas.style.touchAction;
    this.canvas.style.touchAction = 'none';
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('lostpointercapture', this.onLost);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('contextmenu', this.onContext);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    // Move/up/cancel on window: they still arrive if pointer capture was refused or lost.
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ------------------------------------------------------------------ public

  select(id: number | null): void {
    if (this.selected === id) return;
    const old = this.selected;
    this.selected = id;
    if (old !== null) this.applyHighlight(old);
    if (id !== null) this.applyHighlight(id);
    this.onSelect?.(id);
  }

  /** Per frame: hold timer, selection of a removed flower, and the (single) hover raycast. */
  update(now: number): void {
    if (this.disposed) return;
    this.gesture.tick(now);
    if (this.selected !== null && !this.exists(this.selected)) {
      this.selected = null; // bouquet already un-highlighted and is disposing it
      this.onSelect?.(null);
    }
    if (this.pressed !== null && !this.exists(this.pressed)) this.pressed = null;
    if (this.drag && !this.exists(this.drag.id)) this.gesture.cancelAll(); // dragEnd comes out of the machine
    this.updateHover();
  }

  dispose(): void {
    if (this.disposed) return;
    this.gesture.cancelAll();
    this.disposed = true;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('lostpointercapture', this.onLost);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('contextmenu', this.onContext);
    c.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.setCursor('');
    c.style.touchAction = this.prevTouchAction;
    const sel = this.selected;
    this.selected = null;
    this.pressed = null;
    if (sel !== null) this.applyHighlight(sel);
  }

  // ------------------------------------------------------------------ commands from the machine

  private handle(cmd: Command): void {
    switch (cmd.type) {
      case 'orbit':
        this.rig.orbitBy(cmd.dx, cmd.dy);
        break;
      case 'orbitRelease':
        this.rig.release(cmd.vx, cmd.vy);
        break;
      case 'pinch':
        this.rig.zoomBy(cmd.factor);
        break;
      case 'pressFeedback': {
        const old = this.pressed;
        this.pressed = cmd.id;
        if (old !== null) this.applyHighlight(old);
        if (cmd.id !== null) this.applyHighlight(cmd.id);
        break;
      }
      case 'dragStart':
        this.startDrag(cmd.id, cmd.x, cmd.y);
        break;
      case 'dragMove':
        this.moveDrag(cmd.x, cmd.y);
        break;
      case 'dragEnd':
        this.endDrag();
        break;
      case 'tap':
        this.select(cmd.id);
        break;
    }
  }

  private startDrag(id: number, x: number, y: number): void {
    if (this.drag || !this.exists(id)) return;
    this.select(id);
    const head = this.bouquet.headPosition(id).clone();
    this.camera.getWorldDirection(this.normal);
    const plane = new Plane().setFromNormalAndCoplanarPoint(this.normal, head);
    const drag: DragState = { id, plane, head, offset: null };
    this.drag = drag;
    this.bouquet.beginDrag(id);
    if (this.hitPlane(x, y, drag, this.scratch)) drag.offset = head.clone().sub(this.scratch);
    this.setCursor('grabbing');
  }

  private moveDrag(x: number, y: number): void {
    const d = this.drag;
    if (!d || !this.hitPlane(x, y, d, this.scratch)) return;
    // If the first ray missed the plane, take the offset from the first valid hit instead.
    if (!d.offset) d.offset = d.head.clone().sub(this.scratch);
    this.scratch.add(d.offset);
    this.bouquet.dragTo(d.id, this.scratch);
  }

  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.bouquet.endDrag(d.id);
    this.setCursor('');
  }

  // ------------------------------------------------------------------ picking

  private setRay(x: number, y: number): void {
    const r = this.canvas.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    this.ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  private hitPlane(x: number, y: number, d: DragState, out: Vector3): boolean {
    this.setRay(x, y);
    return this.raycaster.ray.intersectPlane(d.plane, out) !== null;
  }

  private pick(x: number, y: number): number | null {
    this.setRay(x, y);
    const hits = this.raycaster.intersectObjects(this.bouquet.pickTargets as Object3D[], false);
    for (const h of hits) {
      const id = h.object.userData.flowerId;
      if (typeof id === 'number') return id;
    }
    return null;
  }

  // ------------------------------------------------------------------ hover (mouse only)

  private updateHover(): void {
    if (this.drag) return;
    if (!this.hover || this.gesture.mode !== 'idle') {
      if (this.gesture.mode === 'idle') this.setCursor('');
      return;
    }
    // Assembled: a plain drag orbits (a press-and-hold moves the flower), so offer a pointer, not a grab hand.
    this.setCursor(this.pick(this.hover.x, this.hover.y) !== null ? (this.bouquet.exploded ? 'grab' : 'pointer') : '');
  }

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.canvas.style.cursor = c;
  }

  // ------------------------------------------------------------------ highlight / selection helpers

  private exists(id: number): boolean {
    return this.bouquet.flowers.some((f) => f.id === id);
  }

  private applyHighlight(id: number): void {
    const rec = this.bouquet.flowers.find((f) => f.id === id);
    rec?.visual.setHighlighted(id === this.selected || id === this.pressed);
  }

  // ------------------------------------------------------------------ DOM

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
      return;
    }
    if (e.pointerType === 'mouse' && e.buttons !== 0 && this.gesture.mode !== 'idle') return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    e.preventDefault();
    this.rig.orbitBy(0, 0); // any press catches camera inertia, so a flower never drifts under a resting finger
    if (e.pointerType === 'mouse') this.hover = null;
    const p = this.local(e);
    this.gesture.pointerDown(e.pointerId, p.x, p.y, e.timeStamp);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.gesture.tracks(e.pointerId)) {
      const p = this.local(e);
      this.gesture.pointerMove(e.pointerId, p.x, p.y, e.timeStamp);
    } else if (e.pointerType === 'mouse' && e.target === this.canvas) {
      this.hover = this.local(e);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.gesture.tracks(e.pointerId)) return;
    this.gesture.pointerUp(e.pointerId, e.timeStamp);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.gesture.pointerCancel(e.pointerId, e.timeStamp);
  };

  private readonly onLost = (e: PointerEvent): void => {
    // Fires after a normal pointerup too; by then the machine no longer tracks the id, so it is a no-op.
    if (this.gesture.tracks(e.pointerId)) {
      this.gesture.pointerCancel(e.pointerId, e.timeStamp);
    }
  };

  private readonly onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.hover = null;
  };

  private readonly onBlur = (): void => {
    this.gesture.cancelAll();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.onBlur();
  };

  private readonly onContext = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const k = e.ctrlKey ? WHEEL_PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
    const factor = Math.min(WHEEL_MAX, Math.max(WHEEL_MIN, Math.exp(e.deltaY * unit * k)));
    this.rig.zoomBy(factor);
  };
}
