import { SkiaRenderer } from '@open-pencil/core/canvas';
import { renderNodesToHTML } from '@open-pencil/core/io/formats/html';
import {
  comparePNGs,
  computeContentBounds,
  createCanvasKitRasterCodec,
  initCanvasKit,
  renderNodesToImage,
} from '@open-pencil/core/io/formats/raster';
import { renderNodesToSVG } from '@open-pencil/core/io/formats/svg';
import {
  computeAllLayouts,
  installTextMeasurer,
  layoutAuthoredNodes,
} from '@open-pencil/core/layout';
import {
  collectGraphFontRequirements,
  collectNodeFontFaces,
  fontManager,
  prepareGraphFonts,
} from '@open-pencil/core/text';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { type IconProvider, PenProjection, type ProjectionWarning } from '@tusche/pen-bridge';
import type { PenDocument } from '@tusche/pen-format';
import { defaultCacheDir } from './cache.ts';
import { configureFonts } from './fonts.ts';
import { type LintOptions, lintScene, type SceneLintMessage } from './lint.ts';
import {
  type AssetLoader,
  createAssetLoader,
  createIconProvider,
  documentCharacters,
} from './resources.ts';

type CanvasKit = Awaited<ReturnType<typeof initCanvasKit>>;

export interface EngineOptions {
  /** Cache of downloaded fonts and icons. Default `$TUSCHE_CACHE_DIR` or `~/.cache/tusche`. */
  cacheDir?: string;
  /** Download fonts and icons that are not cached. Default `true`. */
  allowNetwork?: boolean;
}

export interface OpenOptions {
  /** Directory of the `.pen` file: image URLs resolve against it. */
  baseDir?: string;
  /** Fetch `http(s)` images. Default `false`. */
  allowRemoteAssets?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeBounds extends Rect {
  /** Position on the canvas (top-level coordinates). */
  absolute: Rect;
}

export interface LayoutReport {
  /** Top-level nodes laid out by this call. */
  roots: string[];
  /** Fonts used by the text are available (otherwise a fallback face was used). */
  fontsFaithful: boolean;
  /** Font faces that were not available. */
  missingFonts: string[];
  /** Time spent: projection, loading fonts, layout (ms). */
  timings: { project: number; fonts: number; layout: number };
  ms: number;
}

export interface RenderOptions {
  /** Pixel ratio. Default 1. */
  scale?: number;
  /** The longer side of the image is limited to this many pixels. Default 1600. */
  maxSide?: number;
}

/** File formats of {@link Scene.export}. */
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf' | 'html-tailwind';

export interface ExportOptions {
  /** Pixel ratio of raster formats. Default 1. */
  scale?: number;
  /** The longer side of a raster image is limited to this many pixels. No limit by default. */
  maxSide?: number;
}

/** A node that a clipping ancestor cuts. */
export interface Clipping {
  state: 'partially clipped' | 'fully clipped';
  /** Pen path of the clipping ancestor. */
  by: string;
}

export interface Comparison {
  width: number;
  height: number;
  changedPixels: number;
  /** Share of changed pixels, 0..1. `1` when the images have different sizes. */
  ratio: number;
  /** PNG with the changed pixels highlighted over transparency, when there are any. */
  diff?: Uint8Array;
}

/**
 * Headless OpenPencil: the only place in Tusche that uses `@open-pencil/core` (ADR-001).
 * CanvasKit and fonts are loaded once per engine and stay warm between renders.
 */
export class Engine {
  private constructor(
    readonly ck: CanvasKit,
    readonly renderer: SkiaRenderer,
    readonly options: Required<EngineOptions>,
  ) {}

  static async create(options: EngineOptions = {}): Promise<Engine> {
    const resolved: Required<EngineOptions> = {
      cacheDir: options.cacheDir ?? defaultCacheDir(),
      allowNetwork: options.allowNetwork ?? true,
    };
    configureFonts(resolved);
    const ck = await initCanvasKit();
    const surface = ck.MakeSurface(1, 1);
    if (!surface) throw new Error('Failed to create a CanvasKit surface');
    const renderer = new SkiaRenderer(ck, surface);
    renderer.viewportWidth = 1;
    renderer.viewportHeight = 1;
    renderer.dpr = 1;
    await renderer.loadFonts();
    return new Engine(ck, renderer, resolved);
  }

