import * as v from 'valibot';

const VARIABLE_RE = /^\$.+/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SIZING_RE = /^(?:fit_content|fill_container)(?:\(\s*-?\d+(?:\.\d+)?\s*\))?$/;

export const variableRef = v.pipe(
  v.string(),
  v.regex(VARIABLE_RE, 'Expected a variable reference like "$name"'),
);

export const numberOrVar = v.union([v.number(), variableRef], 'Expected a number or "$variable"');
export const booleanOrVar = v.union(
  [v.boolean(), variableRef],
  'Expected a boolean or "$variable"',
);
export const stringOrVar = v.string();

export const color = v.pipe(
  v.string(),
  v.regex(COLOR_RE, 'Expected a hex color: #RGB, #RRGGBB or #RRGGBBAA'),
);
export const colorOrVar = v.union(
  [color, variableRef],
  'Expected a hex color (#RGB, #RRGGBB, #RRGGBBAA) or "$variable"',
);

export const sizingMode = v.pipe(
  v.string(),
  v.regex(
    SIZING_RE,
    'Expected a number, "$variable", "fit_content", "fill_container" or a mode with fallback like "fit_content(320)"; percentages, calc() and viewport units are not supported',
  ),
);
export const sizeValue = v.union(
  [v.number(), variableRef, sizingMode],
  'Expected a number, "$variable", "fit_content", "fill_container" or a mode with fallback like "fit_content(320)"; percentages, calc() and viewport units are not supported',
);

export const padding = v.union(
  [
    numberOrVar,
    v.tuple([numberOrVar, numberOrVar]),
    v.tuple([numberOrVar, numberOrVar, numberOrVar, numberOrVar]),
  ],
  'Expected padding as a number, "$variable", [vertical, horizontal] or [top, right, bottom, left]',
);

export const cornerRadius = v.union(
  [numberOrVar, v.tuple([numberOrVar, numberOrVar, numberOrVar, numberOrVar])],
  'Expected a radius as a number, "$variable" or four values [topLeft, topRight, bottomRight, bottomLeft]',
);

export const blendMode = v.picklist([
  'normal',
  'darken',
  'multiply',
  'linearBurn',
  'colorBurn',
  'light',
  'screen',
  'linearDodge',
  'colorDodge',
  'overlay',
  'softLight',
  'hardLight',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

export const themeSelection = v.record(v.string(), v.string());

export const isVariableRef = (value: unknown): value is `$${string}` =>
  typeof value === 'string' && VARIABLE_RE.test(value);
