# 04 · Architecture

**English** · [Русский](../ru/04-architecture.md)

## Overview

```
 ┌───────────────────────────┐        stdio (MCP)        ┌───────────────────────────────────────┐
 │ Claude Code / Codex / any │ ────────────────────────▶ │ @tusche/mcp                           │
 │ MCP client (user's own    │ ◀──────────────────────── │  get_app_state · read_skill ·         │
 │ subscription)             │   text + PNG screenshots   │  get_style · execute · open/save      │
 └───────────────────────────┘                           └──────────────┬────────────────────────┘
                                                                         │
                                         ┌───────────────────────────────▼──────────────────────────┐
                                         │ @tusche/exec — execute engine                            │
                                         │  QuickJS (WASM) sandbox ⇄ host API (Insert/Get/…)         │
                                         │  transaction = snapshot → run → commit | rollback         │
                                         └───────────────┬──────────────────────────┬───────────────┘
                                                         │ edits                    │ layout / render
                                         ┌───────────────▼──────────────┐ ┌─────────▼────────────────────┐
                                         │ @tusche/pen-format           │ │ @tusche/pen-bridge            │
                                         │  PenDocument (source of truth)│→│  PenDocument → SceneGraph     │
                                         │  schema, validate, migrate,  │ │  (incremental, by node id)    │
                                         │  canonical serialize         │ └─────────┬────────────────────┘
                                         └───────────────┬──────────────┘           │
                                                         │ read / write             │
                                                   ┌─────▼─────┐        ┌───────────▼─────────────────────┐
                                                   │ file.pen  │        │ @open-pencil/core               │
                                                   │ (JSON)    │        │  layout (Yoga) · render (Skia)  │
                                                   └───────────┘        │  export · lint · analyze        │
                                                                        └─────────────────────────────────┘
```

## Packages

Bun workspaces monorepo. All packages are TypeScript and ESM.

| Package | Responsibility | Depends on |
|---|---|---|
| `@tusche/pen-format` | `.pen` types and a Valibot schema (2.21); validation with readable errors; migrations from older 2.x; canonical serialiser; id generator; path resolution (`instance/child`) | — |
| `@tusche/pen-bridge` | Projects a `PenDocument` into an `@open-pencil/scene-graph` `SceneGraph`: node types, fills, strokes, effects, layout, text, variables and themes, components and instances. Incremental update by changed ids. Phase 2: reverse projection of human edits. | pen-format, `@open-pencil/scene-graph` |
| `@tusche/engine` | Thin adapter over `@open-pencil/core`: run layout, read resolved bounds, render PNG, export SVG / PDF, run lint and analysis. The only package that imports `@open-pencil/core`. | pen-bridge, `@open-pencil/core` |
| `@tusche/exec` | The `execute` engine: QuickJS sandbox, host API bindings, transactions, `edits` / `editId` store, names map, warnings, globals persistence | pen-format, engine |
| `@tusche/mcp` | MCP server (stdio; HTTP later): tool definitions, document sessions, file watching | exec, skill, styles |
| `@tusche/skill` | The agent skill: `SKILL.md` and guides (Markdown, English) | — |
| `@tusche/styles` | Style archetypes as data (fonts, palette, spacing, imagery hints, params) | — |
| `@tusche/cli` | `tusche mcp | exec | render | lint | export | validate | migrate` | all |
| `apps/preview` (phase 1) | Minimal local web page: renders the current document, reloads on change | engine |
| `apps/desktop` (phase 2) | Tauri v2 + Vue 3 + `@open-pencil/vue` | all |

## Key decision: the `.pen` tree is the source of truth

OpenPencil's `SceneGraph` is Figma-shaped. `.pen` is not: it has `fit_content` / `fill_container`, `ref` + `descendants`, themed variables, `note` / `prompt` / `script` / `browser` nodes, shader fills. A lossless `.pen` → `SceneGraph` → `.pen` round trip would be hard, and it would break whenever either side changes.

So:

1. **`PenDocument` (plain JSON tree) is the document.** All agent edits are applied to it. Saving means serialising it.
2. **The `SceneGraph` is a derived, disposable projection** used for layout, hit testing, rendering and export. `pen-bridge` rebuilds the subtrees whose ids changed in a transaction.
3. **Each scene node keeps its pen id.** Bounds and problems computed on the scene graph map straight back to pen ids, through the instance path for expanded refs.
4. **Unsupported pen features** (shader fill, `script`, `browser`, …) still project to something visible — a placeholder fill, an empty frame of the right size — and stay untouched in the `PenDocument`.
5. **Phase 2 human edits:** the desktop editor edits the scene graph. A reverse mapper turns a change set (property X of node Y) into `Update` operations on the `PenDocument`. The forward projection then runs as usual. Only properties that have a pen equivalent are editable; the rest are read-only in the inspector.