  /** Opens a document. Nothing is projected until a node is laid out or rendered. */
  async open(doc: PenDocument, options: OpenOptions = {}): Promise<Scene> {
    const [loadAsset, icons] = await Promise.all([
      createAssetLoader(doc, options),
      createIconProvider(doc, this.options),
    ]);
    const projection = new PenProjection(doc, { loadAsset, icons });
    return new Scene(this, projection, documentCharacters(doc), { options, loadAsset, icons });
  }

  /** Pixel comparison of two PNGs (pixelmatch through OpenPencil's `comparePNGs`). */
  compare(before: Uint8Array, after: Uint8Array, threshold = 0.1): Comparison {
    const codec = createCanvasKitRasterCodec(this.ck);
    const result = comparePNGs(codec, before, after, { threshold });
    if (!result) {
      const a = codec.decode(before);
      const b = codec.decode(after);
      return {
        width: Math.max(a?.width ?? 0, b?.width ?? 0),
        height: Math.max(a?.height ?? 0, b?.height ?? 0),
        changedPixels: Number.POSITIVE_INFINITY,
        ratio: 1,
      };
    }
    const comparison: Comparison = {
      width: result.width,
      height: result.height,
      changedPixels: result.changedPixels,
      ratio: result.totalPixels > 0 ? result.changedPixels / result.totalPixels : 0,
    };
    if (result.mask) comparison.diff = result.mask;
    return comparison;
  }
}

/** A document opened in the engine: layout, bounds by pen path, PNG rendering. */
export class Scene {
  private readonly laidOut = new Set<string>();
  private resources: SceneResources;

  constructor(
    readonly engine: Engine,
    readonly projection: PenProjection,
    /**
     * Every character the document may show. Web fonts are subset to the characters asked
     * for; asking for all of them at once lets every top-level node (and the disk cache of
     * the next run) reuse the same download.
     */
    private characters = '',
    resources: SceneResources = { options: {} },
  ) {
    this.resources = resources;
  }

  get warnings(): readonly ProjectionWarning[] {
    return this.projection.warnings;
  }

  /** The document the scene shows. */
  get doc(): PenDocument {
    return this.projection.doc;
  }

  /**
   * Switches to a new version of the document. `roots` are the top-level nodes that
   * changed (or were added or removed); they are projected again on the next layout.
   * Fonts, icons and remote images that the changed nodes need are added.
   */
  async update(doc: PenDocument, roots: Iterable<string> | 'all'): Promise<void> {
    const changed = roots === 'all' ? undefined : new Set(roots);
    const children = (doc.children ?? []).filter(
      (node) => changed === undefined || changed.has(node.id),
    );
    const part = { ...doc, children } as PenDocument;
    const { options, icons, loadAsset } = this.resources;
    const [assets, iconProvider] = await Promise.all([
      options.allowRemoteAssets ? createAssetLoader(part, options, loadAsset) : loadAsset,
      icons ? createIconProvider(part, this.engine.options, icons) : undefined,
    ]);
    this.resources = { options, loadAsset: assets, icons: iconProvider };
    this.characters = mergeCharacters(this.characters, documentCharacters(part));

    const projectionOptions: { icons?: IconProvider; loadAsset?: AssetLoader } = {};
    if (iconProvider) projectionOptions.icons = iconProvider;
    if (assets) projectionOptions.loadAsset = assets;
    this.projection.setDocument(doc, projectionOptions);
    const stale = changed ?? new Set([...this.laidOut, ...this.projection.projectedRoots]);
    for (const id of stale) this.invalidate(id);
  }

  /** The top-level node is laid out: sync reads ({@link boundsSync}, …) see final sizes. */
  isLaidOut(rootId: string): boolean {
    return this.laidOut.has(rootId);
  }

