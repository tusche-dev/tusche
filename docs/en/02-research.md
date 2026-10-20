# 02 · Research: pen.dev and OpenPencil

**English** · [Русский](../ru/02-research.md)

Research date: 2026-10-20. Sources: public docs and websites (linked), the locally installed pen.dev desktop app (only plain-text files it ships, such as its agent skill; no binaries or code were decompiled), and hands-on tests of the published `@open-pencil/*` npm packages.

## 1. pen.dev (formerly Pencil)

### Company and product

- Made by High Agency, Inc. (CEO Tom Krcha), part of a16z speedrun. Launched January 2026 as *Pencil* (pencil.dev); renamed to *pen.dev* in August–September 2026. About 100,000 users by February 2026.
- Distribution: desktop app (macOS, Windows, Linux), VS Code / Cursor extension (`highagency.pencildev`), CLI `@pen.dev/cli`, web importer.
- Closed source. The EULA forbids reverse engineering. The `.pen` format schema is published openly.
- Docs: <https://docs.pencil.dev> (also docs.pen.dev). Pricing: <https://pen.dev/pricing>. Terms: <https://pen.dev/terms-of-use>, <https://pen.dev/eula>.

### Technology (observed in the installed desktop app)

- Electron 44 shell; the editor is a web app (`out/editor/index.js`, ~7.6 MB).
- Custom renderer: a ~9.5 MB WebAssembly module (`pencil-*.wasm`) plus Emscripten modules; the website mentions a "custom WebGL pipeline". Third-party analysis points at a Skia/CanvasKit-based build.
- QuickJS compiled to WASM (`quickjs-wasi`): the sandbox for agent `execute` snippets and `script` nodes.
- Embedded agent runtimes: Claude Agent SDK, OpenAI Codex SDK, Cursor SDK, and the `pi` agent framework, so the built-in agent panel can drive several providers.
- MCP server: a separate native binary (`mcp-server-windows-x64.exe`) speaking stdio to the client and a local socket / named pipe to the running app. Installed for Claude Code as `… --app desktop --agent claudeCodeCLI`.
- Bundled design kits as `.pen` files: shadcn, HeroUI, Halo, Lunaris, Nitro.

### The `.pen` format

- JSON, current schema version `2.21`, published at <https://docs.pencil.dev/for-developers/the-pen-format>. See our spec: [05-pen-format](05-pen-format.md).
- **Not encrypted on disk.** pen.dev's MCP server still tells agents ".pen files are encrypted: access them only via the MCP tools", and early 2026 reviews repeat that. But all real files we inspected are plain UTF-8 JSON (`{"version": "2.21", "children": [...]}`). The user's files span versions 2.6, 2.17, 2.18 and 2.21. Interoperability through the published schema is fully feasible.

### Agent experience (the part worth learning from)

The MCP surface is deliberately tiny:

| Tool | Purpose |
|---|---|
| `get_app_state` | Active document, selection, account state, and how to start |
| `read_skill` | Returns the design skill (SKILL.md plus referenced guides) |
| `get_style` | ~26 visual style archetypes with configurable fonts, colours and imagery |
| `execute` | Runs a small JavaScript snippet against the document |
| `browser` | Live web page in an embedded browser: import DOM to editable layers, screenshot, CDP |

Key design ideas of `execute`, from its public skill documentation:

- **One snippet = one transaction.** If any line throws, every change is rolled back.
- **Patch, don't resend.** A failed call returns an `editId`; the agent retries by sending `edits` (`find`/`replace` pairs) against the failed snippet. This saves many tokens on long snippets.
- **Tiny vocabulary:** `Insert`, `Copy`, `Update`, `Replace`, `Move`, `Delete`, `SetVariables`, `GetVariables`, `Get`, `FindEmptySpace`, `Print`, `TakeScreenshot`, `Export`, `Generate`.
- **Visitor reads with layout diagnostics:** `Get(root, (node, ctx) => …)` gives `ctx.bounds` (resolved layout) and `ctx.problems` (`"partially clipped"` / `"fully clipped"`). The agent verifies structure without a screenshot.
- **Names → ids map** returned after each call, so later calls can refer to what was just created.
- **Persistent globals:** assignments without `const` / `let` survive between calls.
- **`placeholder: true`** marks frames under construction; the UI shows them as in progress.
- **Screenshots are explicit and attached to the same call** (`TakeScreenshot([id])`), so a section is built and checked in one round trip.

The skill teaches taste as well as API: keep the document root clean, build repeated UI as components first, verify each section immediately, never draw logos from paths, avoid "everything in a card", avoid excessive gradients and shadows, never guess text dimensions.

### Pricing (since about 15 October 2026)

| | Free | Pro | Ultra |
|---|---|---|---|
| Price | $0 | $16 / user / month (annual) | $48 / user / month (annual) |
| Days with agent work | **5 per month** | unlimited | unlimited |
| Parallel agents | 1 | 3 | 6 |
| Image / SVG generations | 25 | 350 | 750 |

The editor, local files, components, variables, import and export are free on every plan. The limit that matters: **any day on which an agent works in pen.dev counts, including an external agent over MCP using the user's own subscription.**

### Strengths and weaknesses

- ➕ Excellent agent ergonomics; strong design skill; style archetypes; live browser import; files in git.
- ➖ Closed source, now metered. No real multiplayer. Large files are slow. Generated code is not 1:1 with the design.

## 2. OpenPencil (open-pencil/open-pencil)

