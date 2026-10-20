import {
  autoLayoutSizingFields,
  computeImageHash,
  fillSizingFields,
  type LayoutMode,
  type NodeType,
  paddingFromShorthand,
  SceneGraph,
  type SceneNode,
} from '@open-pencil/scene-graph';
import {
  componentRoot,
  createVariableResolver,
  defaultTheme,
  indexNodes,
  type NodeIndex,
  type PenDocument,
  type PenNode,
  type ThemeContext,
  themeAt,
  type VariableResolver,
  variableName,
} from '@tusche/pen-format';
import { parseHexColor } from './color.ts';
import { fitNetwork, networkBounds, pathNetwork } from './geometry.ts';
import { bundledIcons, type IconProvider } from './icons.ts';
import { expandInstance, type PenObject, pathId } from './instances.ts';
import { convertEffects, convertFills, type ImageStore, type PaintTarget } from './paints.ts';
import { type ProjectionWarning, Scope } from './scope.ts';
import { isFill, parseSize, type SizeSpec } from './sizing.ts';
import { convertStroke } from './strokes.ts';
import { DEFAULT_FONT_SIZE, textFields } from './text.ts';

/** `pluginId` of the data the projection keeps on scene nodes. */
export const PLUGIN_ID = 'tusche';

export interface ProjectOptions {
  /** Bytes of an image referenced by a fill URL (relative to the `.pen` file). */
  loadAsset?: (url: string) => Uint8Array | undefined;
  /** Vector data of icons. Default: bundled Lucide and Phosphor. */
  icons?: IconProvider;
}

export interface ProjectionStats {
  /** Scene nodes created. */
  sceneNodes: number;
  /** Instances expanded. */
  instances: number;
  /** Time spent projecting, ms. */
  ms: number;
}

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface Parent {
  id: string;
  /** Layout the parent applies to its children. */
  layout: LayoutMode;
  /** Path prefix of the enclosing instance, if any. */
  prefix: string | undefined;
}

const LAYOUTS: Record<string, LayoutMode> = {
  none: 'NONE',
  horizontal: 'HORIZONTAL',
  vertical: 'VERTICAL',
};
const JUSTIFY: Record<string, SceneNode['primaryAxisAlign']> = {
  start: 'MIN',
  center: 'CENTER',
  end: 'MAX',
  space_between: 'SPACE_BETWEEN',
  space_around: 'SPACE_BETWEEN',
};
const ALIGN: Record<string, SceneNode['counterAxisAlign']> = {
  start: 'MIN',
  center: 'CENTER',
  end: 'MAX',
};

const MAX_INSTANCE_DEPTH = 64;

/**
 * The scene graph of a `.pen` document (ADR-007). Top-level nodes are projected on demand
 * with {@link PenProjection.project}; scene node ids are pen paths: a node's own id, or
 * `instanceId/childId/…` inside instances. Helper nodes the projection adds (icon vectors,
 * placeholder labels) get ids with `#`, which never occurs in `.pen`.
 */
export class PenProjection {
  readonly graph = new SceneGraph();
  readonly warnings: ProjectionWarning[] = [];
  readonly stats: ProjectionStats = { sceneNodes: 0, instances: 0, ms: 0 };

  private current: PenDocument;
  private index: NodeIndex;
  private resolver: VariableResolver;
  private rootTheme: ThemeContext;
  private icons: IconProvider;
  private readonly images = new Map<string, string | null>();
  /** Top-level node id → id of the page it is projected on (one page per top-level node). */
  private readonly pages = new Map<string, string>();

  constructor(
    doc: PenDocument,
    private readonly options: ProjectOptions = {},
  ) {
    this.current = doc;
    this.index = indexNodes(doc);
    this.resolver = createVariableResolver(doc);
    this.rootTheme = defaultTheme(doc);
    this.icons = options.icons ?? bundledIcons();
  }

  /** The document the projection reads. */
  get doc(): PenDocument {
    return this.current;
  }

  /**
   * Switches to a new version of the document (edits make a new document object).
   * Projected top-level nodes stay as they are: invalidate the ones that changed.
   * `options` replaces the asset loader or the icon provider when given.
   */
  setDocument(doc: PenDocument, options: ProjectOptions = {}): void {
    this.current = doc;
    this.index = indexNodes(doc);
    this.resolver = createVariableResolver(doc);
    this.rootTheme = defaultTheme(doc);
    this.tops = undefined;
    if (options.icons) this.icons = options.icons;
    if (options.loadAsset) this.options.loadAsset = options.loadAsset;
  }

