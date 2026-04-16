import { Skills, STUCK_DELAY, Themes } from './data/constants';
import type { IPhysics } from './IPhysics';
import options from './options';
import type { ColorTheme } from './types/ColorTheme';
import type { VectorLike } from './types/VectorLike';
import { transformGuard } from './utils/transformGuard';
import { rad } from './utils/utils';
import { Vector } from './utils/Vector';

export class Marble {
  private static _pointer = { x: Number.NaN, y: Number.NaN };

  type = 'marble' as const;
  name: string = '';
  size: number = 0.5;
  color: string = 'red';
  hue: number = 0;
  impact: number = 0;
  weight: number = 1;
  skill: Skills = Skills.None;
  isActive: boolean = false;

  private _skillRate = 0.0005;
  private _coolTime = 5000;
  private _maxCoolTime = 5000;
  private _stuckTime = 0;
  private _motion = { x: 0, y: 0 };
  private _faceSeed = 0;
  private lastPosition: VectorLike = { x: 0, y: 0 };
  private theme: ColorTheme = Themes.dark;

  private physics: IPhysics;

  id: number;

  get position() {
    return this.physics.getMarblePosition(this.id) || { x: 0, y: 0, angle: 0 };
  }

  get x() {
    return this.position.x;
  }

  set x(v: number) {
    this.position.x = v;
  }

  get y() {
    return this.position.y;
  }

  set y(v: number) {
    this.position.y = v;
  }

  get angle() {
    return this.position.angle;
  }

  constructor(physics: IPhysics, order: number, max: number, name?: string, weight: number = 1) {
    this.name = name || `M${order}`;
    this.weight = weight;
    this.physics = physics;

    this._maxCoolTime = 1000 + (1 - this.weight) * 4000;
    this._coolTime = this._maxCoolTime * Math.random();
    this._skillRate = 0.2 * this.weight;

    const maxLine = Math.ceil(max / 10);
    const line = Math.floor(order / 10);
    const lineDelta = -Math.max(0, Math.ceil(maxLine - 5));
    this.hue = (360 / max) * order;
    this.color = `hsl(${this.hue} 100% 70%)`;
    this.id = order;
    this._faceSeed = order * 0.731;

    physics.createMarble(order, 10.25 + (order % 10) * 0.6, maxLine - line + lineDelta);
  }

  static setPointerPosition(x: number | null, y: number | null) {
    Marble._pointer.x = x ?? Number.NaN;
    Marble._pointer.y = y ?? Number.NaN;
  }

  update(deltaTime: number) {
    const position = this.position;
    const delta = Vector.sub(position, this.lastPosition);
    this._motion = { x: delta.x, y: delta.y };

    if (this.isActive && Vector.lenSq(Vector.sub(this.lastPosition, position)) < 0.00001) {
      this._stuckTime += deltaTime;

      if (this._stuckTime > STUCK_DELAY) {
        this.physics.shakeMarble(this.id);
        this._stuckTime = 0;
      }
    } else {
      this._stuckTime = 0;
    }
    this.lastPosition = { x: position.x, y: position.y };

    this.skill = Skills.None;
    if (this.impact) {
      this.impact = Math.max(0, this.impact - deltaTime);
    }
    if (!this.isActive) return;
    if (options.useSkills) {
      this._updateSkillInformation(deltaTime);
    }
  }

  setColor(color: string) {
    this.color = color;
  }

