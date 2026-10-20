# @tusche/mcp

The Tusche MCP server: stdio transport, server name `tusche`.

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.

```ts
import { serveStdio } from '@tusche/mcp';

await serveStdio({ version: '0.1.0' }); // what `tusche mcp` runs
```

`createServer({ executor, cwd?, version? })` returns the `McpServer` without a transport (tests connect it to a client in memory).

| Tool | Input | Answer |
|---|---|---|
| `get_app_state` | — | Active and open documents (unsaved, conflict, undo/redo depth), versions, where to start |
| `read_skill` | `path?` | `SKILL.md` or a file it links to |
| `get_style` | `name?`, `params?` | The archetype list, or one style as JSON with a `SetVariables` payload |
| `open_document` | `filePath`, `create?`, `reload?` | Top-level nodes, components, variables and themes |
| `save_document` | `filePath?` | Writes now, also over a file that changed on disk |
| `execute` | `filePath?`, `input` or `editId` + `edits` | The `execute` text answer plus PNG images; `isError` when the snippet failed |
| `render` | `filePath?`, `nodeIds` (≤ 6), `scale?` | PNG images |
| `lint` | `filePath?`, `nodeId?`, `info?` | Findings of `lintDocument`, errors first |
| `undo` / `redo` | `filePath?`, `steps?` | Steps done, undo/redo depth |

Without `filePath` a tool works on the active document: the one opened or used last. Relative paths are resolved against the working folder of the process. Before each tool the file is checked against the disk; changes are written 300 ms after the last commit and before the process exits ([ADR-009](../../docs/dev/adr/009-mcp-sessions.md)). Tool descriptions and answers are in English.

Environment: `TUSCHE_FONTS_OFFLINE=1` (no font downloads), `TUSCHE_ALLOW_REMOTE_ASSETS=1`, `TUSCHE_ROOT` (another folder `Export` may write to).
