import { createRequire } from 'node:module';
import type { IconifyJSON } from '@iconify/types';
import { getIconData } from '@iconify/utils';

/** One drawable shape of an icon, in the icon's own coordinates. */
export interface IconShape {
  d: string;
  /** `'current'` — painted with the icon's `fill`; a hex color; or `undefined` — not filled. */
  fill?: string | undefined;
  stroke?: string | undefined;
  strokeWidth: number;
  strokeLinecap?: string | undefined;
  strokeLinejoin?: string | undefined;
  fillRule: 'nonzero' | 'evenodd';
}

export interface IconData {
  /** View box of the icon. */
  left: number;
  top: number;
  width: number;
  height: number;
  shapes: IconShape[];
}

/** Supplies vector data for `.pen` icons: `library` + `icon` (+ optional `weight`). */
export interface IconProvider {
  get(library: string, icon: string, weight?: number): IconData | undefined;
}

/** An Iconify prefix and icon names to try, in order, for a `.pen` icon. */
export interface IconifyName {
  prefix: string;
  names: string[];
}

const kebab = (name: string) => name.trim().replace(/_/g, '-').toLowerCase();

function phosphorSuffix(weight: number | undefined): string {
  if (weight === undefined) return '';
  if (weight <= 150) return '-thin';
  if (weight <= 300) return '-light';
  if (weight <= 450) return '';
  return '-bold';
}

/** Maps a `.pen` icon library and name to Iconify names. */
export function iconifyName(
  library: string,
  icon: string,
  weight?: number,
): IconifyName | undefined {
  const name = kebab(icon);
  const lib = library.trim().toLowerCase();
  switch (lib) {
    case 'lucide':
      return { prefix: 'lucide', names: [name] };
    case 'feather':
      return { prefix: 'feather', names: [name] };
    case 'phosphor': {
      // Names may already carry a weight suffix ("star-fill").
      const suffix = phosphorSuffix(weight);
      return { prefix: 'ph', names: suffix ? [name + suffix, name] : [name] };
    }
    case 'material symbols outlined':
      return { prefix: 'material-symbols', names: [`${name}-outline`, name] };
    case 'material symbols rounded':
      return {
        prefix: 'material-symbols',
        names: [`${name}-outline-rounded`, `${name}-rounded`, name],
      };
    case 'material symbols sharp':
      return {
        prefix: 'material-symbols',
        names: [`${name}-outline-sharp`, `${name}-sharp`, name],
      };
    default:
      return undefined;
  }
}

// --- SVG body → shapes -------------------------------------------------------

type Attrs = Record<string, string>;

const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"/g;
const TAG_RE = /<(\/?)([\w:-]+)([^>]*?)(\/?)>/g;
const INHERITED = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-rule',
] as const;

function attrs(source: string): Attrs {
  const result: Attrs = {};
  for (const match of source.matchAll(ATTR_RE)) result[match[1] as string] = match[2] as string;
  return result;
}

const n = (value: string | undefined, fallback = 0) => {
  const parsed = value === undefined ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}

function rectPath(a: Attrs): string {
  const x = n(a.x);
  const y = n(a.y);
  const w = n(a.width);
  const h = n(a.height);
  let rx = n(a.rx, Number.NaN);
  let ry = n(a.ry, Number.NaN);
  if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
  if (Number.isNaN(ry)) ry = rx;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return (
    `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
    `v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
  );
}

function pointsPath(points: string, close: boolean): string {
  const values = points
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  const pairs: string[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) pairs.push(`${values[i]} ${values[i + 1]}`);
  if (pairs.length === 0) return '';
  return `M${pairs.join('L')}${close ? 'Z' : ''}`;
}

function shapePath(tag: string, a: Attrs): string | undefined {
  switch (tag) {
    case 'path':
      return a.d;
    case 'circle':
      return ellipsePath(n(a.cx), n(a.cy), n(a.r), n(a.r));
    case 'ellipse':
      return ellipsePath(n(a.cx), n(a.cy), n(a.rx), n(a.ry));
    case 'rect':
      return rectPath(a);
    case 'line':
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'polyline':
      return pointsPath(a.points ?? '', false);
    case 'polygon':
      return pointsPath(a.points ?? '', true);
    default:
      return undefined;
  }
}

