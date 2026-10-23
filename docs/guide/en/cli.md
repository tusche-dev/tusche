# CLI reference

**English** · [Русский](../ru/cli.md)

Install globally with `npm i -g @tusche/cli` (or `bun add -g @tusche/cli`), or run any command with `npx @tusche/cli <command>`.

| Command | What it does |
|---|---|
| `tusche mcp` | Start the MCP server on stdio. This is what your agent runs. |
| `tusche preview <file.pen> [--port n] [--open]` | Serve a live preview at `http://127.0.0.1:4848/` (or the next free port). The page redraws whenever the file is saved, by the agent or anyone else. Drag or scroll to pan, Ctrl/⌘ + scroll to zoom, click a layer to see its id. `--open` opens the browser. Runs until Ctrl+C. |
| `tusche render <file.pen> [--node <id>…] [--scale 2] [--max-side px] [--out dir/]` | Render top-level frames (or the given nodes) to PNG, one file per node, `<id>.png`. The default folder is `<name>.renders`. |
| `tusche export <file.pen> --format png\|jpeg\|webp\|svg\|html-tailwind [--node <id>…] --out <path>` | Export nodes to files. With `--node`, one file with those nodes; without it, one file per top-level frame in the `--out` folder. PDF is not available yet. |
| `tusche exec <file.pen> <script.js \| -> [--create] [--out dir/]` | Run an `execute` snippet against a file, without an agent (`-` reads it from stdin). The file is saved right away; screenshots go to `--out`. Exit code 1 if the snippet fails. |
| `tusche lint <file.pen> [--node <id>] [--info] [--format text\|json]` | Report layout and design problems: clipped content, invisible text, unknown fonts, low contrast, tiny text, and more. Exit code 1 on errors. |
| `tusche validate <file.pen> [--info]` | Check the file against the `.pen` schema. Exit code 1 on errors. |
| `tusche migrate <file.pen> [--dry-run]` | Upgrade an older `.pen` file to the current format version, keeping its formatting. |

Exit code 2 means a wrong command or option. `tusche --help` lists everything.

## Running from source

To try unreleased changes, clone the repository, run `bun install`, and use `bun <repo>/packages/cli/src/index.ts <command>` wherever this page says `tusche`.

## Environment variables

| Variable | Meaning |
|---|---|
| `TUSCHE_ROOT` | Extra directory where `Export` is allowed to write (by default only next to the `.pen` file) |
| `TUSCHE_ALLOW_REMOTE_ASSETS=1` | Allow image fills with `http(s)` URLs |
| `TUSCHE_FONTS_OFFLINE=1` | Never download fonts; use cached and system fonts only |
| `TUSCHE_CACHE_DIR` | Where downloaded fonts and icons are cached (default `~/.cache/tusche`) |
| `TUSCHE_CALL_LOG` | `tusche mcp` only: append one JSON line per tool call to this file (tool, result, timing; used by the skill evals) |

## Example: check designs in CI

```yaml
# .github/workflows/design.yml
- run: npx @tusche/cli lint design/app.pen
- run: npx @tusche/cli render design/app.pen --out design/shots
```
