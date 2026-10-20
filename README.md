# Tusche

**English** · [Русский](README.ru.md)

> *Tusche* (German; Russian *тушь*) — drawing ink.

**Tusche is a free, open-source design canvas for AI agents.** Your coding agent (Claude Code, Codex, any MCP client) designs app screens, dashboards, landing pages and slides on an infinite canvas, checks its own work with screenshots, and saves everything to a plain JSON file next to your code. It runs on *your own* agent subscription. No account, no limits.

- **Bring your own agent.** Connect it once over MCP; Tusche never meters anything.
- **Opens your pen.dev files.** `.pen` is the native format; files stay compatible.
- **Built on [OpenPencil](https://github.com/open-pencil/open-pencil)'s engine:** Skia rendering, flex layout, components, variables and themes.
- **Git-friendly:** canonical JSON, small diffs, lint and render in CI.

## Status

🚧 **Not released yet.** The project is in phase 1: building the first usable version (MCP server + CLI + live preview). The `.pen` format package and the headless renderer are done; the `execute` sandbox is next. See the [roadmap](docs/dev/08-roadmap.md) (in Russian).

## Quick start (phase 1 preview)

```bash
claude mcp add tusche -- npx -y @tusche/cli mcp
```

Then ask Claude Code: *"Design an onboarding screen in `design/app.pen`."*

## User guide

- [Getting started](docs/guide/en/getting-started.md)
- [CLI reference](docs/guide/en/cli.md)
- [FAQ](docs/guide/en/faq.md)

## For contributors

Development docs (vision, architecture, `.pen` spec, agent API, ADRs) are written in **Russian** and live in [`docs/dev`](docs/dev/). See [CONTRIBUTING](CONTRIBUTING.md).

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for third-party components and trademarks. Tusche is not affiliated with High Agency (pen.dev), OpenPencil or Figma.
