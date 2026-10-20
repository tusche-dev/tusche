# Tusche

**English** · [Русский](README.ru.md)

> *Tusche* (German; Russian *тушь*) — drawing ink. The name is a working title, see [ADR-000](docs/adr/en/000-name.md).

**Tusche is an open-source, agent-first design canvas.** Your coding agent (Claude Code, Codex, any MCP client) draws, edits and verifies UI designs on an infinite canvas — using *your own* agent subscription, with no per-day limits and no account.

It combines:

- the **rendering engine of [OpenPencil](https://github.com/open-pencil/open-pencil)** (MIT): Skia/CanvasKit rendering, Yoga flex/grid layout, a Figma-grade scene graph, `.fig` import, PNG/SVG/PDF export;
- the **agent experience popularised by pen.dev**: a tiny MCP surface built around one transactional `execute` tool, a design skill that teaches the agent good taste, style archetypes, and screenshot-driven self-verification;
- the **open `.pen` file format** as the native format — plain JSON next to your code, diffable in git, compatible with files you already have.

## Status

**Phase 0 — research and specification.** There is no product code yet. This repository currently contains the vision, research, specifications and architecture decisions from which the MVP will be built.

| Phase | Scope | Status |
|---|---|---|
| 0 | Research, specs, ADRs | ✅ in this repo |
| 1 | MCP "companion": `.pen` I/O, `execute` engine, headless screenshots, skill, CLI | planned |
| 2 | Desktop app (Tauri + OpenPencil Vue SDK), agent panel, prompt nodes, style archetypes | planned |
| 3 | Parallel agents, component libraries, design ↔ code token sync | planned |

## Why

pen.dev made agent work a paid feature: on the Free plan an agent may work in the app on only 5 days a month — even when the agent is your own Claude Code connected over MCP. Tusche keeps that loop free and local, and keeps your design files in an open format you control.

## Documentation

| Document | English | Русский |
|---|---|---|
| Vision | [01-vision](docs/en/01-vision.md) | [01-vision](docs/ru/01-vision.md) |
| Research: pen.dev & OpenPencil | [02-research](docs/en/02-research.md) | [02-research](docs/ru/02-research.md) |
| Product requirements | [03-prd](docs/en/03-prd.md) | [03-prd](docs/ru/03-prd.md) |
| Architecture | [04-architecture](docs/en/04-architecture.md) | [04-architecture](docs/ru/04-architecture.md) |
| `.pen` format spec | [05-pen-format](docs/en/05-pen-format.md) | [05-pen-format](docs/ru/05-pen-format.md) |
| Agent API (MCP + `execute`) | [06-agent-api](docs/en/06-agent-api.md) | [06-agent-api](docs/ru/06-agent-api.md) |
| Agent skill authoring | [07-skill-authoring](docs/en/07-skill-authoring.md) | [07-skill-authoring](docs/ru/07-skill-authoring.md) |
| Roadmap | [08-roadmap](docs/en/08-roadmap.md) | [08-roadmap](docs/ru/08-roadmap.md) |
| Architecture decisions | [docs/adr/en](docs/adr/en/) | [docs/adr/ru](docs/adr/ru/) |

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for third-party components and trademarks. Tusche is not affiliated with High Agency (pen.dev) or Figma.
