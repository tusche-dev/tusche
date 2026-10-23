# @tusche/cli

The `tusche` command line.

Part of [Tusche](https://github.com/tusche-dev/tusche), an open design canvas for AI agents. Install with `npm i -g @tusche/cli` or run `npx @tusche/cli <command>`.

| Command | What it does | Exit code |
|---|---|---|
| `tusche mcp` | The MCP server on stdio ([@tusche/mcp](../mcp/README.md)) | — |
| `tusche exec <file.pen> <script.js \| ->` | One `execute` call, saved right away; `--create`, `--out <dir>` for screenshots | 1 if the snippet failed |
| `tusche render <file.pen>` | PNG of every top-level node or `--node <id>…`; `--scale`, `--max-side` (no limit by default), `--out <dir>` (default `<name>.renders`) | 1 if a `--node` has nothing to render |
| `tusche export <file.pen> --format <f> --out <path>` | `png`, `jpeg`, `webp`, `svg`, `html-tailwind`; with `--node` one file of those nodes, without it one file per top-level node in the `--out` folder | 1 on a failed export |
| `tusche lint <file.pen>` | Validator, the checks of `execute` and OpenPencil design rules; `--node`, `--info`, `--format text\|json` | 1 on errors |
| `tusche validate <file.pen>` | The `.pen` schema; `--info` | 1 on errors |
| `tusche migrate <file.pen>` | Writes the file in the current format version, keeping its style; `--dry-run` | — |
| `tusche preview <file.pen>` | Live preview in the browser ([@tusche/preview](../preview/README.md)); `--port <n>` (default 4848 or the next free one, `0` for any), `--open`; runs until Ctrl+C | — |

Exit code 2 means a wrong invocation. Environment: `TUSCHE_FONTS_OFFLINE=1`, `TUSCHE_ALLOW_REMOTE_ASSETS=1`, `TUSCHE_ROOT`, `TUSCHE_CACHE_DIR`.