  private _updateSkillInformation(deltaTime: number) {
    if (this._coolTime > 0) {
      this._coolTime -= deltaTime;
    }

    if (this._coolTime <= 0) {
      this.skill = Math.random() < this._skillRate ? Skills.Impact : Skills.None;
      this._coolTime = this._maxCoolTime;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    outline: boolean,
    isMinimap: boolean = false,
    skin: CanvasImageSource | undefined,
    viewPort: { x: number; y: number; w: number; h: number; zoom: number },
    theme: ColorTheme
  ) {
    this.theme = theme;
    const viewPortHw = viewPort.w / viewPort.zoom / 2;
    const viewPortHh = viewPort.h / viewPort.zoom / 2;
    const viewPortLeft = viewPort.x - viewPortHw;
    const viewPortRight = viewPort.x + viewPortHw;
    const viewPortTop = viewPort.y - viewPortHh - this.size / 2;
    const viewPortBottom = viewPort.y + viewPortHh;
    if (
      !isMinimap &&
      (this.x < viewPortLeft || this.x > viewPortRight || this.y < viewPortTop || this.y > viewPortBottom)
    ) {
      return;
    }
    const transform = ctx.getTransform();
    if (isMinimap) {
      this._renderMinimap(ctx);
    } else {
      this._renderNormal(ctx, zoom, outline, skin);
    }
    ctx.setTransform(transform);
  }

  private _renderMinimap(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color;
    this._drawMarbleBody(ctx, true);
  }

  private _drawMarbleBody(ctx: CanvasRenderingContext2D, isMinimap: boolean) {
    const radius = isMinimap ? this.size : this.size / 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (isMinimap) {
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.ellipse(this.x - radius * 0.18, this.y - radius * 0.2, radius * 0.44, radius * 0.34, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(10, 14, 18, 0.14)';
    ctx.beginPath();
    ctx.ellipse(this.x + radius * 0.12, this.y + radius * 0.24, radius * 0.42, radius * 0.24, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private _renderNormal(ctx: CanvasRenderingContext2D, zoom: number, outline: boolean, skin?: CanvasImageSource) {
    const hs = this.size / 2;

    ctx.fillStyle = this.color;

    // ctx.shadowColor = this.color;
    // ctx.shadowBlur = zoom / 2;
    if (skin) {
      transformGuard(ctx, () => {
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.drawImage(skin, -hs, -hs, hs * 2, hs * 2);
      });
    } else {
      this._drawMarbleBody(ctx, false);
      this._drawFace(ctx, zoom, viewPort);
    }

    ctx.shadowColor = '';
    ctx.shadowBlur = 0;
    this._drawName(ctx, zoom);

    if (outline) {
      this._drawOutline(ctx, 2 / zoom);
    }

    if (options.useSkills) {
      this._renderCoolTime(ctx, zoom);
    }
  }

  private _drawName(ctx: CanvasRenderingContext2D, zoom: number) {
    transformGuard(ctx, () => {
      ctx.font = `12pt sans-serif`;
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 2;
      ctx.fillStyle = this.color;
      ctx.shadowBlur = 0;
      ctx.translate(this.x, this.y + 0.25);
      ctx.scale(1 / zoom, 1 / zoom);
      ctx.strokeText(this.name, 0, 0);
      ctx.fillText(this.name, 0, 0);
    });
  }

  private _drawFace(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    viewPort: { x: number; y: number; w: number; h: number; zoom: number }
  ) {
    const radius = this.size / 2;
    const screenX = viewPort.w / 2 + (this.x - viewPort.x) * viewPort.zoom;
    const screenY = viewPort.h / 2 + (this.y - viewPort.y) * viewPort.zoom;
    const motionLookX = clamp(this._motion.x * 10, -0.32, 0.32);
    const motionLookY = clamp(this._motion.y * 10, -0.2, 0.26);
    let gazeX = motionLookX;
    let gazeY = motionLookY;

    if (Number.isFinite(Marble._pointer.x) && Number.isFinite(Marble._pointer.y)) {
      const dx = Marble._pointer.x - screenX;
      const dy = Marble._pointer.y - screenY;
      const distance = Math.hypot(dx, dy) || 1;
      const pointerLook = Math.min(0.34, 56 / distance);
      gazeX += (dx / distance) * pointerLook;
      gazeY += (dy / distance) * pointerLook;
    }

    gazeX = clamp(gazeX, -0.42, 0.42);
    gazeY = clamp(gazeY, -0.24, 0.3);

    const speed = Math.min(1, Math.hypot(this._motion.x, this._motion.y) * 22);
    const blink = this._blinkAmount();
    const eyeHeight = Math.max(radius * 0.1, radius * (0.19 - blink * 0.16 - speed * 0.03));
    const eyeWidth = radius * 0.12;
    const eyeY = this.y - radius * 0.08 + gazeY * radius * 0.18;
    const leftEyeX = this.x - radius * 0.22 + gazeX * radius * 0.16;
    const rightEyeX = this.x + radius * 0.22 + gazeX * radius * 0.16;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 149, 167, 0.18)';
    ctx.beginPath();
    ctx.ellipse(this.x - radius * 0.28, this.y + radius * 0.1, radius * 0.15, radius * 0.09, 0, 0, Math.PI * 2);
    ctx.ellipse(this.x + radius * 0.28, this.y + radius * 0.1, radius * 0.15, radius * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(18, 23, 26, 0.9)';
    this._drawEye(ctx, leftEyeX, eyeY, eyeWidth, eyeHeight);
    this._drawEye(ctx, rightEyeX, eyeY, eyeWidth, eyeHeight);

    ctx.strokeStyle = 'rgba(24, 28, 32, 0.68)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1 / zoom, radius * 0.08);
    ctx.beginPath();
    ctx.arc(
      this.x + gazeX * radius * 0.06,
      this.y + radius * 0.08,
      radius * (0.22 + speed * 0.03),
      0.15 * Math.PI,
      0.85 * Math.PI
    );
    ctx.stroke();
    ctx.restore();
  }

  private _drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
    ctx.beginPath();
    ctx.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private _blinkAmount() {
    const cycle = (performance.now() * 0.0018 + this._faceSeed) % 7.2;

    if (cycle < 6.92) {
      return 0;
    }

    const blinkProgress = (cycle - 6.92) / 0.28;
    return 1 - Math.abs(blinkProgress * 2 - 1);
  }

  private _drawOutline(ctx: CanvasRenderingContext2D, lineWidth: number) {
    ctx.beginPath();
    ctx.strokeStyle = this.theme.marbleWinningBorder;
    ctx.lineWidth = lineWidth;
    ctx.arc(this.x, this.y, this.size / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  private _renderCoolTime(ctx: CanvasRenderingContext2D, zoom: number) {
    ctx.strokeStyle = this.theme.coolTimeIndicator;
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size / 2 + 2 / zoom, rad(270), rad(270 + (360 * this._coolTime) / this._maxCoolTime));
    ctx.stroke();
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
