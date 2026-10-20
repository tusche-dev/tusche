/**
 * TypeScript model of a `.pen` document (schema 2.21).
 *
 * Written from the public format description and observed files; see
 * docs/dev/05-pen-format.md. Every object may carry keys we do not know about:
 * they are preserved on read and write, so the types are open via `PenExtra`.
 */

/** Unknown keys are kept as-is. */
export interface PenExtra {
  [key: string]: unknown;
}

/** `$name` — a reference to a document variable. */
export type VariableRef = `$${string}`;
export type NumberOrVar = number | VariableRef;
export type BooleanOrVar = boolean | VariableRef;
export type StringOrVar = string;
/** `#RGB`, `#RRGGBB`, `#RRGGBBAA` or a variable reference. */
export type ColorOrVar = string;

/** Number, variable, or a sizing mode: `fit_content`, `fill_container`, optionally with a fallback: `fit_content(320)`. */
export type SizeValue = number | string;

/** Theme axis → value, e.g. `{ mode: "dark" }`. */
export type ThemeSelection = Record<string, string>;

export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'linearBurn'
  | 'colorBurn'
  | 'light'
  | 'screen'
  | 'linearDodge'
  | 'colorDodge'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

interface FillBase extends PenExtra {
  enabled?: BooleanOrVar;
  blendMode?: BlendMode;
}

export interface ColorFill extends FillBase {
  type: 'color';
  color: ColorOrVar;
}

export interface GradientFill extends FillBase {
  type: 'gradient';
  gradientType?: 'linear' | 'radial' | 'angular';
  opacity?: NumberOrVar;
  center?: { x?: number; y?: number };
  size?: { width?: NumberOrVar; height?: NumberOrVar };
  rotation?: NumberOrVar;
  colors?: { color: ColorOrVar; position: NumberOrVar }[];
}

export interface ImageFill extends FillBase {
  type: 'image';
  opacity?: NumberOrVar;
  url?: string;
  mode?: 'cover' | 'contain' | 'stretch';
  transform?: [number, number, number, number, number, number];
}

export type ShaderUniforms = Record<string, number | boolean | string | number[]>;

export interface ShaderFill extends FillBase {
  type: 'shader';
  opacity?: NumberOrVar;
  url: string;
  uniforms?: ShaderUniforms;
}

export interface MeshGradientFill extends FillBase {
  type: 'mesh_gradient';
  opacity?: NumberOrVar;
  columns?: number;
  rows?: number;
  colors?: ColorOrVar[];
  points?: unknown[];
}

export type FillObject = ColorFill | GradientFill | ImageFill | ShaderFill | MeshGradientFill;
export type Fill = ColorOrVar | FillObject;
export type Fills = Fill | Fill[];

export type Effect =
  | ({ type: 'blur' | 'background_blur'; enabled?: BooleanOrVar; radius?: NumberOrVar } & PenExtra)
  | ({
      type: 'shadow';
      enabled?: BooleanOrVar;
      shadowType?: 'inner' | 'outer';
      offset?: { x: NumberOrVar; y: NumberOrVar };
      blur?: NumberOrVar;
      color?: ColorOrVar;
      blendMode?: BlendMode;
    } & PenExtra)
  | ({ type: 'shader'; enabled?: BooleanOrVar; url: string; uniforms?: ShaderUniforms } & PenExtra);
export type Effects = Effect | Effect[];

export type Padding =
  | NumberOrVar
  | [NumberOrVar, NumberOrVar]
  | [NumberOrVar, NumberOrVar, NumberOrVar, NumberOrVar];
export type CornerRadius = NumberOrVar | [NumberOrVar, NumberOrVar, NumberOrVar, NumberOrVar];
export type StrokeWidth =
  | NumberOrVar
  | { top?: NumberOrVar; right?: NumberOrVar; bottom?: NumberOrVar; left?: NumberOrVar };

/** Fields shared by every node. */
export interface NodeBase extends PenExtra {
  type: string;
  /** Unique within the document; never contains `/`. */
  id: string;
  name?: string;
  context?: string;
  reusable?: boolean;
  theme?: ThemeSelection;
  enabled?: BooleanOrVar;
  opacity?: NumberOrVar;
  flipX?: BooleanOrVar;
  flipY?: BooleanOrVar;
  layoutPosition?: 'auto' | 'absolute';
  metadata?: { type: string } & PenExtra;
  rotation?: NumberOrVar;
  x?: number;
  y?: number;
}

