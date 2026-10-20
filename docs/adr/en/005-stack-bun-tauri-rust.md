# ADR-005 · Stack: TypeScript on Bun for the core; Rust only in the Tauri shell

**English** · [Русский](../ru/005-stack-bun-tauri-rust.md)

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The question "should this be written in Rust?" came up explicitly. Facts:

- The heavy lifting is already compiled native code shipped as WASM: Skia (C++, via CanvasKit) for rendering and Yoga (C++) for layout. Rewriting them in Rust (vello, taffy) would be building our own engine, which ADR-001 rejects.
- Our own code is: format handling, a bridge, an API layer, an MCP server, a sandbox host, UI. This is I/O and glue, not number crunching.
- The `@open-pencil/*` packages are TypeScript; their desktop shell is Tauri (Rust).
- Agents write `execute` snippets in JavaScript, so the API they see is a JS API anyway.
- ZSeven-W/openpencil shows a Rust-core design tool is viable, but it is a separate engine with its own format (see [02-research](../../en/02-research.md)).

## Decision

- **Core packages:** TypeScript (strict, ESM) in a **Bun** workspace. Bun is fast for tests and scripts; published packages also run on Node ≥ 22. Same toolchain as OpenPencil.
- **Schemas:** Valibot (also used by OpenPencil and its MCP).
- **MCP:** the official TypeScript MCP SDK.
- **Sandbox:** QuickJS in WASM (ADR-003).
- **Desktop (phase 2):** **Tauri v2**. Its Rust side handles what Rust is good at: native windows and menus, file associations, file watching, the keychain, auto-update, and spawning and supervising agent CLIs (ADR-004). Electron is rejected: a ~200 MB app, which is exactly what pen.dev ships.
- **When Rust becomes a candidate for more:** if profiling in phase 1 shows a hot path that matters, e.g. canonical serialisation of very large documents or instance expansion, we can move it into a Rust → WASM module without changing the architecture.

## Consequences

- ➕ One language across core, MCP, preview and the desktop front-end; fastest path to an MVP; easy contributions.
- ➕ Rust is used where it adds value, with a clear path to use more.
- ➖ The Tauri phase needs some Rust skills for the shell.
- ➖ JavaScript performance limits for very large documents; mitigated by lazy instance expansion and incremental projection.
