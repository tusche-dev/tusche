# ADR-002 · `.pen` is the native format, and its tree is the source of truth

**English** · [Русский](../ru/002-pen-native-format.md)

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Users already have many `.pen` files. The format is published, JSON, git-friendly and agent-friendly (`fit_content`, `ref` + `descendants`, themed variables). Real files on disk are **plain JSON, not encrypted**, despite older claims. OpenPencil reads `.pen` but cannot write it, and its importer drops several node and paint types.

Options:

1. Use OpenPencil's `.fig` / scene graph as the document; import and export `.pen`. Lossy both ways; the user's files change shape.
2. Our own new format. Breaks compatibility; nobody needs another format.
3. **`.pen` as the document model; OpenPencil's scene graph as a derived projection.**

## Decision

Option 3.

- `@tusche/pen-format` owns the `PenDocument`: schema, validation, migrations, canonical serialisation.
- All edits — agent edits, and human edits from phase 2 through a reverse mapper — are operations on the `PenDocument`.
- `@tusche/pen-bridge` projects the `PenDocument` into a `SceneGraph` incrementally, for layout, rendering and export. The projection is disposable.
- Unknown and unsupported properties are preserved byte-for-byte in the `PenDocument`.
- Tusche writes canonical JSON (stable key order, defaults omitted) so diffs stay small.

## Consequences

- ➕ Files remain pen.dev-compatible; round trips are exact; git diffs stay clean.
- ➕ The agent API works in `.pen` terms, the same terms the skill teaches.
- ➖ We must maintain our own bridge instead of relying on `@open-pencil/pen`. We may still reuse its converters internally and upstream improvements.
- ➖ Human editing in phase 2 is limited to properties that have a `.pen` equivalent.
- ➖ We follow a format controlled by another company. Mitigation: version-gated migrations; preserve-unknown policy; the public schema is the reference.
