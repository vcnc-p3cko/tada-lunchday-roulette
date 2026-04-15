import { initialZoom, zoomThreshold } from './data/constants';
import type { StageDef } from './data/maps';
import type { Marble } from './marble';
import type { VectorLike } from './types/VectorLike';

const cameraLerpX = 16;
const cameraLerpY = 14;
const cameraLerpZoom = 18;
const cameraDeadZoneX = 0.18;
const cameraDeadZoneY = 0.26;
const cameraDeadZoneZoom = 0.015;

export class Camera {
  private _position: VectorLike = { x: 0, y: 0 };
  private _targetPosition: VectorLike = { x: 0, y: 0 };
  private _zoom: number = 1;
  private _targetZoom: number = 1;
  private _locked = false;
  private _shouldFollowMarbles = false;

  get zoom() {
    return this._zoom;
  }
  set zoom(v: number) {
    this._targetZoom = v;
  }

  get x() {
    return this._position.x;
  }
  set x(v: number) {
    this._targetPosition.x = v;
  }
  get y() {
    return this._position.y;
  }
  set y(v: number) {
    this._targetPosition.y = v;
  }

  get position() {
    return this._position;
  }

  setPosition(v: VectorLike, force: boolean = false) {
    if (force) {
      return (this._position = { x: v.x, y: v.y });
    }
    return (this._targetPosition = { x: v.x, y: v.y });
  }

  lock(v: boolean) {
    this._locked = v;
  }

  startFollowingMarbles() {
    this._shouldFollowMarbles = true;
  }

  initializePosition(center?: VectorLike, zoom?: number) {
    const x = center?.x ?? 12.95;
    const y = center?.y ?? 2;
    const z = zoom ?? 1;

    this._position = { x, y };
    this._targetPosition = { x, y };
    this._zoom = z;
    this._targetZoom = z;
    this._shouldFollowMarbles = false;
  }

  update({
    marbles,
    stage,
    needToZoom,
    targetIndex,
  }: {
    marbles: Marble[];
    stage: StageDef;
    needToZoom: boolean;
    targetIndex: number;
  }) {
    // set target position
    if (!this._locked) {
      this._calcTargetPositionAndZoom(marbles, stage, needToZoom, targetIndex);
    }

    // interpolate position
    this._position.x = this._interpolation(this.x, this._targetPosition.x, cameraLerpX, cameraDeadZoneX);
    this._position.y = this._interpolation(this.y, this._targetPosition.y, cameraLerpY, cameraDeadZoneY);

    // interpolate zoom
    this._zoom = this._interpolation(this._zoom, this._targetZoom, cameraLerpZoom, cameraDeadZoneZoom);
  }

  private _calcTargetPositionAndZoom(marbles: Marble[], stage: StageDef, needToZoom: boolean, targetIndex: number) {
    if (!this._shouldFollowMarbles) {
      return;
    }

    if (marbles.length > 0) {
      const targetMarble = marbles[targetIndex] ? marbles[targetIndex] : marbles[0];
      const focusMarbles = marbles.slice(0, Math.min(needToZoom ? 2 : 3, marbles.length));
      const focusPosition =
        focusMarbles.length > 1 ? this._buildFocusPosition(focusMarbles, targetMarble.position) : targetMarble.position;

      this.setPosition(focusPosition);
      if (needToZoom) {
        const goalDist = Math.abs(stage.zoomY - focusPosition.y);
        this.zoom = Math.max(1, (1 - goalDist / zoomThreshold) * 4);
      } else {
        this.zoom = 1;
      }
    } else {
      this.zoom = 1;
    }
  }

  private _buildFocusPosition(marbles: Marble[], leaderPosition: VectorLike): VectorLike {
    const weights = [0.64, 0.24, 0.12];
    let totalWeight = 0;
    let x = 0;
    let y = 0;

    marbles.forEach((marble, index) => {
      const weight = weights[index] ?? 0.08;
      totalWeight += weight;
      x += marble.position.x * weight;
      y += marble.position.y * weight;
    });

    if (!totalWeight) {
      return leaderPosition;
    }

    return { x: x / totalWeight, y: y / totalWeight };
  }

  private _interpolation(current: number, target: number, divisor: number, deadZone: number = 0) {
    const d = target - current;
    if (Math.abs(d) <= deadZone) {
      return current;
    }
    if (Math.abs(d) < 1 / initialZoom) {
      return target;
    }

    return current + d / divisor;
  }

  renderScene(ctx: CanvasRenderingContext2D, callback: (ctx: CanvasRenderingContext2D) => void) {
    const zoomFactor = initialZoom * 2 * this._zoom;
    ctx.save();
    ctx.translate(-this.x * this._zoom, -this.y * this._zoom);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(ctx.canvas.width / zoomFactor, ctx.canvas.height / zoomFactor);
    callback(ctx);
    ctx.restore();
  }
}