  /** Projects and lays out top-level nodes (all by default) that are not laid out yet. */
  async layout(roots: Iterable<string> = this.projection.topLevelIds): Promise<LayoutReport> {
    const started = performance.now();
    const todo = [...new Set(roots)].filter((id) => !this.laidOut.has(id));
    this.projection.project(todo);
    const projected = performance.now();
    let fontsDone = projected;
    const graph = this.projection.graph;
    const present = todo.filter((id) => graph.getNode(id));
    const missing = new Set<string>();
    let faithful = true;
    if (present.length > 0) {
      const faces = collectGraphFontRequirements(graph, present).nodes.flatMap(
        collectNodeFontFaces,
      );
      const unique = new Map(faces.map((face) => [`${face.family}\0${face.style}`, face]));
      await Promise.all(
        [...unique.values()].map((face) =>
          fontManager.loadFont(face.family, face.style, this.characters),
        ),
      );
      const status = await prepareGraphFonts(graph, present);
      faithful = status.faithful;
      for (const issue of status.issues) missing.add(`${issue.family} ${issue.style}`);
      fontsDone = performance.now();
      const { renderer } = this.engine;
      // `textGrowth: auto` text never wraps in `.pen`, even when it overflows its parent.
      const uninstall = installTextMeasurer((node, maxWidth) =>
        renderer.measureTextNode(
          node,
          node.textAutoResize === 'WIDTH_AND_HEIGHT' ? undefined : maxWidth,
        ),
      );
      try {
        for (const id of present) {
          graph.applyDerivedLayoutDuring(() => layoutAuthoredNodes(graph, [id]));
          if (resetStaleStretch(graph, id)) {
            graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph, id));
          }
        }
        this.projection.syncOverlays();
      } finally {
        uninstall();
      }
    }
    for (const id of todo) this.laidOut.add(id);
    return {
      roots: present,
      fontsFaithful: faithful,
      missingFonts: [...missing],
      timings: {
        project: projected - started,
        fonts: fontsDone - projected,
        layout: performance.now() - fontsDone,
      },
      ms: performance.now() - started,
    };
  }

  /** Forgets a top-level node: the next layout or render projects it again from the document. */
  invalidate(rootId: string): void {
    this.laidOut.delete(rootId);
    this.projection.invalidate(rootId);
  }

  /** Resolved bounds of a node by pen path: in its parent's space and on the canvas. */
  async bounds(path: string): Promise<NodeBounds | undefined> {
    const root = this.projection.rootOf(path);
    if (root === undefined) return undefined;
    await this.layout([root]);
    return this.boundsSync(path);
  }

  /** {@link bounds} for a node whose top-level node is already laid out. */
  boundsSync(path: string): NodeBounds | undefined {
    const node = this.projection.node(path);
    if (!node) return undefined;
    const absolute = this.projection.graph.getAbsoluteBounds(path);
    return {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      absolute: { x: absolute.x, y: absolute.y, width: absolute.width, height: absolute.height },
    };
  }

  /** Whether an ancestor with `clip` cuts the node, and which one. */
  async clipping(path: string): Promise<Clipping | undefined> {
    const root = this.projection.rootOf(path);
    if (root === undefined) return undefined;
    await this.layout([root]);
    return this.clippingSync(path);
  }

  /** {@link clipping} for a node whose top-level node is already laid out. */
  clippingSync(path: string): Clipping | undefined {
    const graph = this.projection.graph;
    const node = graph.getNode(path);
    if (!node?.visible) return undefined;
    const box = graph.getAbsoluteBounds(path);
    if (box.width <= 0 || box.height <= 0) return undefined;
    let partial: Clipping | undefined;
    for (let id = node.parentId; id; ) {
      const ancestor = graph.getNode(id);
      if (!ancestor || ancestor.type === 'CANVAS') break;
      if (ancestor.clipsContent) {
        const overlap = intersect(box, graph.getAbsoluteBounds(id));
        if (overlap.width <= EPSILON || overlap.height <= EPSILON) {
          return { state: 'fully clipped', by: id };
        }
        const cut = overlap.width < box.width - EPSILON || overlap.height < box.height - EPSILON;
        if (cut && !partial) partial = { state: 'partially clipped', by: id };
      }
      id = ancestor.parentId;
    }
    return partial;
  }

  /**
   * Runs the OpenPencil linter on nodes (every top-level node by default), after laying
   * out their top-level nodes.
   */
  async lint(
    paths: Iterable<string> = this.projection.topLevelIds,
    options: LintOptions = {},
  ): Promise<SceneLintMessage[]> {
    const list = [...new Set(paths)];
    const roots = new Set<string>();
    for (const path of list) {
      const root = this.projection.rootOf(path);
      if (root !== undefined) roots.add(root);
    }
    await this.layout(roots);
    const graph = this.projection.graph;
    return lintScene(
      graph,
      list.filter((path) => graph.getNode(path)),
      options,
    );
  }

  /** Renders nodes of one top-level node to PNG. Returns `undefined` for an empty area. */
  async render(
    paths: readonly string[],
    options: RenderOptions = {},
  ): Promise<Uint8Array | undefined> {
    return this.export(paths, 'png', {
      scale: options.scale ?? 1,
      maxSide: options.maxSide ?? 1600,
    });
  }

  /**
   * Exports nodes of one top-level node: PNG, JPEG or WebP, SVG markup or a standalone
   * HTML page with Tailwind classes and inlined assets (both UTF-8). PDF throws for now:
   * OpenPencil makes it in the browser.
   * Returns `undefined` for an empty area.
   */
  async export(
    paths: readonly string[],
    format: ExportFormat,
    options: ExportOptions = {},
  ): Promise<Uint8Array | undefined> {
    const first = paths[0];
    if (first === undefined) return undefined;
    const root = this.projection.rootOf(first);
    if (root === undefined) return undefined;
    if (paths.some((p) => this.projection.rootOf(p) !== root)) {
      throw new Error(`${format} export: all nodes must belong to the same top-level node`);
    }
    await this.layout([root]);
    const pageId = this.projection.pageOf(root);
    const graph = this.projection.graph;
    const ids = paths.filter((p) => graph.getNode(p));
    if (pageId === undefined || ids.length === 0) return undefined;

    if (format === 'svg') {
      const svg = renderNodesToSVG(graph, pageId, ids);
      return svg ? new TextEncoder().encode(svg) : undefined;
    }
    if (format === 'pdf') {
      // OpenPencil converts SVG to PDF through the browser's DOMParser (svg2pdf.js).
      throw new Error(
        'pdf export needs a browser DOM and is not available headless yet; export svg or png',
      );
    }
    if (format === 'html-tailwind') {
      const { html } = await renderNodesToHTML(graph, ids, {
        html: 'standalone',
        style: 'tailwind',
        assets: 'inline',
      });
      return new TextEncoder().encode(html);
    }

    const bounds = computeContentBounds(graph, ids);
    if (!bounds) return undefined;
    const longer = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    let scale = options.scale ?? 1;
    if (options.maxSide !== undefined && longer * scale > options.maxSide) {
      scale = options.maxSide / longer;
    }
    const { ck, renderer } = this.engine;
    renderer.fontGeneration = fontManager.generation();
    renderer.invalidateAllPictures();
    const image = renderNodesToImage(ck, renderer, graph, pageId, ids, {
      scale,
      format: RASTER[format],
    });
    return image ?? undefined;
  }
}