interface Sized {
  width?: SizeValue;
  height?: SizeValue;
}

interface Graphics {
  fill?: Fills;
  stroke?: Fills;
  strokeWidth?: StrokeWidth;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'bevel' | 'round';
  strokeAlignment?: 'inner' | 'center' | 'outer';
  effect?: Effects;
}

export interface TextStyle {
  fontFamily?: StringOrVar;
  fontSize?: NumberOrVar;
  fontWeight?: StringOrVar;
  fontStyle?: StringOrVar;
  letterSpacing?: NumberOrVar;
  lineHeight?: NumberOrVar;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  underline?: BooleanOrVar;
  strikethrough?: BooleanOrVar;
  href?: string;
}

export interface FrameNode extends NodeBase, Sized, Graphics {
  type: 'frame';
  cornerRadius?: CornerRadius;
  clip?: BooleanOrVar;
  placeholder?: boolean;
  slot?: false | string[];
  layout?: 'none' | 'horizontal' | 'vertical';
  gap?: NumberOrVar;
  padding?: Padding;
  justifyContent?: 'start' | 'center' | 'end' | 'space_between' | 'space_around';
  alignItems?: 'start' | 'center' | 'end';
  layoutIncludeStroke?: boolean;
  children?: PenNode[];
}

export interface GroupNode extends NodeBase {
  type: 'group';
  effect?: Effects;
  children?: PenNode[];
}

export interface RectangleNode extends NodeBase, Sized, Graphics {
  type: 'rectangle';
  cornerRadius?: CornerRadius;
}

export interface EllipseNode extends NodeBase, Sized, Graphics {
  type: 'ellipse';
  innerRadius?: NumberOrVar;
  startAngle?: NumberOrVar;
  sweepAngle?: NumberOrVar;
}

export interface PolygonNode extends NodeBase, Sized, Graphics {
  type: 'polygon';
  polygonCount?: NumberOrVar;
  cornerRadius?: NumberOrVar;
}

export interface PathNode extends NodeBase, Sized, Graphics {
  type: 'path';
  geometry?: string;
  viewBox?: [number, number, number, number];
  fillRule?: 'nonzero' | 'evenodd';
}

export interface TextNode extends NodeBase, Sized, Graphics, TextStyle {
  type: 'text';
  content?: StringOrVar;
  textGrowth?: 'auto' | 'fixed-width' | 'fixed-width-height';
}

export interface IconNode extends NodeBase, Sized {
  type: 'icon';
  library?: StringOrVar;
  icon?: StringOrVar;
  weight?: NumberOrVar;
  fill?: Fills;
  effect?: Effects;
}

export interface AnnotationNode extends NodeBase, Sized, TextStyle {
  type: 'note' | 'prompt' | 'context';
  content?: StringOrVar;
  /** Only on `prompt`. */
  model?: StringOrVar;
}

export interface ScriptNode extends NodeBase, Sized {
  type: 'script';
  clip?: BooleanOrVar;
  scriptUri?: string;
  inputs?: Record<string, string | number | boolean>;
}

export interface BrowserNode extends NodeBase, Sized {
  type: 'browser';
  url?: string;
  deviceId?: string;
  zoom?: number;
  scrollX?: number;
  scrollY?: number;
  cornerRadius?: CornerRadius;
}

/** Override map of an instance: id path → property overrides (no `type`) or a replacement node (with `type`). */
export type Descendants = Record<string, PenExtra>;

export interface RefNode extends NodeBase {
  type: 'ref';
  /** Id of the reusable node this is an instance of. */
  ref: string;
  descendants?: Descendants;
}

export type PenNode =
  | FrameNode
  | GroupNode
  | RectangleNode
  | EllipseNode
  | PolygonNode
  | PathNode
  | TextNode
  | IconNode
  | AnnotationNode
  | ScriptNode
  | BrowserNode
  | RefNode;

export type PenNodeType = PenNode['type'];

export type VariableType = 'boolean' | 'color' | 'number' | 'string';
export interface ThemedValue<T> {
  value: T;
  theme?: ThemeSelection;
}
export interface VariableDefinition extends PenExtra {
  type: VariableType;
  value: unknown | ThemedValue<unknown>[];
}

export interface PenDocument extends PenExtra {
  version: string;
  themes?: Record<string, string[]>;
  imports?: Record<string, string>;
  variables?: Record<string, VariableDefinition>;
  children: PenNode[];
}
