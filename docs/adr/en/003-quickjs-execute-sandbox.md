# ADR-003 · `execute` runs agent JavaScript in a QuickJS (WASM) sandbox

**English** · [Русский](../ru/003-quickjs-execute-sandbox.md)

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The core agent tool runs JavaScript snippets written by an LLM. Requirements:

- **Isolation:** no file system, network or process access except through our API.
- **Limits:** CPU time, memory, operation count.
- **Transactions:** roll back everything on error.
- **Persistent globals** between calls, per document.
- Runs the same under Bun, Node, Tauri and the browser (preview).

Options:

1. `node:vm` / Bun `ShadowRealm`-like contexts. Not a security boundary; runtime-specific.
2. Declarative JSON operations only (like OpenPencil's `batch_update`). Safe, but loses loops and helpers, which are what make snippets short.
3. A **QuickJS engine compiled to WebAssembly** (`quickjs-emscripten` / `quickjs-wasi`). A real interpreter boundary, portable, with interrupt and memory limits. pen.dev uses the same class of solution.

## Decision

Option 3, with `quickjs-emscripten` (MIT) unless a benchmark in milestone 1.4 favours another WASM build.

- Host functions (`Insert`, `Get`, …) are bound into the VM. Arguments are copied in as JSON, results copied out. No host objects leak in.
- An interrupt handler enforces the time limit; the runtime has a memory cap.
- Globals persist by serialising **only JSON-compatible own properties** that the snippet assigned on the global object, stored per `DocumentSession`.
- Transactions are implemented on the host side (structural-sharing snapshot of the `PenDocument`), independent of the VM.
- The snippet is lightly preprocessed: line numbers are kept for error messages, and nothing is transpiled. Agents write plain ES2020.

## Consequences

- ➕ Safe to run untrusted agent code; the same engine everywhere.
- ➕ Short snippets with loops and helpers → fewer tokens than granular tools.
- ➖ The host ↔ VM JSON copy costs time on huge `Get` results. Mitigation: visitors run **inside** the VM over a lazily materialised tree, and only collected values are returned.
- ➖ QuickJS is slower than V8 for heavy computation; acceptable for design snippets.
