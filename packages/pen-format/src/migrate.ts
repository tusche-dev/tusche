import type { Diagnostic } from './diagnostics.ts';
import { renameKey } from './key-order.ts';
import type { PenDocument, PenExtra } from './types.ts';
import { CURRENT_VERSION, compareVersions, parseVersion } from './version.ts';

export interface MigrationContext {
  /** Reports what a migration changed or could not change. */
  note(message: string, path?: string): void;
}

export interface Migration {
  /** Short stable name, shown in reports. */
  name: string;
  /** Applies to documents whose version is lower than this one. */
  before: string;
  description: string;
  up(doc: PenDocument, context: MigrationContext): void;
}

const isObject = (value: unknown): value is PenExtra =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Visits every object in the document (nodes, fills, overrides, …) with its JSON path. */
function eachObject(value: unknown, path: string, visit: (object: PenExtra, path: string) => void) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      eachObject(item, `${path}[${i}]`, visit);
    });
  } else if (isObject(value)) {
    visit(value, path);
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'object' && item !== null) eachObject(item, `${path}.${key}`, visit);
    }
  }
}

const FILL_KEYS = new Set(['fill', 'stroke']);

/**
 * Known changes between 2.x versions. We only know the versions we have seen
 * in real files, so each step names the newest version that still needed it.
 * Order matters: migrations run top to bottom.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    name: 'icon-font-to-icon',
    before: CURRENT_VERSION,
    description:
      'Old "icon_font" nodes become "icon" nodes: iconFontName → icon, iconFontFamily → library.',
    up(doc, context) {
      eachObject(doc.children, '$.children', (object, path) => {
        if (object.type !== 'icon_font') return;
        object.type = 'icon';
        renameKey(object, 'iconFontName', 'icon');
        renameKey(object, 'iconFontFamily', 'library');
        context.note('"icon_font" node converted to "icon"', path);
      });
    },
  },
  {
    name: 'image-fill-mode',
    before: CURRENT_VERSION,
    description:
      'Image fill mode "fill" (seen in 2.18) becomes "cover", and "fit" becomes "contain" — the names 2.21 uses for the same behaviour.',
    up(doc, context) {
      const modes: Record<string, string> = { fill: 'cover', fit: 'contain' };
      eachObject(doc.children, '$.children', (object, path) => {
        for (const key of FILL_KEYS) {
          const value = object[key];
          const fills = Array.isArray(value) ? value : [value];
          fills.forEach((fill, i) => {
            if (!isObject(fill) || fill.type !== 'image' || typeof fill.mode !== 'string') return;
            const mode = modes[fill.mode];
            if (!mode) return;
            context.note(
              `image fill mode "${fill.mode}" → "${mode}"`,
              Array.isArray(value) ? `${path}.${key}[${i}].mode` : `${path}.${key}.mode`,
            );
            fill.mode = mode;
          });
        }
      });
    },
  },
];

export interface MigrationResult {
  doc: PenDocument;
  from: string;
  to: string;
  /** Names of migrations that ran. */
  applied: string[];
  /** What changed (level `info`) and what could not be migrated (`warning`). */
  diagnostics: Diagnostic[];
}

/**
 * Brings a 2.x document up to CURRENT_VERSION, in place. Newer and
 * unparseable versions are left alone with a warning. The caller decides
 * when to write the result: an unedited file is not rewritten (05-pen-format §12).
 */
export function migratePen(doc: PenDocument): MigrationResult {
  const from = doc.version;
  const diagnostics: Diagnostic[] = [];
  const version = parseVersion(from);
  if (version?.major !== 2) {
    diagnostics.push({
      level: 'warning',
      code: 'migration',
      path: '$.version',
      message: `Version ${JSON.stringify(from)} is not a 2.x schema; not migrated`,
    });
    return { doc, from: String(from), to: String(from), applied: [], diagnostics };
  }
  if (compareVersions(from, CURRENT_VERSION) >= 0) {
    return { doc, from, to: from, applied: [], diagnostics };
  }

  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (compareVersions(from, migration.before) >= 0) continue;
    let changed = false;
    migration.up(doc, {
      note(message, path = '$') {
        changed = true;
        diagnostics.push({
          level: 'info',
          code: 'migration',
          path,
          message: `${migration.name}: ${message}`,
        });
      },
    });
    if (changed) applied.push(migration.name);
  }
  doc.version = CURRENT_VERSION;
  return { doc, from, to: CURRENT_VERSION, applied, diagnostics };
}
