import { argumentError, ExecError } from './errors.ts';
import { isObject } from './tree.ts';

/** One fix of a failed snippet: `find` must match once, unless `all` is set. */
export interface Edit {
  find: string;
  replace: string;
  all?: boolean;
}

const count = (text: string, part: string): number => {
  let n = 0;
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + part.length)) n++;
  return n;
};

/** Applies edits in order. Every failure names the edit, so the agent can fix just that one. */
export function applyEdits(code: string, edits: unknown): string {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw argumentError('edits must be a non-empty list of {find, replace, all?}');
  }
  let result = code;
  edits.forEach((edit, i) => {
    if (!isObject(edit) || typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
      throw argumentError(`edits[${i}] must be {find: string, replace: string, all?: boolean}`);
    }
    if (edit.find === '') throw argumentError(`edits[${i}]: find is empty`);
    const matches = count(result, edit.find);
    if (matches === 0) {
      throw new ExecError(`edits[${i}]: ${JSON.stringify(edit.find)} matched 0 times`, {
        name: 'EditError',
        hint: 'find is matched exactly, including spaces and quotes; earlier edits are already applied',
      });
    }
    if (matches > 1 && edit.all !== true) {
      throw new ExecError(`edits[${i}]: ${JSON.stringify(edit.find)} matched ${matches} times`, {
        name: 'EditError',
        hint: 'make find longer so it matches once, or set all: true',
      });
    }
    result =
      edit.all === true
        ? result.split(edit.find).join(edit.replace)
        : result.replace(edit.find, () => edit.replace as string);
  });
  return result;
}
