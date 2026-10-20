# CLI reference

**English** · [Русский](../ru/cli.md)

> **Status: preview of phase 1.** Commands may still change before the first release.

Install globally with `npm i -g @tusche/cli` (or `bun add -g @tusche/cli`), or run any command with `npx @tusche/cli <command>`.

| Command | What it does |
|---|---|
| `tusche mcp` | Start the MCP server on stdio. This is what your agent runs. |
| `tusche preview <file.pen>` | Open a live preview in the browser that updates on every change. |
| `tusche render <file.pen> [--node <id>…] [--scale 2] [--out dir/]` | Render top-level frames (or the given nodes) to PNG. |
| `tusche export <file.pen> --format png\|jpeg\|webp\|pdf\|svg [--node <id>…] --out <path>` | Export nodes to image or PDF files. |
| `tusche exec <file.pen> <script.js>` | Run an `execute` snippet against a file, without an agent. Useful for scripted edits. |
| `tusche lint <file.pen>` | Report layout and design problems: clipped content, invisible text, unknown fonts, and more. Exit code 1 on errors. |
| `tusche validate <file.pen>` | Check the file against the `.pen` schema. |
| `tusche migrate <file.pen>` | Upgrade an older `.pen` file to the current format version. |

## Environment variables

| Variable | Meaning |
|---|---|
| `TUSCHE_ROOT` | Extra directory where `Export` is allowed to write (by default only next to the `.pen` file) |
| `TUSCHE_ALLOW_REMOTE_ASSETS=1` | Allow image fills with `http(s)` URLs |
| `TUSCHE_FONTS_OFFLINE=1` | Never download fonts; use cached and system fonts only |

## Example: check designs in CI

```yaml
# .github/workflows/design.yml
- run: npx @tusche/cli lint design/app.pen
- run: npx @tusche/cli render design/app.pen --out design/shots
```
