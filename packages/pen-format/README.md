# @tusche/pen-format

Read, validate, migrate and write `.pen` design files (schema 2.21, reads 2.x).

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.

```ts
import { migratePen, parsePen, serializePen, validatePen } from '@tusche/pen-format';

const { doc, format } = parsePen(text); // JSON or JSONC; throws PenParseError with line/column
migratePen(doc); // in place: 2.x → 2.21
for (const d of validatePen(doc)) console.log(d.level, d.code, d.path, d.message);
const out = serializePen(doc, format); // byte-identical if nothing changed
```

- **Style-preserving writer.** Key order, indentation, line endings and the trailing newline come from the source file, so an unchanged file is written back byte for byte and an edit produces a minimal diff. New nodes get a canonical key order. Use `withChanges(node, patch)` for immutable updates and `createNode(props)` for new nodes. See ADR-006 in `docs/dev/adr`.
- **Unknown data is kept.** Unknown properties, node types and root keys survive a round trip.
- **Diagnostics** have a level (`error`, `warning`, `info`), a code, a JSON path like `$.children[0].fill[1].mode` and the closest node id.
- **Id paths.** `resolveNodePath(doc, 'dialog/okButton/label')` resolves nodes inside component instances, `effectiveNode()` applies overrides, `generateId()` makes ids without `/`.

The format description lives in [docs/dev/05-pen-format.md](../../docs/dev/05-pen-format.md) (Russian). It is written from pen.dev's public schema and from observed files.