See [ADR-002](../adr/en/002-pen-native-format.md).

## The execute pipeline

```
execute(input | editId+edits, filePath)
  │
  ├─ resolve snippet (apply find/replace edits to the stored failed snippet)
  ├─ session = documents.get(filePath)          // open + migrate on first use
  ├─ tx = session.begin()                        // structural-sharing snapshot of PenDocument
  ├─ vm = quickjs.newContext(globals = session.globals)
  │     host fns: Insert Copy Update Replace Move Delete SetVariables GetVariables
  │               Get FindEmptySpace Print TakeScreenshot Export
  ├─ run snippet (time limit 10 s, memory limit 256 MB, interrupt handler)
  │     • mutations go to tx (validated per op; invalid → throw)
  │     • Get / FindEmptySpace / TakeScreenshot flush pending ops to pen-bridge and run layout
  ├─ on throw → tx.rollback(); store snippet under new editId; return error + line + hint
  └─ on success → tx.commit(); persist globals; save file (debounced);
                  return Print lines + names→ids map + warnings + screenshots
```

- **Snapshots** use structural sharing (immutable updates) so rollback is O(1).
- **Validation** runs per operation, against the Valibot schema plus semantic rules ("`padding` only on frames", "text with `width` needs `textGrowth`"). Rule violations that pen.dev treats as errors are errors. Style smells are warnings.
- **Warnings** come from a post-commit pass: clipped children, zero-size frames, text without `fill`, `fill_container` inside a `fit_content` parent (a circular dependency), unknown fonts.

## Sessions, files and concurrency

- One `DocumentSession` per absolute file path: the `PenDocument`, the derived scene graph, globals, the failed-snippet store and the undo stack.
- **File watching:** if the file changes on disk and the session has no uncommitted transaction, reload. If the agent's last commit is newer than the disk change, report a conflict in `get_app_state`.
- **Writes** are atomic: write a temp file, then rename. Canonical serialisation keeps git diffs small.
- **Undo:** each committed transaction is one undo step. Phase 2 merges human edits into the same stack.

## Rendering and screenshots

- `engine.render(nodeIds, {scale})` uses `@open-pencil/core/io/formats/raster` with a **warm, cached CanvasKit instance** per process. Fonts load once and are cached on disk (Google Fonts via `unifont`).
- Screenshots go back as MCP `image` content (PNG, scale 1 by default, longest side capped at 1600 px to save tokens).
- Icons resolve through Iconify data (OpenPencil already depends on `@iconify/utils`). The icon libraries map from pen names: `lucide`, `feather`, `Material Symbols *`, `phosphor`.

## Live preview (phase 1)

`tusche preview file.pen` serves a page that hosts `@open-pencil/core`'s canvas in the browser (WebGL) and subscribes over WebSocket to document change events from the MCP process. It is read-only: pan, zoom, select to see ids. This gives a visual feed while the agent works, before the desktop app exists.

## Phase 2 desktop

- Tauri v2 shell (Rust): native windows, file dialogs, file associations for `.pen`, auto-update, and **spawning the agent CLI** as a child process with Tusche's MCP configured.
- Front-end: Vue 3 + `@open-pencil/vue` (`CanvasRoot`, `useCanvas`, panels), with our inspector panels for pen-specific properties.
- The MCP server runs inside the app process (Node sidecar or the webview via a local HTTP MCP endpoint, to be decided in phase 2). External agents connect to the running app the way pen.dev's binary does today.

## Security

- QuickJS sandbox: no `fetch`, no `require`, no file system. Only host functions. Time and memory limits.
- `Export` writes only inside the document's directory, or a directory the user allows (`TUSCHE_ROOT`).
- Image URLs in fills resolve relative to the `.pen` file; remote URLs are fetched only when `allowRemoteAssets` is on.

## Testing strategy

- **Golden files:** the bundled examples and user-contributed `.pen` files → render → compare PNGs with `pixelmatch` (OpenPencil exports `comparePNGs`).
- **Round-trip tests:** read → write must be byte-identical for canonical inputs; unknown properties survive.
- **`execute` contract tests:** every API function, error path, rollback and edit patch.
- **Agent evals (phase 1 end):** a fixed set of prompts run through Claude Code, scored on layout problems, lint findings and token usage.
