# Architecture Decision Records

**English** · [Русский](../ru/README.md)

| ADR | Title | Status |
|---|---|---|
| [000](000-name.md) | Project name: Tusche (working title) | Accepted |
| [001](001-build-on-openpencil.md) | Build on OpenPencil's packages (no fork, no own engine) | Accepted |
| [002](002-pen-native-format.md) | `.pen` is the native format, and its tree is the source of truth | Accepted |
| [003](003-quickjs-execute-sandbox.md) | `execute` runs agent JavaScript in a QuickJS (WASM) sandbox | Accepted |
| [004](004-agent-connection.md) | Connecting agents: MCP for external agents; spawn the user's own CLI in the app | Accepted (phase 2 part to re-validate) |
| [005](005-stack-bun-tauri-rust.md) | Stack: TypeScript on Bun for the core; Rust only in the Tauri shell | Accepted |

Template: **Status · Date · Context · Decision · Consequences**. New ADRs take the next number; every ADR exists in `en/` and `ru/` with the same file name.
