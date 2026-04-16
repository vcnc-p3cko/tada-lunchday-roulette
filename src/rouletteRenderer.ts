import type { Camera } from './camera';
import { canvasHeight, canvasWidth, initialZoom, Themes } from './data/constants';
import type { StageDef } from './data/maps';
import type { GameObject } from './gameObject';
import { KeywordService } from './keywordService';
import { Marble } from './marble';
import type { ParticleManager } from './particleManager';
import type { ColorTheme } from './types/ColorTheme';
import type { MapEntityState } from './types/MapEntity.type';
import type { VectorLike } from './types/VectorLike';
import type { UIObject } from './UIObject';

class DisabledKeywordService extends KeywordService {
  async init(): Promise<void> {}
  getSprite(_marbleName: string): CanvasImageSource | undefined {
    return undefined;
  }
}

type RouletteRendererOptions = {
  enableKeywordSprites?: boolean;
};

export type RenderParameters = {
  camera: Camera;
  stage: StageDef;
  entities: MapEntityState[];
  marbles: Marble[];
  winners: Marble[];
  particleManager: ParticleManager;
  effects: GameObject[];
  winnerRank: number;
  winner: Marble | null;
  size: VectorLike;
  theme: ColorTheme;
};

export class RouletteRenderer {
  protected _canvas!: HTMLCanvasElement;
  protected ctx!: CanvasRenderingContext2D;
  public sizeFactor = 1;

  protected _images: { [key: string]: HTMLImageElement } = {};
  protected _theme: ColorTheme = Themes.dark;
  protected _keywordService: KeywordService;
  private _handlePointerMove = (event: PointerEvent) => {
    const rect = this._canvas.getBoundingClientRect();
    const insideX = event.clientX >= rect.left && event.clientX <= rect.right;
    const insideY = event.clientY >= rect.top && event.clientY <= rect.bottom;

    if (!insideX || !insideY) {
      Marble.setPointerPosition(null, null);
      return;
    }

    Marble.setPointerPosition(
      ((event.clientX - rect.left) / rect.width) * this._canvas.width,
      ((event.clientY - rect.top) / rect.height) * this._canvas.height
    );
  };
  private _clearPointerPosition = () => {
    Marble.setPointerPosition(null, null);
  };

  constructor(protected options: RouletteRendererOptions = {}) {
    this._keywordService = this.createKeywordService();
  }

  protected createKeywordService(): KeywordService {
    if (this.options.enableKeywordSprites === false) {
      return new DisabledKeywordService();
    }
    return new KeywordService();
  }

  get width() {
    return this._canvas.width;
  }

  get height() {
    return this._canvas.height;
  }

  get canvas() {
    return this._canvas;
  }

  set theme(value: ColorTheme) {
    this._theme = value;
  }

  async init() {
    await Promise.all([this._load(), this._keywordService.init()]);

    this._canvas = document.createElement('canvas');
    this._canvas.width = canvasWidth;
    this._canvas.height = canvasHeight;
    this.ctx = this._canvas.getContext('2d', {
      alpha: false,
    }) as CanvasRenderingContext2D;

    document.body.appendChild(this._canvas);

    const resizing = (entries?: ResizeObserverEntry[]) => {
      const realSize = entries ? entries[0].contentRect : this._canvas.getBoundingClientRect();
      const width = Math.max(realSize.width / 2, 640);
      const height = (width / realSize.width) * realSize.height;
      this._canvas.width = width;
      this._canvas.height = height;
      this.sizeFactor = width / realSize.width;
    };

    const resizeObserver = new ResizeObserver(resizing);

    resizeObserver.observe(this._canvas);
    resizing();

    window.addEventListener('pointermove', this._handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', this._clearPointerPosition);
    window.addEventListener('blur', this._clearPointerPosition);
  }

  private async _loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((rs) => {
      const img = new Image();
      img.addEventListener('load', () => {
        rs(img);
      });
      img.src = url;
    });
  }

