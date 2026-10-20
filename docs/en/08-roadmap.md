# 08 · Roadmap

**English** · [Русский](../ru/08-roadmap.md)

Estimates assume one developer working with a coding agent. They are rough and exist to order the work, not to promise dates.

## Phase 0 — Specification ✅

Vision, research, PRD, architecture, `.pen` spec, agent API, skill draft, ADRs; bilingual. Hands-on validation of OpenPencil packages (done 2026-10-20).

## Phase 1 — MCP companion (≈ 4–6 weeks)

Goal: Claude Code designs in `.pen` through Tusche with screenshots; files stay pen.dev-compatible.

| Milestone | Content | Done when |
|---|---|---|
| 1.1 Repo scaffold | Bun workspaces, TS strict, Biome/ESLint, Vitest (or `bun test`), CI on Windows / macOS / Linux | `bun run check` green in CI |
| 1.2 `pen-format` | Types, Valibot schema, validator, canonical writer, migrations 2.6→2.21, fixtures from real files | All fixture files round-trip byte-identically; validation errors are readable |
| 1.3 `pen-bridge` + `engine` | Projection to the scene graph (frames, shapes, text, icons, refs, variables/themes, fills, effects); layout; bounds by pen id; headless PNG | Golden renders of 5 real files match a reviewed baseline; shader / script / browser show placeholders |
| 1.4 `exec` | QuickJS sandbox, full API, transactions, edits / editId, names map, warnings, globals | Contract tests for every function and error path |
| 1.5 `mcp` + `cli` | Tools from [06-agent-api](06-agent-api.md); `tusche mcp`, `exec`, `render`, `lint`, `validate` | `claude mcp add tusche -- tusche mcp` works; scenario 1 from the PRD passes |
| 1.6 Skill + styles | Skill v0.1 from the draft, 8 archetypes, eval harness | Eval baseline recorded |
| 1.7 Preview | `tusche preview` web page with live reload | The agent's work is visible live in the browser |
| 1.8 Upstream | PRs to OpenPencil: Windows CanvasKit path fix, `.pen` mapping fixes found on the way | PRs opened |
| 1.9 Release | npm `@tusche/*` 0.1.0, README quick start, demo video | Public announcement |

**Exit criteria:** PRD scenarios 1, 2 and 6 pass; 100% of the maintainers' `.pen` files open; files edited by Tusche open in pen.dev.

## Phase 2 — Desktop (≈ 6–10 weeks)

- Tauri v2 app with `@open-pencil/vue`: canvas, layers, inspector for pen properties, text editing, undo shared with the agent.
- Reverse mapping: human edits → `.pen` updates.
- Agent panel that spawns the user's `claude` / `codex` / `gemini` CLI with Tusche's MCP preconfigured; streaming log; stop button.
- Prompt / note / context nodes; `placeholder` visuals; agent cursor.
- Browser import (URL → layers) through OpenPencil's HTML import.
- Shader fills through CanvasKit RuntimeEffect (GLSL → SkSL translation for common cases).
- Installers for Windows, macOS and Linux; auto-update.

**Exit:** PRD scenarios 3–5 pass in the app; a non-developer can tweak an agent-made screen by hand.

## Phase 3 — Power features

- Parallel agents / variants (split work across frames; "N directions" mode).
- `imports`: component libraries across files; bundled open kits (our own, or permissively licensed ones such as shadcn-style).
- Two-way design-token sync with CSS / Tailwind v4.
- `script` nodes executed in the sandbox.
- Optional collaboration through OpenPencil's Yjs / WebRTC layer.

## Continuous

- Track pen.dev schema changes (version bumps) → migrations.
- Track OpenPencil releases → pin, test, upgrade.
- Keep EN / RU docs in sync.
