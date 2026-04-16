import { canvasHeight, canvasWidth, initialZoom, zoomThreshold } from './data/constants';
import type { StageDef } from './data/maps';
import type { Marble } from './marble';
import type { VectorLike } from './types/VectorLike';

const cameraLerpX = 16;
const cameraLerpY = 14;
const cameraLerpZoom = 18;
const cameraZoomOutLerp = 8;
const cameraDeadZoneX = 0.18;
const cameraDeadZoneY = 0.26;
const cameraDeadZoneZoom = 0.015;
const minFollowZoom = 0.72;
const maxFinishZoom = 4;
const focusMarbleLimit = 6;
const focusMarginX = 3.4;
const focusMarginY = 4.2;
const leaderMarginX = 1.6;
const leaderBottomMargin = 2.2;

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

    // Zoom out faster than zooming in so a spread-out pack does not get clipped.
    const zoomLerp = this._targetZoom < this._zoom ? cameraZoomOutLerp : cameraLerpZoom;
    this._zoom = this._interpolation(this._zoom, this._targetZoom, zoomLerp, cameraDeadZoneZoom);
  }

  private _calcTargetPositionAndZoom(marbles: Marble[], stage: StageDef, needToZoom: boolean, targetIndex: number) {
    if (!this._shouldFollowMarbles) {
      return;
    }

    if (marbles.length > 0) {
      const targetMarble = marbles[targetIndex] ? marbles[targetIndex] : marbles[0];
      const focusMarbles = marbles.slice(0, Math.min(focusMarbleLimit, marbles.length));
      const fitZoom = this._calcFitZoom(focusMarbles);
      const focusPosition =
        focusMarbles.length > 1
          ? this._buildFocusPosition(focusMarbles, targetMarble.position, fitZoom)
          : targetMarble.position;

      this.setPosition(focusPosition);
      if (needToZoom) {
        const goalDist = Math.abs(stage.zoomY - focusPosition.y);
        const finishZoom = Math.max(1, (1 - goalDist / zoomThreshold) * maxFinishZoom);
        this.zoom = Math.max(minFollowZoom, Math.min(maxFinishZoom, finishZoom, fitZoom));
      } else {
        this.zoom = Math.max(minFollowZoom, Math.min(1, fitZoom));
      }
    } else {
      this.zoom = 1;
    }
  }

  private _calcFitZoom(marbles: Marble[]): number {
    if (marbles.length <= 1) {
      return maxFinishZoom;
    }

    const bounds = this._calcBounds(marbles);
    const width = Math.max(1, bounds.maxX - bounds.minX + focusMarginX);
    const height = Math.max(1, bounds.maxY - bounds.minY + focusMarginY);
    const fitX = canvasWidth / (initialZoom * width);
    const fitY = canvasHeight / (initialZoom * height);

    return Math.max(minFollowZoom, Math.min(maxFinishZoom, fitX, fitY));
  }

  private _calcBounds(marbles: Marble[]) {
    return marbles.reduce(
      (bounds, marble) => ({
        minX: Math.min(bounds.minX, marble.x),
        maxX: Math.max(bounds.maxX, marble.x),
        minY: Math.min(bounds.minY, marble.y),
        maxY: Math.max(bounds.maxY, marble.y),
      }),
      {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      }
    );
  }

  private _buildFocusPosition(marbles: Marble[], leaderPosition: VectorLike, zoom: number): VectorLike {
    const bounds = this._calcBounds(marbles);
    const spreadY = bounds.maxY - bounds.minY;
    const leaderBias = Math.min(0.7, Math.max(0.32, spreadY / (zoomThreshold * 1.4)));
    const groupCenterX = (bounds.minX + bounds.maxX) / 2;
    const groupCenterY = (bounds.minY + bounds.maxY) / 2;
    const x = groupCenterX * (1 - leaderBias) + leaderPosition.x * leaderBias;
    const y = groupCenterY * (1 - leaderBias) + leaderPosition.y * leaderBias;

    const halfVisibleWidth = canvasWidth / (initialZoom * zoom) / 2;
    const halfVisibleHeight = canvasHeight / (initialZoom * zoom) / 2;
    const minXForLeader = leaderPosition.x - halfVisibleWidth + leaderMarginX;
    const maxXForLeader = leaderPosition.x + halfVisibleWidth - leaderMarginX;
    const minYForLeader = leaderPosition.y - halfVisibleHeight + leaderBottomMargin;

    return {
      x: Math.min(maxXForLeader, Math.max(minXForLeader, x)),
      y: Math.max(minYForLeader, y),
    };
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