  private async _load(): Promise<void> {
    const loadPromises = [
      { name: '챔루', imgUrl: new URL('../assets/images/chamru.png', import.meta.url) },
      { name: '쿠빈', imgUrl: new URL('../assets/images/kubin.png', import.meta.url) },
      { name: '꽉변', imgUrl: new URL('../assets/images/kkwak.png', import.meta.url) },
      { name: '꽉변호사', imgUrl: new URL('../assets/images/kkwak.png', import.meta.url) },
      { name: '꽉 변호사', imgUrl: new URL('../assets/images/kkwak.png', import.meta.url) },
      { name: '주누피', imgUrl: new URL('../assets/images/junyoop.png', import.meta.url) },
      { name: '왈도쿤', imgUrl: new URL('../assets/images/waldokun.png', import.meta.url) },
    ].map(({ name, imgUrl }) => {
      return (async () => {
        this._images[name] = await this._loadImage(imgUrl.toString());
      })();
    });

    loadPromises.push(
      (async () => {
        await this._loadImage(new URL('../assets/images/ff.svg', import.meta.url).toString());
      })()
    );

    await Promise.all(loadPromises);
  }

  private getMarbleImage(name: string): CanvasImageSource | undefined {
    // Priority 1: Hardcoded images
    if (this._images[name]) {
      return this._images[name];
    }
    // Priority 2: Keyword sprites from API
    return this._keywordService.getSprite(name);
  }

  protected onBeforeEntities(): void {}
  protected onAfterScene(): void {}

  render(renderParameters: RenderParameters, uiObjects: UIObject[]) {
    this._theme = renderParameters.theme;
    this.ctx.fillStyle = this._theme.background;
    this.ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    this.ctx.save();
    this.ctx.scale(initialZoom, initialZoom);
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.font = '0.4pt sans-serif';
    this.ctx.lineWidth = 3 / (renderParameters.camera.zoom + initialZoom);
    renderParameters.camera.renderScene(this.ctx, () => {
      this.onBeforeEntities();
      this.renderEntities(renderParameters.entities);
      this.renderEffects(renderParameters);
      this.renderMarbles(renderParameters);
    });
    this.ctx.restore();
    this.onAfterScene();

    uiObjects.forEach((obj) => obj.render(this.ctx, renderParameters, this._canvas.width, this._canvas.height));
    renderParameters.particleManager.render(this.ctx);
  }

  private renderEntities(entities: MapEntityState[]) {
    this.ctx.save();
    entities.forEach((entity) => {
      const transform = this.ctx.getTransform();
      this.ctx.translate(entity.x, entity.y);
      this.ctx.rotate(entity.angle);
      this.ctx.fillStyle = entity.shape.color ?? this._theme.entity[entity.shape.type].fill;
      this.ctx.strokeStyle = entity.shape.color ?? this._theme.entity[entity.shape.type].outline;
      this.ctx.shadowBlur = this._theme.entity[entity.shape.type].bloomRadius;
      this.ctx.shadowColor =
        entity.shape.bloomColor ?? entity.shape.color ?? this._theme.entity[entity.shape.type].bloom;
      const shape = entity.shape;
      switch (shape.type) {
        case 'polyline':
          if (shape.points.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(shape.points[0][0], shape.points[0][1]);
            for (let i = 1; i < shape.points.length; i++) {
              this.ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            }
            this.ctx.stroke();
          }
          break;
        case 'box': {
          const w = shape.width * 2;
          const h = shape.height * 2;
          this.ctx.rotate(shape.rotation);
          this.ctx.fillRect(-w / 2, -h / 2, w, h);
          this.ctx.strokeRect(-w / 2, -h / 2, w, h);
          break;
        }
        case 'circle':
          this.ctx.beginPath();
          this.ctx.arc(0, 0, shape.radius, 0, Math.PI * 2, false);
          this.ctx.stroke();
          break;
      }

      this.ctx.setTransform(transform);
    });
    this.ctx.restore();
  }

  private renderEffects({ effects, camera }: RenderParameters) {
    effects.forEach((effect) => effect.render(this.ctx, camera.zoom * initialZoom, this._theme));
  }

  private renderMarbles({ marbles, camera, size }: RenderParameters) {
    const viewPort = { x: camera.x, y: camera.y, w: size.x, h: size.y, zoom: camera.zoom * initialZoom };
    marbles.forEach((marble) => {
      marble.render(
        this.ctx,
        camera.zoom * initialZoom,
        false,
        false,
        this.getMarbleImage(marble.name),
        viewPort,
        this._theme
      );
    });
  }
}