- <https://github.com/open-pencil/open-pencil> · <https://openpencil.dev> · MIT (cloud package Apache-2.0). Created 2026-02-27; v0.16.0 on 2026-10-14; ~9.1k stars. Primary author Danila Poyarkov (`dannote`), ~90% of commits. Installed locally (v0.16.0).
- **Stack:** Vue 3 + Reka UI + Tailwind 4; Tauri v2 desktop (~15 MB) or PWA; Skia via CanvasKit WASM on WebGL; Yoga WASM fork with CSS Grid; Kiwi + Zstd for `.fig`; Yjs + WebRTC (Trystero) for P2P collaboration; Vercel AI SDK (bring your own key); Bun monorepo.
- **Packages on npm (0.16.0, MIT):** `@open-pencil/core` (subpaths `editor`, `canvas`, `canvaskit`, `layout`, `tools`, `design-jsx`, `io`, `io/formats/*`, `lint`, `xpath`, `rpc`, `figma-api`, …), `scene-graph`, `pen`, `fig`, `kiwi`, `design-jsx`, `dom-css`, `emit`, `vue`, `mcp`, `cli`.
- **Agent surface:** 100+ granular MCP tools (create, update, layout, boolean, path, variables, components), JSX `render` / `get_jsx`, `diff_*` including visual diff, `lint` / `lint_fix`, `analyze_colors|typography|spacing|clusters|overlaps`, `design_to_tokens`, and `eval` with a Figma-Plugin-compatible API. The desktop app exposes RPC on `127.0.0.1:7600`, MCP over HTTP at `/mcp` and a WebSocket bridge on `:7601`; stdio and headless modes also exist.
- **Gaps:** no prototyping; partial masks, grid layout and style management; incomplete RTL; the API is unstable (0.x); bus factor ≈ 1.

### Hands-on tests (2026-10-20, Bun 1.3.14, Windows 11)

**`.pen` import with `@open-pencil/pen`.** The package is a reader only: `parsePenFile(json) → SceneGraph`. **There is no writer.** Results on the user's real files:

| File | Version | Result |
|---|---|---|
| `eval/design.pen` (335 KB) | 2.17 | Parsed in 46 ms. 184 frames, 134 texts, 360 refs → instances. |
| `negolosom/app.pen` (802 KB) | 2.21 | Parsed in 1.4 s; instance expansion produced ~39k scene nodes. |
| `negolosom/website.pen` | 2.18 | Parsed in 19 ms. |
| `b2bzakup-ru/main.pen` | ? | **Failed:** `Object.values requires that input parameter not be null` |

Type mapping covers `frame`, `rectangle`, `ellipse`, `text`, `path`, `ref`, and icons as text glyphs. **Not mapped:** `polygon`, `note`, `prompt`, `context`, `script`, `browser`; fill types `shader` and `mesh_gradient`.

**Headless rendering with `@open-pencil/core/io/formats/raster`.**

- Works under Bun on Windows **after fixing a bug**: `headless.ts` builds the CanvasKit path with `new URL('.', …).pathname`, which yields `/C:/…` on Windows. Replacing it with `fileURLToPath` fixes it. This should be an upstream PR.
- A 1180×760 frame rendered in 4–6 s cold (CanvasKit init plus font loading). Warm renders should be far faster; to be measured in phase 1.
- Visual fidelity on a real design was good: Cyrillic text, variables, components and layout were all correct.
- Two defects on that design:
  - shader fills rendered **black**;
  - fills on component-instance states were missing, probably from theme-dependent variable resolution.

Both belong in `pen-bridge` and its tests.

## 3. Also relevant: ZSeven-W/openpencil

- <https://github.com/ZSeven-W/openpencil> — a different project with the same name. MIT, ~6.3k stars, created 2026-02-17, active.
- **Rust core** with a WASM renderer, single native binary with no browser engine, its own JSON format `.op`, `.pen` UI kits import only, MCP server, CLI `op`, "Concurrent Agent Teams", code export to many frameworks.
- Relevance: it proves a Rust-first agent canvas is viable, but it is a whole separate engine and format. We do not build on it. See [ADR-005](../adr/en/005-stack-bun-tauri-rust.md). Its style-guide library and multi-framework export are ideas to revisit in phase 3.

## 4. Synthesis

| Take | From | Why |
|---|---|---|
| Renderer, layout, scene graph, `.fig`, export, lint, analysis | OpenPencil packages | A Figma-grade engine for free; we only fix and contribute |
| `.pen` as the native format | pen.dev's public schema | Existing files keep working; clean git diffs |
| `execute`: transactional snippets, patch-on-error, visitor diagnostics, names map | pen.dev's idea, our implementation | Best known agent ergonomics |
| Skill and style archetypes | pen.dev's idea, our own texts | Good design by default |
| BYO agent, no metering | — | The reason this project exists |

## 5. Risks found

| Risk | Mitigation |
|---|---|
| `@open-pencil/pen` is read-only and lossy | Own `pen-format` and `pen-bridge` packages; keep the raw `.pen` tree as source of truth (see [04-architecture](04-architecture.md)) |
| OpenPencil API churn (0.x) | Pin exact versions; isolate all engine calls behind `pen-bridge` and `engine` adapters |
| pen.dev changes the `.pen` schema | Version-gated migrations; unknown properties are preserved |
| Windows bugs in headless paths | Upstream PRs; local patch via `patch-package` / `bun patch` until merged |
| Using a Claude subscription inside a third-party app | Never embed OAuth; spawn the user's own `claude` CLI ([ADR-004](../adr/en/004-agent-connection.md)) |
