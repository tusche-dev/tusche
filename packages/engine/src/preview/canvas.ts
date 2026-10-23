/// <reference lib="dom" />
// The preview page's canvas. Runs in the browser: no `node:*` imports here, and no
// `@open-pencil/core/io/formats/raster` (patched for Node). The server lays the document out
// with the engine and sends the finished scene; the page only draws it (WebGL) and hit-tests.
import { SkiaRenderer } from '@open-pencil/core/canvas';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { fontManager } from '@open-pencil/core/text';
import type { FontFile, PreviewMessage } from '../snapshot-codec.ts';
import { type NodeInfo, PreviewScene } from './scene.ts';

type CanvasKit = Awaited<ReturnType<typeof getCanvasKit>>;
type Update = Extract<PreviewMessage, { type: 'update' }>;

export interface PreviewCanvasOptions {
  /** URL of `canvaskit.wasm`. */
  wasmUrl: string;
  /** URL of a file of `@open-pencil/core/assets` (the bundled Inter). */
  assetUrl: (file: string) => string;
  /** URL of a font file listed in an update. */
  fontUrl: (font: FontFile) => string;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;
const FIT_MARGIN = 48;

/** Read-only canvas of the preview: pan, zoom, hover and selection by pen id. */
export class PreviewCanvas {
  readonly scene = new PreviewScene();
  private readonly fonts = new Set<string>();
  private version = 0;
  private frame = 0;
  private hovered: string | null = null;
  private selected: string | null = null;
  private fitted = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ck: CanvasKit,
    private readonly renderer: SkiaRenderer,
    private readonly options: PreviewCanvasOptions,
  ) {
    renderer.pageId = this.scene.pageId;
    renderer.showRulers = false;
  }

  static async create(
    canvas: HTMLCanvasElement,
    options: PreviewCanvasOptions,
  ): Promise<PreviewCanvas> {
    fontManager.setBundledFontLocator(options.assetUrl);
    const ck = await getCanvasKit({ locateFile: () => options.wasmUrl });
    const surface = ck.MakeWebGLCanvasSurface(canvas);
    if (!surface) throw new Error('WebGL is not available');
    const renderer = new SkiaRenderer(ck, surface);
    await renderer.loadFonts();
    const preview = new PreviewCanvas(canvas, ck, renderer, options);
    preview.resize();
    return preview;
  }

  get zoom(): number {
    return this.renderer.zoom;
  }

  get selection(): string | null {
    return this.selected;
  }

  /**
   * Applies an update: drops top-level nodes that are gone, replaces the ones sent, loads
   * new fonts. The first update with content fits it into view.
   */
  async apply(update: Update): Promise<void> {
    await this.loadFonts(update.fonts);
    this.scene.apply(update.order, update.roots);
    if (this.hovered && !this.scene.has(this.hovered)) this.hovered = null;
    if (this.selected && !this.scene.has(this.selected)) this.selected = null;
    this.version++;
    this.renderer.fontGeneration = fontManager.generation();
    this.renderer.invalidateAllPictures();
    if (!this.fitted && this.scene.roots.length > 0) {
      this.fitted = true;
      this.fit();
    }
    this.draw();
  }

  /** Matches the canvas to its CSS size and the device pixel ratio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      const surface = this.ck.MakeWebGLCanvasSurface(this.canvas);
      if (surface) this.renderer.replaceSurface(surface);
    }
    this.renderer.dpr = dpr;
    this.renderer.viewportWidth = width;
    this.renderer.viewportHeight = height;
    this.draw();
  }

  /** Moves the view by screen pixels. */
  panBy(dx: number, dy: number): void {
    this.renderer.panX += dx;
    this.renderer.panY += dy;
    this.draw();
  }

  /** Zooms by `factor` keeping the point under (`sx`, `sy`) (CSS pixels) in place. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const r = this.renderer;
    const world = r.screenToCanvas(sx, sy);
    r.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, r.zoom * factor));
    r.panX = sx - world.x * r.zoom;
    r.panY = sy - world.y * r.zoom;
    this.draw();
  }

  /** Fits a node (all top-level nodes by default) into the view; never zooms past 100 %. */
  fit(id?: string): void {
    const box = this.scene.bounds(id === undefined ? undefined : [id]);
    const r = this.renderer;
    if (!box || box.width <= 0 || box.height <= 0) return;
    const zoom = Math.min(
      1,
      (r.viewportWidth - 2 * FIT_MARGIN) / box.width,
      (r.viewportHeight - 2 * FIT_MARGIN) / box.height,
    );
    r.zoom = Math.max(MIN_ZOOM, zoom);
    r.panX = (r.viewportWidth - box.width * r.zoom) / 2 - box.x * r.zoom;
    r.panY = (r.viewportHeight - box.height * r.zoom) / 2 - box.y * r.zoom;
    this.draw();
  }

  /** The deepest node under a point (CSS pixels of the canvas). */
  nodeAt(sx: number, sy: number): string | null {
    const world = this.renderer.screenToCanvas(sx, sy);
    return this.scene.nodeAt(world.x, world.y);
  }

  hover(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.draw();
  }

  select(id: string | null): void {
    this.selected = id !== null && this.scene.has(id) ? id : null;
    this.draw();
  }

  info(id: string): NodeInfo | undefined {
    return this.scene.info(id);
  }

  /** Draws on the next animation frame. */
  draw(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const selected = new Set(this.selected ? [this.selected] : []);
      this.renderer.render(
        this.scene.graph,
        selected,
        { hoveredNodeId: this.hovered },
        this.version,
      );
    });
  }

  /** Loads font files not loaded yet, in the order given (the last of a face is primary). */
  private async loadFonts(files: readonly FontFile[]): Promise<void> {
    const fresh = files.filter((f) => !this.fonts.has(f.id));
    if (fresh.length === 0) return;
    const data = await Promise.all(
      fresh.map(async (font) => {
        const response = await fetch(this.options.fontUrl(font));
        return response.ok ? response.arrayBuffer() : null;
      }),
    );
    fresh.forEach((font, i) => {
      const buffer = data[i];
      if (!buffer) return;
      fontManager.markLoaded(font.family, font.style, buffer);
      this.fonts.add(font.id);
    });
  }
}

export {
  decodeMessage,
  type FontFile,
  type PreviewMessage,
  type RootSnapshot,
} from '../snapshot-codec.ts';
export { type NodeInfo, PreviewScene } from './scene.ts';