  /** Ids of the document's top-level nodes, in paint order. */
  get topLevelIds(): string[] {
    return (this.doc.children ?? []).flatMap((n) => (typeof n?.id === 'string' ? [n.id] : []));
  }

  /** Top-level nodes projected so far. */
  get roots(): string[] {
    return this.topLevelIds.filter((id) => this.pages.has(id));
  }

  /** Every projected top-level node, including ones no longer in the current document. */
  get projectedRoots(): string[] {
    return [...this.pages.keys()];
  }

  /**
   * The page a projected top-level node lives on. Every top-level node gets its own page,
   * so that layout and rendering of one does not touch the others.
   */
  pageOf(rootId: string): string | undefined {
    return this.pages.get(rootId);
  }

  /** The top-level node a pen path belongs to (`undefined` for an unknown id). */
  rootOf(path: string): string | undefined {
    const first = path.split(/[/#]/, 1)[0] as string;
    if (!this.tops) {
      this.tops = new Map();
      for (const top of this.doc.children ?? []) {
        if (!isObject(top) || typeof top.id !== 'string') continue;
        const stack: unknown[] = [top];
        while (stack.length > 0) {
          const node = stack.pop();
          if (!isObject(node)) continue;
          if (typeof node.id === 'string' && !this.tops.has(node.id))
            this.tops.set(node.id, top.id);
          if (Array.isArray(node.children)) stack.push(...node.children);
        }
      }
    }
    return this.tops.get(first);
  }

  private tops: Map<string, string> | undefined;

  /** Projects top-level nodes (all by default) that are not projected yet. */
  project(ids: Iterable<string> = this.topLevelIds): this {
    const started = performance.now();
    const wanted = new Set(ids);
    for (const node of this.doc.children ?? []) {
      if (!isObject(node) || typeof node.id !== 'string') continue;
      if (!wanted.has(node.id) || this.pages.has(node.id)) continue;
      const page = this.graph.addPage(node.id);
      this.pages.set(node.id, page.id);
      const parent: Parent = { id: page.id, layout: 'NONE', prefix: undefined };
      const before = this.warnings.length;
      this.emit(node as PenObject, node.id, parent, this.rootTheme, 0);
      for (const warning of this.warnings.slice(before)) this.warningRoots.set(warning, node.id);
    }
    this.stats.ms += performance.now() - started;
    return this;
  }

  /** Drops the scene of a top-level node so that the next `project` rebuilds it. */
  invalidate(id: string): void {
    const page = this.pages.get(id);
    if (page === undefined) return;
    this.pages.delete(id);
    this.graph.deleteNode(page);
    // By what is left in the graph: the node may be gone from the current document.
    this.overlays = this.overlays.filter((o) => this.graph.getNode(o) !== undefined);
    this.warnings.splice(
      0,
      this.warnings.length,
      ...this.warnings.filter((w) => this.warningRoots.get(w) !== id),
    );
  }

  /** Top-level node whose projection reported each warning. */
  private readonly warningRoots = new WeakMap<ProjectionWarning, string>();

  /** The scene node of a pen path, if projected. */
  node(path: string): SceneNode | undefined {
    return this.graph.getNode(path);
  }

  // --- Emission ---------------------------------------------------------------

  private create(
    path: string,
    type: NodeType,
    parent: Parent,
    fields: Partial<SceneNode>,
  ): SceneNode {
    this.stats.sceneNodes++;
    return this.graph.createNodeWithId(path, type, parent.id, fields);
  }

  private childPath(child: PenObject, parent: Parent): string {
    const id = pathId(child);
    return parent.prefix === undefined ? id : `${parent.prefix}/${id}`;
  }

  private emit(
    node: PenObject,
    path: string,
    parent: Parent,
    inherited: ThemeContext,
    depth: number,
  ): void {
    const theme = themeAt(inherited, node.theme);
    const scope = new Scope(path, theme, this.resolver, this.warnings);
    if (!scope.bool(node.enabled, true)) return;

    if (node.type === 'ref') {
      if (depth >= MAX_INSTANCE_DEPTH) {
        scope.warn('depth-limit', 'Instances are nested too deeply');
        return;
      }
      const expansion = expandInstance(this.index, node);
      if (!expansion) {
        scope.warn('unknown-ref', `Component "${String(node.ref)}" is not found`);
        return;
      }
      for (const key of expansion.unresolved) {
        scope.warn('unknown-ref', `Descendant "${key}" is not found in "${String(node.ref)}"`);
      }
      this.stats.instances++;
      // Children of the expanded root are addressed through this instance.
      this.emitNode(expansion.root, path, parent, inherited, depth + 1, path);
      return;
    }
    this.emitNode(node, path, parent, inherited, depth, parent.prefix);
  }

  private emitNode(
    node: PenObject,
    path: string,
    parent: Parent,
    inherited: ThemeContext,
    depth: number,
    prefix: string | undefined,
  ): void {
    const theme = themeAt(inherited, node.theme);
    const scope = new Scope(path, theme, this.resolver, this.warnings);
    if (!scope.bool(node.enabled, true)) return;

    switch (node.type) {
      case 'frame':
        this.frame(node, scope, parent, depth, prefix);
        break;
      case 'group':
        this.group(node, scope, parent, depth, prefix);
        break;
      case 'text':
        this.text(node, scope, parent);
        break;
      case 'rectangle':
      case 'ellipse':
      case 'polygon':
      case 'path':
        this.shape(node, scope, parent);
        break;
      case 'icon':
        this.icon(node, scope, parent);
        break;
      case 'note':
      case 'prompt':
      case 'context':
        this.annotation(node, scope, parent);
        break;
      case 'script':
      case 'browser':
        this.placeholder(node, scope, parent);
        break;
      case 'ref':
        this.emit(node, path, parent, inherited, depth);
        break;
      default:
        scope.warn('unsupported', `Unknown node type "${String(node.type)}"`);
    }
  }

  private emitChildren(node: PenObject, scope: Scope, self: Parent, depth: number): void {
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (!isObject(child)) continue;
      this.emit(child, this.childPath(child, self), self, scope.theme, depth);
    }
  }

  // --- Common fields ------------------------------------------------------------

  /** Fields every node has: name, position, opacity, rotation, flips, variable names. */
  private base(node: PenObject, scope: Scope, parent: Parent, size: { w: number; h: number }) {
    const absolute = scope.str(node.layoutPosition) === 'absolute';
    const flex = parent.layout !== 'NONE';
    const fields: Partial<SceneNode> = {
      name: typeof node.name === 'string' ? node.name : String(node.type),
      opacity: Math.min(1, Math.max(0, scope.num(node.opacity, 1))),
      flipX: scope.bool(node.flipX, false),
      flipY: scope.bool(node.flipY, false),
    };
    let x = 0;
    let y = 0;
    if (!flex || absolute) {
      x = scope.num(node.x, 0);
      y = scope.num(node.y, 0);
    }
    if (flex && absolute) fields.layoutPositioning = 'ABSOLUTE';
    const degrees = scope.num(node.rotation, 0);
    if (degrees !== 0) {
      // `.pen`: counter-clockwise around the top-left corner. Scene: clockwise around the center.
      const rotation = -degrees;
      const rad = (rotation * Math.PI) / 180;
      const cx = size.w / 2;
      const cy = size.h / 2;
      x += cx * Math.cos(rad) - cy * Math.sin(rad) - cx;
      y += cx * Math.sin(rad) + cy * Math.cos(rad) - cy;
      fields.rotation = rotation;
    }
    fields.x = x;
    fields.y = y;
    const bindings = this.bindings(node);
    if (bindings) fields.pluginData = [{ pluginId: PLUGIN_ID, key: 'variables', value: bindings }];
    return fields;
  }

  /** `{"fill": "primary", …}` for properties bound directly to variables. */
  private bindings(node: PenObject): string | undefined {
    let result: Record<string, string> | undefined;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'content' || key === 'id' || key === 'ref') continue;
      const name = variableName(value);
      if (name === undefined || !(name in (this.doc.variables ?? {}))) continue;
      result ??= {};
      result[key] = name;
    }
    return result ? JSON.stringify(result) : undefined;
  }

  private paintTarget(width: number, height: number): PaintTarget {
    return { width, height, images: this.imageStore };
  }

  private readonly imageStore: ImageStore = (url, scope) => {
    const cached = this.images.get(url);
    if (cached !== undefined) return cached ?? undefined;
    const bytes = this.options.loadAsset?.(url);
    if (!bytes) {
      scope.warn('missing-asset', `Image "${url}" is not available`);
      this.images.set(url, null);
      return undefined;
    }
    const hash = computeImageHash(bytes);
    this.graph.images.set(hash, bytes);
    this.images.set(url, hash);
    return hash;
  };

  private cornerFields(value: unknown, scope: Scope): Partial<SceneNode> {
    if (Array.isArray(value)) {
      const [tl, tr, br, bl] = [0, 1, 2, 3].map((i) => scope.num(value[i], 0)) as [
        number,
        number,
        number,
        number,
      ];
      if (tl === tr && tr === br && br === bl) return { cornerRadius: tl };
      return {
        independentCorners: true,
        cornerRadius: Math.max(tl, tr, br, bl),
        topLeftRadius: tl,
        topRightRadius: tr,
        bottomRightRadius: br,
        bottomLeftRadius: bl,
      };
    }
    const radius = scope.num(value, 0);
    return radius > 0 ? { cornerRadius: radius } : {};
  }

  /**
   * Size of a node that is not an auto-layout container: fixed, or filling the parent's layout.
   * `fit_content` has no meaning without layout and falls back to its fallback value.
   */
  private leafAxis(
    spec: SizeSpec | undefined,
    axis: 'HORIZONTAL' | 'VERTICAL',
    parent: Parent,
    absolute: boolean,
    initial: number,
  ): { size: number; fill: Partial<SceneNode> } {
    if (!spec) return { size: initial, fill: {} };
    if (spec.kind === 'fixed') return { size: spec.value, fill: {} };
    if (spec.kind === 'fill' && parent.layout !== 'NONE' && !absolute) {
      return { size: spec.fallback ?? initial, fill: fillSizingFields(parent.layout, axis) };
    }
    return { size: spec.fallback ?? initial, fill: {} };
  }

  private enabledChildren(node: PenObject, scope: Scope): PenObject[] {
    if (!Array.isArray(node.children)) return [];
    return node.children.filter((c): c is PenObject => isObject(c) && scope.bool(c.enabled, true));
  }

  /** The width or height a child asks for, looking through `ref` to its component. */
  private childSize(child: PenObject, key: 'width' | 'height'): unknown {
    if (child[key] !== undefined) return child[key];
    if (child.type !== 'ref') return child.type === 'frame' ? 'fit_content' : undefined;
    const root = componentRoot(this.index, child as unknown as PenNode) as PenObject | undefined;
    if (!root) return undefined;
    return root[key] ?? (root.type === 'frame' ? 'fit_content' : undefined);
  }

  // --- Node types -------------------------------------------------------------------

  private frame(node: PenObject, scope: Scope, parent: Parent, depth: number, prefix?: string) {
    const layout = LAYOUTS[scope.str(node.layout) ?? 'horizontal'] ?? 'HORIZONTAL';
    const absolute = scope.str(node.layoutPosition) === 'absolute';
    const children = this.enabledChildren(node, scope);
    const flowChildren = children.filter((c) => scope.str(c.layoutPosition) !== 'absolute');

    const axis = (key: 'width' | 'height', dir: 'HORIZONTAL' | 'VERTICAL') => {
      const spec = parseSize(node[key] ?? 'fit_content', scope) ?? {
        kind: 'fit' as const,
        fallback: undefined,
      };
      if (spec.kind === 'fixed') return { size: spec.value, mode: 'FIXED' as const, fill: {} };
      if (spec.kind === 'fill') {
        const leaf = this.leafAxis(spec, dir, parent, absolute, 0);
        return { size: leaf.size, mode: 'FIXED' as const, fill: leaf.fill };
      }
      // fit_content
      if (layout === 'NONE' || flowChildren.length === 0) {
        return { size: spec.fallback ?? 0, mode: 'FIXED' as const, fill: {} };
      }
      const circular = flowChildren.every((c) => isFill(parseSize(this.childSize(c, key), scope)));
      if (circular) {
        scope.warn(
          'circular-size',
          `${key} is fit_content but every child fills it; using ${spec.fallback ?? 0}`,
        );
        return { size: spec.fallback ?? 0, mode: 'FIXED' as const, fill: {} };
      }
      return { size: spec.fallback ?? 0, mode: 'HUG' as const, fill: {} };
    };
    const w = axis('width', 'HORIZONTAL');
    const h = axis('height', 'VERTICAL');
    const target = this.paintTarget(w.size, h.size);

    const fields: Partial<SceneNode> = {
      ...this.base(node, scope, parent, { w: w.size, h: h.size }),
      width: w.size,
      height: h.size,
      ...w.fill,
      ...h.fill,
      fills: convertFills(node.fill, scope, target),
      ...convertStroke(node, scope, target),
      effects: convertEffects(node.effect, scope),
      ...this.cornerFields(node.cornerRadius, scope),
      clipsContent: scope.bool(node.clip, false),
      layoutMode: layout,
    };
    if (layout !== 'NONE') {
      Object.assign(fields, autoLayoutSizingFields(layout, w.mode, h.mode));
      fields.itemSpacing = scope.num(node.gap, 0);
      const padding = Array.isArray(node.padding)
        ? node.padding.map((v) => scope.num(v, 0))
        : [scope.num(node.padding, 0)];
      Object.assign(fields, paddingFromShorthand(padding));
      const justify = scope.str(node.justifyContent) ?? 'start';
      if (justify === 'space_around') {
        scope.warn('approximated', 'justifyContent "space_around" is drawn as "space_between"');
      }
      fields.primaryAxisAlign = JUSTIFY[justify] ?? 'MIN';
      if (fields.primaryAxisAlign === 'SPACE_BETWEEN' && (fields.itemSpacing ?? 0) > 0) {
        // In `.pen` (as in CSS) the gap stays the minimum spacing with space_between;
        // OpenPencil drops it like Figma does. Our patch of its layout keeps it for this mark.
        fields.pluginData = [
          ...(fields.pluginData ?? []),
          { pluginId: PLUGIN_ID, key: 'cssGap', value: '1' },
        ];
      }
      fields.counterAxisAlign = ALIGN[scope.str(node.alignItems) ?? 'start'] ?? 'MIN';
      const mainKey = layout === 'HORIZONTAL' ? 'width' : 'height';
      const filling = flowChildren.filter((c) =>
        isFill(parseSize(this.childSize(c, mainKey), scope)),
      );
      if (filling.length > 1) {
        // Fill children share the free space equally, padded or not (see the layout patch).
        fields.pluginData = [
          ...(fields.pluginData ?? []),
          { pluginId: PLUGIN_ID, key: 'equalFill', value: '1' },
        ];
      }
      fields.strokesIncludedInLayout = scope.bool(node.layoutIncludeStroke, false);
    }
    // OpenPencil draws a frame's stroke under its children; pen.dev (like Figma) draws it on
    // top. Move the stroke to an overlay drawn after the children. A clipped frame keeps an
    // outer or centered stroke itself, since the overlay would be clipped.
    const overlay =
      (fields.strokes?.length ?? 0) > 0 &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      (!fields.clipsContent || fields.strokeAlign === 'INSIDE');
    const strokeFields = overlay ? this.takeStroke(fields) : undefined;
    this.create(scope.path, 'FRAME', parent, fields);
    this.emitChildren(node, scope, { id: scope.path, layout, prefix }, depth);
    if (strokeFields) {
      const id = `${scope.path}#stroke`;
      this.create(
        id,
        'FRAME',
        { id: scope.path, layout, prefix },
        {
          ...strokeFields,
          name: 'stroke',
          width: fields.width ?? 0,
          height: fields.height ?? 0,
          fills: [],
          layoutMode: 'NONE',
          ...(layout !== 'NONE' ? { layoutPositioning: 'ABSOLUTE' as const } : {}),
          cornerRadius: fields.cornerRadius ?? 0,
          independentCorners: fields.independentCorners ?? false,
          topLeftRadius: fields.topLeftRadius ?? 0,
          topRightRadius: fields.topRightRadius ?? 0,
          bottomRightRadius: fields.bottomRightRadius ?? 0,
          bottomLeftRadius: fields.bottomLeftRadius ?? 0,
        },
      );
      this.overlays.push(id);
    }
  }

  /** Removes the stroke fields from `fields` and returns them. */
  private takeStroke(fields: Partial<SceneNode>): Partial<SceneNode> {
    const keys = [
      'strokes',
      'strokeWeight',
      'strokeAlign',
      'strokeCap',
      'strokeJoin',
      'dashPattern',
      'independentStrokeWeights',
      'borderTopWeight',
      'borderRightWeight',
      'borderBottomWeight',
      'borderLeftWeight',
    ] as const;
    const taken: Partial<SceneNode> = {};
    for (const key of keys) {
      if (fields[key] === undefined) continue;
      Object.assign(taken, { [key]: fields[key] });
      delete fields[key];
    }
    return taken;
  }

  /**
   * Stroke overlays (`…#stroke`) take the size of their frame. Call after layout, which may
   * have resized the frames.
   */
  syncOverlays(): void {
    for (const id of this.overlays) {
      const overlay = this.graph.getNode(id);
      const frame = overlay?.parentId ? this.graph.getNode(overlay.parentId) : undefined;
      if (!overlay || !frame) continue;
      if (
        overlay.width !== frame.width ||
        overlay.height !== frame.height ||
        overlay.x ||
        overlay.y
      ) {
        this.graph.updateNode(id, { x: 0, y: 0, width: frame.width, height: frame.height });
      }
    }
  }

  private overlays: string[] = [];

  private group(node: PenObject, scope: Scope, parent: Parent, depth: number, prefix?: string) {
    const fields: Partial<SceneNode> = {
      ...this.base(node, scope, parent, { w: 0, h: 0 }),
      effects: convertEffects(node.effect, scope),
    };
    this.create(scope.path, 'GROUP', parent, fields);
    this.emitChildren(node, scope, { id: scope.path, layout: 'NONE', prefix }, depth);
    // A group is as large as its children.
    const group = this.graph.getNode(scope.path);
    if (!group) return;
    let right = 0;
    let bottom = 0;
    for (const id of group.childIds) {
      const child = this.graph.getNode(id);
      if (!child) continue;
      right = Math.max(right, child.x + child.width);
      bottom = Math.max(bottom, child.y + child.height);
    }
    this.graph.updateNode(scope.path, { width: right, height: bottom });
  }

  private text(node: PenObject, scope: Scope, parent: Parent) {
    const growth = scope.str(node.textGrowth) ?? 'auto';
    const absolute = scope.str(node.layoutPosition) === 'absolute';
    const fields: Partial<SceneNode> = { ...textFields(node, scope) };
    let width = 0;
    let height = 0;
    if (growth === 'auto') {
      fields.textAutoResize = 'WIDTH_AND_HEIGHT';
    } else {
      const w = this.leafAxis(parseSize(node.width, scope), 'HORIZONTAL', parent, absolute, 0);
      width = w.size;
      Object.assign(fields, w.fill);
      if (growth === 'fixed-width-height') {
        const h = this.leafAxis(parseSize(node.height, scope), 'VERTICAL', parent, absolute, 0);
        height = h.size;
        Object.assign(fields, h.fill);
        fields.textAutoResize = 'NONE';
      } else {
        fields.textAutoResize = 'HEIGHT';
      }
    }
    const target = this.paintTarget(width, height);
    Object.assign(fields, {
      ...this.base(node, scope, parent, { w: width, h: height }),
      width,
      height,
      // Text has no default fill in `.pen`: without one it is invisible.
      fills: convertFills(node.fill, scope, target),
      ...convertStroke(node, scope, target),
      effects: convertEffects(node.effect, scope),
    });
    this.create(scope.path, 'TEXT', parent, fields);
  }

  private shape(node: PenObject, scope: Scope, parent: Parent) {
    const absolute = scope.str(node.layoutPosition) === 'absolute';
    let network: SceneNode['vectorNetwork'] = null;
    let natural = { width: 0, height: 0 };
    let viewBox: { x: number; y: number; width: number; height: number } | undefined;
    if (node.type === 'path') {
      const d = scope.str(node.geometry) ?? '';
      const rule = scope.str(node.fillRule) === 'evenodd' ? 'EVENODD' : 'NONZERO';
      network = pathNetwork(d, rule, node.fill !== undefined);
      const box = Array.isArray(node.viewBox)
        ? (() => {
            const [x, y, w, h] = node.viewBox.map((v) => scope.num(v, 0)) as number[];
            return { x: x ?? 0, y: y ?? 0, width: w ?? 0, height: h ?? 0 };
          })()
        : networkBounds(network);
      viewBox = box;
      if (box) natural = { width: box.width, height: box.height };
    }
    const w = this.leafAxis(
      parseSize(node.width, scope),
      'HORIZONTAL',
      parent,
      absolute,
      natural.width,
    );
    const h = this.leafAxis(
      parseSize(node.height, scope),
      'VERTICAL',
      parent,
      absolute,
      natural.height,
    );
    const target = this.paintTarget(w.size, h.size);

    const type: NodeType =
      node.type === 'rectangle'
        ? 'RECTANGLE'
        : node.type === 'ellipse'
          ? 'ELLIPSE'
          : node.type === 'polygon'
            ? 'POLYGON'
            : 'VECTOR';
    const fields: Partial<SceneNode> = {
      ...this.base(node, scope, parent, { w: w.size, h: h.size }),
      width: w.size,
      height: h.size,
      ...w.fill,
      ...h.fill,
      fills: convertFills(node.fill, scope, target),
      ...convertStroke(node, scope, target),
      effects: convertEffects(node.effect, scope),
    };
    if (type === 'RECTANGLE') Object.assign(fields, this.cornerFields(node.cornerRadius, scope));
    if (type === 'POLYGON') {
      fields.pointCount = Math.max(3, Math.round(scope.num(node.polygonCount, 3)));
      fields.cornerRadius = scope.num(node.cornerRadius, 0);
    }
    if (type === 'ELLIPSE') {
      const inner = Math.min(1, Math.max(0, scope.num(node.innerRadius, 0)));
      const start = scope.num(node.startAngle, 0);
      const sweep = Math.max(-360, Math.min(360, scope.num(node.sweepAngle, 360)));
      if (inner > 0 || Math.abs(sweep) < 360) {
        // `.pen`: degrees counter-clockwise from the right. Scene: radians clockwise.
        const a = (-start * Math.PI) / 180;
        const b = (-(start + sweep) * Math.PI) / 180;
        fields.arcData = {
          startingAngle: Math.min(a, b),
          endingAngle: Math.max(a, b),
          innerRadius: inner,
        };
      }
    }
    if (type === 'VECTOR' && network && viewBox) {
      fields.vectorNetwork = fitNetwork(network, viewBox, {
        x: 0,
        y: 0,
        width: w.size,
        height: h.size,
      });
    }
    this.create(scope.path, type, parent, fields);
  }

  private icon(node: PenObject, scope: Scope, parent: Parent) {
    const absolute = scope.str(node.layoutPosition) === 'absolute';
    const w = this.leafAxis(parseSize(node.width, scope), 'HORIZONTAL', parent, absolute, 24);
    const h = this.leafAxis(parseSize(node.height, scope), 'VERTICAL', parent, absolute, 24);
    const frame: Partial<SceneNode> = {
      ...this.base(node, scope, parent, { w: w.size, h: h.size }),
      width: w.size,
      height: h.size,
      ...w.fill,
      ...h.fill,
      fills: [],
      effects: convertEffects(node.effect, scope),
      layoutMode: 'NONE',
    };
    const library = scope.str(node.library) ?? '';
    const name = scope.str(node.icon) ?? '';
    const weight = scope.num(node.weight);
    const data = this.icons.get(library, name, weight);
    if (!data) {
      scope.warn('unknown-icon', `Icon "${library}:${name}" is not available`);
      this.create(scope.path, 'FRAME', parent, {
        ...frame,
        ...convertStroke(
          { stroke: '#9E9E9E80', strokeWidth: 1 },
          scope,
          this.paintTarget(w.size, h.size),
        ),
      });
      return;
    }
    this.create(scope.path, 'FRAME', parent, frame);
    // Fit the view box into the node box, keeping proportions, centered.
    const scale = Math.min(w.size / (data.width || 1), h.size / (data.height || 1));
    const box = {
      x: (w.size - data.width * scale) / 2,
      y: (h.size - data.height * scale) / 2,
      width: data.width * scale,
      height: data.height * scale,
    };
    const from = { x: data.left, y: data.top, width: data.width, height: data.height };
    const self: Parent = { id: scope.path, layout: 'NONE', prefix: undefined };
    const target = this.paintTarget(w.size, h.size);
    const paints = convertFills(node.fill ?? '#000000', scope, target);
    data.shapes.forEach((shape, i) => {
      const filled = shape.fill !== undefined;
      const rule = shape.fillRule === 'evenodd' ? 'EVENODD' : 'NONZERO';
      const network = fitNetwork(pathNetwork(shape.d, rule, filled), from, box);
      const paintOf = (value: string | undefined) => {
        if (value === undefined) return [];
        if (value === 'current') return paints;
        const c = parseHexColor(value);
        return c
          ? [{ type: 'SOLID' as const, color: { ...c, a: 1 }, opacity: c.a, visible: true }]
          : paints;
      };
      const strokePaints = paintOf(shape.stroke);
      const weightPx = shape.strokeWidth * scale;
      this.create(`${scope.path}#${i}`, 'VECTOR', self, {
        name: `${name} ${i}`,
        x: 0,
        y: 0,
        width: w.size,
        height: h.size,
        vectorNetwork: network,
        fills: paintOf(shape.fill),
        strokes: strokePaints.map((p) => ({ ...p, weight: weightPx, align: 'CENTER' as const })),
        strokeWeight: weightPx,
        strokeAlign: 'CENTER',
        strokeCap:
          shape.strokeLinecap === 'round'
            ? 'ROUND'
            : shape.strokeLinecap === 'square'
              ? 'SQUARE'
              : 'NONE',
        strokeJoin:
          shape.strokeLinejoin === 'round'
            ? 'ROUND'
            : shape.strokeLinejoin === 'bevel'
              ? 'BEVEL'
              : 'MITER',
      });
    });
  }

  /** `note`, `prompt`, `context`: a sticky-note card with the text. */
  private annotation(node: PenObject, scope: Scope, parent: Parent) {
    scope.warn('stub', `"${String(node.type)}" is shown as a card`);
    const absolute = scope.str(node.layoutPosition) === 'absolute';
    const w = this.leafAxis(parseSize(node.width, scope), 'HORIZONTAL', parent, absolute, 240);
    const h = this.leafAxis(parseSize(node.height, scope), 'VERTICAL', parent, absolute, 120);
    const tint =
      node.type === 'prompt' ? '#E8F0FF' : node.type === 'context' ? '#EAF7EC' : '#FFF4C2';
    const target = this.paintTarget(w.size, h.size);
    this.create(scope.path, 'FRAME', parent, {
      ...this.base(node, scope, parent, { w: w.size, h: h.size }),
      width: w.size,
      height: h.size,
      ...w.fill,
      ...h.fill,
      fills: convertFills(tint, scope, target),
      ...convertStroke({ stroke: '#00000026', strokeWidth: 1 }, scope, target),
      cornerRadius: 6,
      clipsContent: true,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      itemSpacing: 6,
      ...paddingFromShorthand([12]),
    });
    const self: Parent = { id: scope.path, layout: 'VERTICAL', prefix: undefined };
    const label = String(node.type).toUpperCase();
    this.label(`${scope.path}#type`, label, self, scope, { fontSize: 10, fontWeight: 700 });
    const style = textFields(node, scope);
    this.label(`${scope.path}#text`, style.text, self, scope, {
      ...style,
      fontSize: style.fontSize || DEFAULT_FONT_SIZE,
    });
  }

  /** `script`, `browser`: a frame of the right size with a dashed outline and a label. */
  private placeholder(node: PenObject, scope: Scope, parent: Parent) {
    scope.warn('stub', `"${String(node.type)}" is shown as a placeholder`);
    const absolute = scope.str(node.layoutPosition) === 'absolute';
    const w = this.leafAxis(parseSize(node.width, scope), 'HORIZONTAL', parent, absolute, 320);
    const h = this.leafAxis(parseSize(node.height, scope), 'VERTICAL', parent, absolute, 240);
    const target = this.paintTarget(w.size, h.size);
    const stroke = convertStroke({ stroke: '#8A8A8A', strokeWidth: 1 }, scope, target);
    this.create(scope.path, 'FRAME', parent, {
      ...this.base(node, scope, parent, { w: w.size, h: h.size }),
      width: w.size,
      height: h.size,
      ...w.fill,
      ...h.fill,
      fills: convertFills('#F2F2F2', scope, target),
      ...stroke,
      strokes: (stroke.strokes ?? []).map((s) => ({ ...s, dashPattern: [6, 4] })),
      dashPattern: [6, 4],
      ...this.cornerFields(node.cornerRadius, scope),
      clipsContent: true,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'CENTER',
    });
    const detail =
      node.type === 'browser' ? (scope.str(node.url) ?? '') : (scope.str(node.scriptUri) ?? '');
    const text = detail ? `${String(node.type)} · ${detail}` : String(node.type);
    this.label(
      `${scope.path}#label`,
      text,
      { id: scope.path, layout: 'VERTICAL', prefix: undefined },
      scope,
      {
        fontSize: 12,
        textAlignHorizontal: 'CENTER',
      },
    );
  }

  private label(
    id: string,
    text: string,
    parent: Parent,
    scope: Scope,
    style: Partial<SceneNode>,
  ): void {
    this.create(id, 'TEXT', parent, {
      name: 'label',
      text,
      fontFamily: 'Inter',
      fontWeight: 400,
      fontSize: 12,
      ...style,
      fills: convertFills('#333333', scope, this.paintTarget(0, 0)),
      textAutoResize: 'HEIGHT',
      ...fillSizingFields(parent.layout, 'HORIZONTAL'),
    });
  }
}

/** Projects a document (all top-level nodes by default) into a new scene graph. */
export function projectDocument(
  doc: PenDocument,
  options: ProjectOptions & { roots?: Iterable<string> } = {},
): PenProjection {
  const projection = new PenProjection(doc, options);
  projection.project(options.roots);
  return projection;
}
