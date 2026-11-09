import type { Camera, Group, Object3D, Vector3 } from 'three';

export type VarietyId = 'rose' | 'tulip' | 'daisy' | 'peony' | 'eucalyptus';
export type QualityTier = 'high' | 'medium' | 'low';

export interface VarietyInfo {
  id: VarietyId;
  label: string;
  blurb: string;        // one short line for the catalogue
  swatches: string[];   // CSS colours, one per palette
}

/** A single flower's visual. Its origin is NOT meaningful: all placement goes through setPose. */
export interface FlowerVisual {
  readonly object: Group;
  readonly variety: VarietyId;
  /** Invisible simplified meshes for raycasting, generous enough for fingers. userData.flowerId is set by Bouquet. */
  readonly pickTargets: Object3D[];
  /** root = bottom of stem, head = where the bloom sits, roll = spin about the stem in radians. */
  setPose(root: Vector3, head: Vector3, roll: number): void;
  setHighlighted(on: boolean): void;
  dispose(): void; // releases per-flower resources only, never shared geometry or materials
}

export interface FlowerRecord {
  id: number;
  variety: VarietyId;
  visual: FlowerVisual;
}

export interface BouquetEvents {
  onChange?(): void; // flower added, removed, or exploded state changed
}

export interface BouquetApi {
  readonly flowers: readonly FlowerRecord[];
  readonly bindingPoint: Vector3;
  readonly exploded: boolean;
  add(variety: VarietyId, paletteIndex?: number): FlowerRecord;
  remove(id: number): void;
  setExploded(on: boolean): void;
  toggleExploded(): void;
  /** Current spring-driven head position of a flower. */
  headPosition(id: number): Vector3;
  beginDrag(id: number): void;
  /** World-space desired head position. Bouquet applies constraints. */
  dragTo(id: number, worldHead: Vector3): void;
  endDrag(id: number): void;
  update(dt: number): void;
  /** True while any spring is still visibly moving. */
  readonly settling: boolean;
}

export interface CameraRigApi {
  readonly camera: Camera;
  orbitBy(dxPixels: number, dyPixels: number): void;
  zoomBy(factor: number): void; // factor > 1 moves further away
  release(vxPixelsPerSec: number, vyPixelsPerSec: number): void; // start inertia
  update(dt: number): void;
}
