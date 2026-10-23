# Tusche

**English** · [Русский](README.ru.md)

<p>
  <a href="https://www.npmjs.com/package/@tusche/cli"><img alt="npm version" src="https://shieldcn.dev/npm/v/@tusche/cli.svg?variant=secondary"></a>
  <a href="https://github.com/tusche-dev/tusche/actions/workflows/check.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/tusche-dev/tusche.svg?workflow=check.yml&branch=main&variant=secondary"></a>
  <a href="LICENSE"><img alt="License" src="https://shieldcn.dev/github/license/tusche-dev/tusche.svg?variant=secondary"></a>
  <img alt="Node.js 22 or newer" src="https://shieldcn.dev/badge/node-%E2%89%A522-339933.svg?variant=secondary&logo=nodedotjs">
  <a href="https://modelcontextprotocol.io"><img alt="MCP server" src="https://shieldcn.dev/badge/MCP-server-000000.svg?variant=secondary&logo=modelcontextprotocol"></a>
</p>

> *Tusche* (German; Russian *тушь*) — drawing ink.

**Tusche is a free, open-source design canvas for AI agents.** Your coding agent (Claude Code, Codex, any MCP client) designs app screens, dashboards, landing pages and slides on an infinite canvas, checks its own work with screenshots, and saves everything to a plain JSON file next to your code. It runs on *your own* agent subscription. No account, no limits.

- **Bring your own agent.** Connect it once over MCP; Tusche never meters anything.
- **Opens your pen.dev files.** `.pen` is the native format; files stay compatible.
- **Built on [OpenPencil](https://github.com/open-pencil/open-pencil)'s engine:** Skia rendering, flex layout, components, variables and themes.
- **Git-friendly:** canonical JSON, small diffs, lint and render in CI.

## Quick start

You need Node.js ≥ 22 or Bun ≥ 1.3. Connect Tusche to Claude Code:

```bash
claude mcp add tusche -- npx -y @tusche/cli mcp
```

Then, in your project, ask: *"Design an onboarding screen in `design/app.pen`."* To watch the agent work, open a live preview in another terminal:

```bash
npx @tusche/cli preview design/app.pen --open
```

Other MCP clients (Codex, Gemini CLI, OpenCode…) take the same command; see [Getting started](docs/guide/en/getting-started.md).

## Status

**0.1.0, the first release.** Phase 1 is done: MCP server, CLI, live preview and the agent skill. Next is phase 2, a desktop app where you can edit the agent's design by hand. See the [roadmap](docs/dev/08-roadmap.md) (in Russian) and the [changelog](CHANGELOG.md).

## User guide

- [Getting started](docs/guide/en/getting-started.md)
- [CLI reference](docs/guide/en/cli.md)
- [FAQ](docs/guide/en/faq.md)

## For contributors

Development docs (vision, architecture, `.pen` spec, agent API, ADRs) are written in **Russian** and live in [`docs/dev`](docs/dev/). See [CONTRIBUTING](CONTRIBUTING.md).

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for third-party components and trademarks. Tusche is not affiliated with High Agency (pen.dev), OpenPencil or Figma.
