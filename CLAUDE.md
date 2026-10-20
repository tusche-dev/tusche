# CLAUDE.md — Tusche

Guidance for AI agents working on this repository.

## What this is

Tusche is an open-source, agent-first design canvas: the `.pen` format natively, OpenPencil's engine underneath, a pen.dev-style `execute` API on top. Start with `README.md`, then `docs/en/04-architecture.md` and `docs/en/06-agent-api.md`.

**Current phase: 0 (specification).** No product code yet. Do not scaffold packages unless the task says so.

## Rules

- **Docs are bilingual.** Every file in `docs/en/` has a mirror with the same name in `docs/ru/`, and every ADR in `docs/adr/en/` has one in `docs/adr/ru/`. When you change one, change the other in the same commit. The first line under the title links to the other language.
- **Clean room.** Never copy text, code or assets from pen.dev, including the files of its installed app. Implement `.pen` from the public schema (https://docs.pencil.dev/for-developers/the-pen-format) and `docs/en/05-pen-format.md`.
- **Architecture changes need an ADR** (`docs/adr/en/NNN-title.md` + `docs/adr/ru/NNN-title.md`; sections: Status, Context, Decision, Consequences).
- **Only `@tusche/engine` imports `@open-pencil/core`.** Everything else goes through it, so OpenPencil API churn is isolated.
- **The `.pen` tree is the source of truth**; the OpenPencil scene graph is a derived projection (ADR-002).
- Stack: Bun workspaces, TypeScript (strict, ESM), Valibot for schemas, QuickJS (WASM) for the sandbox, Tauri v2 for desktop (phase 2). See ADR-005.
- Commit style: Conventional Commits.

## Map

```
docs/en, docs/ru     01-vision … 08-roadmap (mirrored)
docs/adr/en, /ru     000-name … 005-stack (mirrored)
packages/            (phase 1) pen-format, pen-bridge, engine, exec, mcp, skill, styles, cli
apps/                (phase 1) preview, (phase 2) desktop
```
