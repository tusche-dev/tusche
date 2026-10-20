import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VariableDefinition } from '@tusche/pen-format';
import * as v from 'valibot';

/** Folder of the archetype JSON files. */
export const ARCHETYPE_DIR = fileURLToPath(new URL('../archetypes', import.meta.url));

const hex = v.pipe(v.string(), v.regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i));
const scale = v.pipe(v.array(v.pipe(v.number(), v.minValue(0))), v.minLength(1));
const key = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*$/));

const ArchetypeSchema = v.strictObject({
  name: key,
  title: v.string(),
  summary: v.string(),
  params: v.optional(
    v.record(key, v.strictObject({ default: v.string(), options: v.record(key, hex) })),
  ),
  fonts: v.strictObject({ display: v.string(), body: v.string(), mono: v.optional(v.string()) }),
  palette: v.record(key, v.string()),
  scale: v.strictObject({ type: scale, space: scale, radius: scale }),
  imagery: v.string(),
  rules: v.array(v.string()),
});

/** A style archetype as stored in `archetypes/*.json`. */
export type Archetype = v.InferOutput<typeof ArchetypeSchema>;

/** An archetype with its parameters applied, ready to use. */
export interface Style extends Omit<Archetype, 'params' | 'palette'> {
  /** Parameter values that were used. */
  params: Record<string, string>;
  /** All values of each parameter. */
  options: Record<string, string[]>;
  palette: Record<string, string>;
  /** Payload for `SetVariables`: `color-*`, `font-*`, `text-*`, `space-*`, `radius-*`. */
  variables: Record<string, VariableDefinition>;
}

export interface StyleSummary {
  name: string;
  title: string;
  summary: string;
  params: Record<string, string[]>;
}

export class StyleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StyleError';
  }
}

const paramOf = (value: string) => /^\$param\.(.+)$/.exec(value)?.[1];

async function loadAll(): Promise<Map<string, Archetype>> {
  const files = (await readdir(ARCHETYPE_DIR)).filter((f) => f.endsWith('.json')).sort();
  const result = new Map<string, Archetype>();
  for (const file of files) {
    const data = JSON.parse(await readFile(join(ARCHETYPE_DIR, file), 'utf8')) as unknown;
    const parsed = v.safeParse(ArchetypeSchema, data);
    if (!parsed.success) {
      const issue = parsed.issues[0];
      throw new StyleError(`${file}: ${v.getDotPath(issue) ?? '$'}: ${issue.message}`);
    }
    const archetype = parsed.output;
    if (`${archetype.name}.json` !== file) {
      throw new StyleError(`${file}: name "${archetype.name}" does not match the file name`);
    }
    for (const [name, value] of Object.entries(archetype.palette)) {
      const param = paramOf(value);
      if (param !== undefined ? !archetype.params?.[param] : !v.is(hex, value)) {
        throw new StyleError(`${file}: palette.${name}: "${value}" is not a colour or a parameter`);
      }
    }
    for (const [name, param] of Object.entries(archetype.params ?? {})) {
      if (!(param.default in param.options)) {
        throw new StyleError(
          `${file}: params.${name}: default "${param.default}" is not an option`,
        );
      }
    }
    result.set(archetype.name, archetype);
  }
  return result;
}

let cache: Promise<Map<string, Archetype>> | undefined;

/** Validated archetypes by name (read once). */
export function archetypes(): Promise<Map<string, Archetype>> {
  cache ??= loadAll();
  return cache;
}

/** Every archetype with its summary and parameter options. */
export async function listStyles(): Promise<StyleSummary[]> {
  return [...(await archetypes()).values()].map((a) => ({
    name: a.name,
    title: a.title,
    summary: a.summary,
    params: Object.fromEntries(
      Object.entries(a.params ?? {}).map(([name, p]) => [name, Object.keys(p.options)]),
    ),
  }));
}

/** An archetype with parameters applied (defaults for the ones not given). */
export async function getStyle(name: string, params: Record<string, string> = {}): Promise<Style> {
  const all = await archetypes();
  const archetype = all.get(name);
  if (!archetype) {
    throw new StyleError(`no style "${name}"; available: ${[...all.keys()].join(', ')}`);
  }
  const defs = archetype.params ?? {};
  for (const param of Object.keys(params)) {
    if (!defs[param]) {
      const known = Object.keys(defs);
      throw new StyleError(
        `style "${name}" has no parameter "${param}"${known.length ? `; parameters: ${known.join(', ')}` : ''}`,
      );
    }
  }
  const used: Record<string, string> = {};
  const values: Record<string, string> = {};
  const options: Record<string, string[]> = {};
  for (const [param, def] of Object.entries(defs)) {
    const choice = params[param] ?? def.default;
    const value = def.options[choice];
    if (value === undefined) {
      throw new StyleError(
        `"${choice}" is not an option of ${param}; options: ${Object.keys(def.options).join(', ')}`,
      );
    }
    used[param] = choice;
    values[param] = value;
    options[param] = Object.keys(def.options);
  }
  const palette: Record<string, string> = {};
  for (const [slot, value] of Object.entries(archetype.palette)) {
    const param = paramOf(value);
    palette[slot] = param === undefined ? value : (values[param] as string);
  }

  const variables: Record<string, VariableDefinition> = {};
  for (const [slot, value] of Object.entries(palette)) {
    variables[`color-${slot}`] = { type: 'color', value };
  }
  for (const [role, family] of Object.entries(archetype.fonts)) {
    if (family !== undefined) variables[`font-${role}`] = { type: 'string', value: family };
  }
  const steps = {
    text: archetype.scale.type,
    space: archetype.scale.space,
    radius: archetype.scale.radius,
  };
  for (const [prefix, list] of Object.entries(steps)) {
    list.forEach((value, i) => {
      variables[`${prefix}-${i + 1}`] = { type: 'number', value };
    });
  }

  const { params: _params, palette: _palette, ...rest } = archetype;
  return { ...rest, params: used, options, palette, variables };
}
