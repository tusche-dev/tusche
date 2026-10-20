import * as v from 'valibot';
import {
  booleanOrVar,
  colorOrVar,
  numberOrVar,
  stringOrVar,
  themeSelection,
} from './primitives.ts';

const NAME_RE = /^[^:]+$/;

const themedOr = <T extends v.GenericSchema>(value: T) =>
  v.union([value, v.array(v.looseObject({ value, theme: v.optional(themeSelection) }))]);

export const variableDefinition = v.variant(
  'type',
  [
    v.looseObject({ type: v.literal('boolean'), value: themedOr(booleanOrVar) }),
    v.looseObject({ type: v.literal('color'), value: themedOr(colorOrVar) }),
    v.looseObject({ type: v.literal('number'), value: themedOr(numberOrVar) }),
    v.looseObject({ type: v.literal('string'), value: themedOr(stringOrVar) }),
  ],
  'Unknown variable type; expected boolean, color, number or string',
);

const name = v.pipe(v.string(), v.regex(NAME_RE, 'Names must not contain ":"'));

/** Root of a document, without its node tree (validated node by node). */
export const documentRoot = v.looseObject({
  version: v.pipe(
    v.string('Expected "version" to be a string like "2.21"'),
    v.regex(/^\d+\.\d+$/, 'Expected "version" like "2.21"'),
  ),
  themes: v.optional(v.record(name, v.array(v.string()))),
  imports: v.optional(v.record(v.string(), v.string())),
  variables: v.optional(v.record(name, variableDefinition)),
  children: v.array(v.looseObject({}), 'Expected "children" to be an array of nodes'),
});
