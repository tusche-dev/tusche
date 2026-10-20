# @tusche/exec

The execute engine: QuickJS sandbox, host API, transactions (phase 1.4).

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.

```ts
import { createExecutor, formatResult } from '@tusche/exec';

const exec = createExecutor(); // an engine is created on first use
const session = await exec.open('/abs/design/app.pen', { create: true });
const result = await session.execute({ input: 'Insert(document, {type: "frame", name: "Hero"})' });
const { text, images } = formatResult(result);
// fix a failed snippet without resending it:
await session.execute({ editId: 'e1', edits: [{ find: 'fontSize:64', replace: 'fontSize:56' }] });
await session.undo(); // one step per committed change, globals included
```

A long-lived process (the MCP server) delays writes and checks the file before each tool:

```ts
const exec = createExecutor({ save: { delayMs: 300 } });
const state = await session.checkDisk(); // 'same' | 'reloaded' | 'conflict' | 'deleted'
await session.flush(); // write pending changes now; { force: true } writes over a conflict
await exec.flushAll(); // before the process exits
```

The API and the response format are described in [06-agent-api](../../docs/dev/06-agent-api.md), the runtime model in [ADR-008](../../docs/dev/adr/008-execute-runtime.md), sessions, undo and saving in [ADR-009](../../docs/dev/adr/009-mcp-sessions.md).

## Layout

| File | What |
|---|---|
| `src/sandbox.ts`, `src/prelude.ts` | QuickJS context per call, limits, the API inside the VM, global variables |
| `src/transaction.ts`, `src/tree.ts` | The document snapshot, path copying, atomic operations, affected roots |
| `src/api/mutations.ts` | Insert, Copy, Update, Replace, Move, Delete, SetVariables |
| `src/api/reads.ts` | Get (with visitors), GetVariables, FindEmptySpace, bounds and clipping |
| `src/api/output.ts` | Print, TakeScreenshot, Export, Generate |
| `src/session.ts` | Executor and DocumentSession: commit, rollback, undo/redo, delayed save, changes on disk, screenshots, exports |
| `src/lint.ts` | `lintDocument`: validator, the checks of `execute` and OpenPencil rules over a whole document |
| `src/edits.ts`, `src/warnings.ts`, `src/format.ts`, `src/file.ts` | edits/editId, warnings, response text, atomic writes |

## Contract test coverage

`test/contract.test.ts` runs every case through `session.execute`; each error case checks the error, the rollback (the file is unchanged) and the `editId`. Lower-level cases are in `test/mutations.test.ts`, `test/reads.test.ts`, `test/sandbox.test.ts`, `test/session.test.ts`, `test/history.test.ts`, `test/lint.test.ts`.

| Function | Success | Error paths |
|---|---|---|
| Insert | ids, names (roots only), into the document | unknown parent, `#` path, non-string path, leaf parent, instance as parent, a component node inside an instance, layout property on a non-frame, schema error, no `type`, non-object node and child, non-finite number, function value |
| Copy | plain copy with overrides and `descendants`, component → instance | unknown source or parent, the document, override of `id`/`type`/`children`, non-object overrides or `descendants`, unknown descendant, schema error |
| Update | properties, `null` deletes, overrides inside instances, `children` (also of a component node inside an instance) | unknown path (also inside an instance), the document, `id`/`type`/`ref`, `children` that is not a list, non-object props, schema error (also of an override) |
| Replace | new id, replacement inside an instance addressed by its id, replacing a replacement | unknown path, the document, no `type`, schema error, component with instances |
| Move | other parent with index, same parent | unknown path or parent, the document, into itself or a descendant, out of an instance, into an instance, negative / fractional / too large index |
| Delete | node, added child of an instance, component without instances | unknown path, the document, component child in an instance, replacement, the old path of a replaced node, component with instances |
| SetVariables | merge, `null` deletes, replace, new theme values | non-object, unknown type, no value, `$` in the name |
| Get | depth and stubs, instances (ref / expanded), resolveVariables, path geometry, the document, visitors with depth / index / parentCtx / skipChildren / bounds / problems | unknown path (with and without a visitor), `#` path, no arguments, non-string path, bad depth, an exception in the visitor |
| GetVariables | variables and themes | — |
| FindEmptySpace | right of everything, next to a node | no query, bad size, bad direction, unknown node |
| Print | values joined, cut at the limit | — |
| TakeScreenshot | PNG after the commit, none on failure | empty list, not a list, unknown node, bad scale, more than 6 |
| Export | file written after the commit, nothing on failure | unknown format, pdf, empty path, outside the folder, nodes of different top-level frames, unknown node |
| Generate | — | always an error with a hint |
| Snippet | caught errors undo only their operation | syntax error (line), reference error, thrown value, stack overflow, time, memory, operations limit |
| edits | fix under the same editId, `all: true`, editId forgotten after success, a new failure gets a new editId | unknown editId, 0 matches, 2 matches, empty list, malformed edit |
| Globals | JSON values persist | non-JSON values are reported and dropped, a failed call keeps the old values |
| Warnings | every code: `id-ignored`, `invisible-text`, `ignored-xy`, `clipped`, `zero-size`, `circular-size`, `unknown-font`, `missing-glyphs`, `unsupported-render`, `unknown-variable`; none for a clean insert; more than 20 are counted | — |
| File | reads leave the bytes as they are; an edit keeps the file style and changes only the edited lines | — |
| History | undo/redo of the document, globals and file, several steps, redo cleared by a commit, failed calls are not steps | more steps than there are |
| Saving | delayed write, `flush`, `flushAll`, `close`; a changed file is read again when nothing is unsaved | a conflict with unsaved changes, `force`, `reload`, a deleted file |
| Lint | every node: catalog warnings, validator warnings, OpenPencil rules; one subtree; `info` on request; errors first | schema errors, unknown path |