const paint = (value: string | undefined): string | undefined => {
  if (value === undefined || value === 'none' || value === 'transparent') return undefined;
  return value === 'currentColor' ? 'current' : value;
};

/** Converts an Iconify SVG body into shapes. Supports the subset icon sets use. */
export function parseIconBody(body: string): IconShape[] {
  const shapes: IconShape[] = [];
  const stack: Attrs[] = [{ fill: 'currentColor' }];
  for (const match of body.matchAll(TAG_RE)) {
    const [, closing, tag = '', rawAttrs = '', selfClosing] = match;
    if (closing) {
      if (tag === 'g' && stack.length > 1) stack.pop();
      continue;
    }
    const own = attrs(rawAttrs);
    const inherited = stack[stack.length - 1] as Attrs;
    const merged: Attrs = { ...own };
    for (const key of INHERITED) {
      if (merged[key] === undefined && inherited[key] !== undefined) {
        merged[key] = inherited[key] as string;
      }
    }
    if (tag === 'g') {
      if (!selfClosing) stack.push(merged);
      continue;
    }
    if (own.opacity === '0') continue;
    const d = shapePath(tag, merged);
    if (!d) continue;
    shapes.push({
      d,
      fill: paint(merged.fill),
      stroke: paint(merged.stroke),
      strokeWidth: n(merged['stroke-width'], 1),
      strokeLinecap: merged['stroke-linecap'],
      strokeLinejoin: merged['stroke-linejoin'],
      fillRule: merged['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
    });
  }
  return shapes;
}

// --- Providers ------------------------------------------------------------------

/** Icon data from Iconify icon sets (objects in the `@iconify/json` format). */
export function iconSetProvider(sets: ReadonlyMap<string, IconifyJSON>): IconProvider {
  const cache = new Map<string, IconData | null>();
  return {
    get(library, icon, weight) {
      const key = `${library}\u0000${icon}\u0000${weight ?? ''}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached ?? undefined;
      let result: IconData | undefined;
      const target = iconifyName(library, icon, weight);
      const set = target ? sets.get(target.prefix) : undefined;
      if (target && set) {
        for (const name of target.names) {
          const data = getIconData(set, name);
          if (!data) continue;
          result = {
            left: data.left ?? 0,
            top: data.top ?? 0,
            width: data.width ?? set.width ?? 16,
            height: data.height ?? set.height ?? 16,
            shapes: parseIconBody(data.body),
          };
          break;
        }
      }
      cache.set(key, result ?? null);
      return result;
    },
  };
}

/** Tries providers in order. */
export function chainIconProviders(...providers: IconProvider[]): IconProvider {
  return {
    get: (library, icon, weight) => {
      for (const provider of providers) {
        const data = provider.get(library, icon, weight);
        if (data) return data;
      }
      return undefined;
    },
  };
}

const require = createRequire(import.meta.url);
let bundled: IconProvider | undefined;

/** Lucide and Phosphor from the bundled `@iconify-json/*` packages, loaded on first use. */
export function bundledIcons(): IconProvider {
  if (bundled) return bundled;
  const sets = new Map<string, IconifyJSON>();
  const lazy = (prefix: string, pkg: string) => {
    if (!sets.has(prefix)) sets.set(prefix, require(`${pkg}/icons.json`) as IconifyJSON);
  };
  const inner = iconSetProvider(sets);
  bundled = {
    get(library, icon, weight) {
      const target = iconifyName(library, icon, weight);
      if (target?.prefix === 'lucide') lazy('lucide', '@iconify-json/lucide');
      else if (target?.prefix === 'ph') lazy('ph', '@iconify-json/ph');
      else return undefined;
      return inner.get(library, icon, weight);
    },
  };
  return bundled;
}