/** Assets of an opened document, kept to add what new versions of it need. */
interface SceneResources {
  options: OpenOptions;
  loadAsset?: AssetLoader | undefined;
  icons?: IconProvider | undefined;
}

const RASTER = { png: 'PNG', jpeg: 'JPG', webp: 'WEBP' } as const;

/** Bounds closer than this are treated as touching (layout works in floats). */
const EPSILON = 0.5;

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y,
  };
}

/** Union of two character sets (sorted, as {@link documentCharacters} returns them). */
function mergeCharacters(a: string, b: string): string {
  const chars = new Set(a);
  const before = chars.size;
  for (const c of b) chars.add(c);
  return chars.size === before ? a : [...chars].sort().join('');
}

/** Creates an engine with a warm CanvasKit. */
export const createEngine = (options?: EngineOptions): Promise<Engine> => Engine.create(options);

/**
 * `layoutAuthoredNodes` lays out twice: before and after measuring text. Sizes that the
 * second pass reads from the first are stale where pen.dev (like CSS) derives them from the
 * final layout:
 * - a child that fills the cross axis of a hugging parent (`fill_container` height in a
 *   `fit_content` row) props the parent open with its first-pass size;
 * - wrapping text that fills its width reports its first-pass width as its content size,
 *   so equal `fill_container` columns come out unequal.
 * Resets these sizes; returns whether a final pass is needed.
 */
function resetStaleStretch(graph: SceneGraph, rootId: string): boolean {
  let reset = false;
  const clear = (id: string, changes: { width?: number; height?: number }) => {
    graph.updateNode(id, changes);
    reset = true;
  };
  const stack = [rootId];
  while (stack.length > 0) {
    const node = graph.getNode(stack.pop() as string);
    if (!node) continue;
    stack.push(...node.childIds);
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined;
    if (!parent || parent.layoutMode === 'NONE' || node.layoutPositioning === 'ABSOLUTE') continue;
    const row = parent.layoutMode === 'HORIZONTAL';
    const stretch = node.layoutAlignSelf === 'STRETCH';
    if (stretch && parent.counterAxisSizing === 'HUG') {
      if (row && node.height !== 0) clear(node.id, { height: 0 });
      else if (!row && node.width !== 0) clear(node.id, { width: 0 });
    }
    const fillsWidth = row ? node.layoutGrow > 0 : stretch;
    if (
      node.type === 'TEXT' &&
      node.textAutoResize === 'HEIGHT' &&
      fillsWidth &&
      node.width !== 0
    ) {
      clear(node.id, { width: 0 });
    }
  }
  return reset;
}
