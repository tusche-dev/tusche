# Changelog

All notable changes to Tusche. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). All `@tusche/*` packages share one version.

## [0.1.0] — 2026-10-23

The first release: an MCP server, a CLI and a live preview that let your own coding agent design on a `.pen` canvas.

### Added

- **`@tusche/cli`** — the `tusche` command: `mcp`, `exec`, `render`, `export` (PNG, JPEG, WebP, SVG, HTML + Tailwind), `lint`, `validate`, `migrate`, `preview`. Runs on Node.js ≥ 22 and Bun ≥ 1.3.
- **`@tusche/mcp`** — MCP server on stdio: `execute`, `render`, `lint`, `undo`/`redo`, `open_document`, `save_document`, `get_app_state`, `get_style`, `read_skill`.
- **`@tusche/exec`** — the `execute` engine: agent JavaScript in a QuickJS sandbox, transactional snippets, edits, warnings, undo and deferred saving.
- **`@tusche/engine`** — headless OpenPencil: layout, bounds by pen path, PNG rendering, export and design lint.
- **`@tusche/preview`** — live view of a `.pen` file in the browser; it follows every save of the file.
- **`@tusche/pen-format`** and **`@tusche/pen-bridge`** — the `.pen` schema, style-preserving serialization, migrations and the projection into OpenPencil's scene graph. Files edited in Tusche open in pen.dev.
- **`@tusche/skill`** (0.1.1) and **`@tusche/styles`** — the agent skill with seven guides and eight style archetypes.

### Notes

- Until our fixes ship in OpenPencil, the engine depends on `@tusche/open-pencil-core` and `@tusche/open-pencil-dom-css`: the upstream 0.16.0 packages with [our patches](patches/).

[0.1.0]: https://github.com/tusche-dev/tusche/releases/tag/v0.1.0
