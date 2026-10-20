# 03 · Product requirements

**English** · [Русский](../ru/03-prd.md)

## Personas

| Persona | Context | Needs |
|---|---|---|
| **Agent-driven developer** (primary) | Builds apps with Claude Code; wants to explore UI visually before coding | The agent designs in a file next to the code; screenshots in the chat; no limits |
| **pen.dev refugee** | Has dozens of `.pen` files; free plan now limits agent work | Open, edit, save existing files; same agent workflow |
| **Hands-on designer** (phase 2) | Tweaks what the agent produced | A real canvas: select, drag, edit text, change colours, undo |
| **Tool builder / CI** | Wants design checks in pipelines | Headless render, lint, export; stable CLI |

## Key scenarios

1. **Design a screen from a prompt.** In Claude Code: "Design the onboarding screen in `design/app.pen`". The agent reads the skill, picks a style archetype or the project's tokens, builds the screen in a few `execute` calls, attaches screenshots and fixes problems. The file is saved; the user sees a screenshot in chat (phase 1) or live on the canvas (phase 2).
2. **Iterate on an existing pen.dev file.** "Make the pricing cards denser and add a yearly toggle." The agent reads the relevant subtree, edits instances through `descendants`, and verifies. The file still opens in pen.dev.
3. **Design → code.** "Implement the Settings screen in our Next.js app." The agent reads components and variables, maps tokens to the project's CSS, and compares the result with a render.
4. **Code → design.** "Recreate our existing `Button` and `Card` components in the design file." Tokens from `globals.css` become `.pen` variables; components become `reusable` frames.
5. **Explore variants.** "Give me three directions for the hero." Three placeholder frames side by side, each built and screenshotted (phase 3: in parallel by sub-agents).
6. **CI check.** `tusche render design/app.pen --out shots/` and `tusche lint design/app.pen` in GitHub Actions.

## Requirements — Phase 1 (MVP "companion")

### Functional

| ID | Requirement | Priority |
|---|---|---|
| F1 | Open `.pen` files of versions 2.x (at least 2.6–2.21); unknown properties preserved | Must |
| F2 | Save `.pen` as canonical JSON (stable key order, 2-space indent, LF, trailing newline) | Must |
| F3 | MCP server over stdio with tools `get_app_state`, `read_skill`, `get_style`, `execute`, `open_document`, `save_document` | Must |
| F4 | `execute` API per [06-agent-api](06-agent-api.md): transactional, `edits`/`editId` retry, names map, warnings | Must |
| F5 | `Get` visitor with `ctx.bounds` and `ctx.problems`, computed by the OpenPencil layout engine | Must |
| F6 | `TakeScreenshot` returns PNG images inside the MCP response | Must |
| F7 | `Export` to PNG / JPEG / WEBP / PDF / SVG; HTML + Tailwind as a stretch goal | Should |
| F8 | Components: `reusable`, `ref`, `descendants` overrides (property and replacement), slots | Must |
| F9 | Variables and themes: `$name` references, themed values, `SetVariables` / `GetVariables` | Must |
| F10 | Icons (lucide first, then Material Symbols and phosphor) rendered as vectors | Should |
| F11 | Our own skill (SKILL.md plus guides) served by `read_skill` | Must |
| F12 | At least 8 style archetypes served by `get_style` | Should |
| F13 | Headless CLI: `tusche render`, `tusche exec`, `tusche lint`, `tusche mcp` | Must |
| F14 | Live preview: a local web page that re-renders the open document on every change | Should |
| F15 | Proxy to selected OpenPencil analysis tools (`lint`, `analyze_*`) | Could |

### Non-functional

| ID | Requirement |
|---|---|
| N1 | Warm `execute` with no screenshot: < 300 ms for a 1,000-node document |
| N2 | Warm screenshot of a 1440×1024 frame: < 1.5 s |
| N3 | Round trip `.pen` → Tusche → `.pen` with no edits is byte-identical after canonicalisation |
| N4 | Runs on Windows, macOS and Linux with Bun ≥ 1.3 or Node ≥ 22 |
| N5 | The sandbox cannot touch the file system or network except through API functions |
| N6 | No network access at runtime except fetching fonts and icons, which are cacheable and can be disabled |

## Requirements — Phase 2 (desktop)

- Tauri app built on `@open-pencil/vue` and `@open-pencil/core/editor`; `.pen` opened and saved natively.
- Human editing: select, move, resize, text edit, fills, layout panel, layers panel, undo/redo shared with the agent.
- Agent panel that runs the user's installed `claude` CLI (or Codex / Gemini CLI) with Tusche's MCP preconfigured.
- Prompt / note / context nodes on the canvas, as in pen.dev.
- Live agent cursor and `placeholder` frames rendered as "in progress".
- Browser import: load a URL and convert the DOM to layers (reusing OpenPencil's HTML import).

## Requirements — Phase 3

- Parallel agents (split work / several variants), via sub-agents of the user's CLI.
- Component libraries across files (`imports`).
- Two-way design-token sync with CSS / Tailwind.
- Optional image and SVG generation through the user's own MCP servers.

## Out of scope

Prototyping and animation, multiplayer servers, hosted models, plugins marketplace, `.fig` as a save target, pixel parity with pen.dev's renderer.

## Success metrics

- The 6 key scenarios pass end to end on the maintainers' real files.
- 100% of the user's existing `.pen` files open; ≥ 95% render without visible defects.
- Average agent tokens per finished screen ≤ pen.dev's on the same prompt, measured on a benchmark set.
