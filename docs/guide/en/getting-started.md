# Getting started

**English** · [Русский](../ru/getting-started.md)

> **Fastest way:** paste the prompt from [Let your agent set it up](../../../README.md#let-your-agent-set-it-up) into your agent. It follows [the instructions for agents](../../agent-setup.md) and connects Tusche for you. The steps below do the same by hand.

## What you need

- **An AI agent that supports MCP:** Claude Code, Codex CLI, Gemini CLI, OpenCode, or any other MCP client. Tusche uses *your* agent and *your* subscription; it has no account and no limits of its own.
- **Bun ≥ 1.3 or Node.js ≥ 22.**
- Optional: existing `.pen` files from pen.dev. Tusche opens them as they are.

## 1. Connect Tusche to your agent

**Claude Code:**

```bash
claude mcp add tusche -- npx -y @tusche/cli mcp
```

Check with `/mcp` inside Claude Code; you should see `tusche` with its tools.

**Other MCP clients** — add a stdio server:

```json
{
  "mcpServers": {
    "tusche": { "command": "npx", "args": ["-y", "@tusche/cli", "mcp"] }
  }
}
```

On Windows, if `npx` is not found by the client, use `"command": "cmd", "args": ["/c", "npx", "-y", "@tusche/cli", "mcp"]`.

**To try unreleased changes,** clone the repository, run `bun install` in it, and connect the server from the clone:

```bash
claude mcp add tusche -- bun /path/to/tusche/packages/cli/src/index.ts mcp
```

The server works in the folder the agent was started in, so `design/app.pen` lands in your project.

## 2. Ask for a design

In your project folder, ask the agent:

> Design an onboarding screen for a habit-tracker mobile app in `design/app.pen`.

The agent will:

1. read the Tusche skill;
2. create or open `design/app.pen`;
3. set up colours and type, build the screen section by section, and check each section;
4. show you screenshots right in the chat.

The file is saved automatically. It is plain JSON, so you can commit it next to your code.

## 3. Watch it live (optional)

```bash
npx @tusche/cli preview design/app.pen
```

Open the address it prints (or add `--open`). The page redraws the design every time the file is saved, so you see each change the agent makes. Click a layer to see its id, handy when you ask the agent to change exactly that element.

## 4. Keep iterating

- "Make the cards denser and add a dark theme."
- "Give me three directions for the hero, side by side."
- "Implement the Settings screen from `design/app.pen` in our Next.js app."

## Using your pen.dev files

Open them the same way: point the agent at the file. Tusche keeps every property it does not understand, and saves the file in the same format, so it still opens in pen.dev.

## Next

- [CLI reference](cli.md)
- [FAQ](faq.md)
