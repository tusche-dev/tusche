import type { HostOp } from '../sandbox.ts';
import type { Transaction } from '../transaction.ts';
import { copy, insert, move, remove, replace, setVariables, update } from './mutations.ts';
import { generate, type Outputs } from './output.ts';
import { getVariables, type Reader } from './reads.ts';

/** The host side of every API function the prelude calls (argument lists as the prelude sends them). */
export function hostOps(tx: Transaction, reader: Reader, outputs: Outputs): Record<string, HostOp> {
  return {
    Insert: ([parent, node]) => insert(tx, parent, node),
    Copy: ([path, parent, overrides]) => copy(tx, path, parent, overrides),
    Update: ([path, props]) => update(tx, path, props),
    Replace: ([path, node]) => replace(tx, path, node),
    Move: ([path, parent, index]) => move(tx, path, parent, index),
    Delete: ([path]) => remove(tx, path),
    SetVariables: ([variables, replaceAll]) => setVariables(tx, variables, replaceAll),
    GetVariables: () => getVariables(tx),
    Get: ([path, options]) => reader.get(path, options),
    GetRoots: ([options]) => reader.roots(options),
    GetNodes: ([paths, options]) => reader.entries(paths, options),
    Bounds: ([path]) => reader.bounds(path),
    Problems: ([path]) => reader.problems(path),
    FindEmptySpace: ([query]) => reader.findEmptySpace(query),
    Print: ([values]) => outputs.print(values),
    TakeScreenshot: ([ids, options]) => outputs.screenshot(ids, options),
    Export: ([ids, format, outPath, options]) => outputs.export(ids, format, outPath, options),
    Generate: () => generate(),
  };
}
