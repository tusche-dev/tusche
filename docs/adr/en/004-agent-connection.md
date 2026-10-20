# ADR-004 · Connecting agents: MCP for external agents; spawn the user's own CLI in the app

**English** · [Русский](../ru/004-agent-connection.md)

- **Status:** Accepted for phase 1; the phase 2 part is to be re-validated before implementation
- **Date:** 2026-10-20

## Context

The whole point of Tusche is that **the user's own agent subscription** (Claude Code Pro / Max, ChatGPT / Codex, Gemini) drives the canvas without Tusche metering anything. There are two ways to connect:

1. **External agent → Tusche over MCP.** The user runs Claude Code in a terminal and adds Tusche as an MCP server. The subscription is used by Claude Code itself, exactly as with any other MCP server.
2. **Agent panel inside the Tusche desktop app** (phase 2). Options:
   - a. embed the Claude Agent SDK and let the user log in with their Claude account inside Tusche;
   - b. embed the SDK with an API key the user provides;
   - c. **spawn the user's installed `claude` CLI** (or `codex`, `gemini`) as a child process, with Tusche's MCP server preconfigured, and stream its output into the panel.

Anthropic's Agent SDK documentation states that, unless previously approved, third-party developers may not offer claude.ai login or subscription rate limits in their products, and should use API-key authentication. Option 2a is therefore not available to us without approval.

## Decision

- **Phase 1:** MCP only (option 1). Setup is one command: `claude mcp add tusche -- npx -y @tusche/cli mcp`.
- **Phase 2:** option 2c by default — the panel is a UI over the user's own CLI, which is authenticated however the user has set it up. Option 2b (API key, stored in the OS keychain) is offered for users without a CLI. Option 2a is **not** implemented unless Anthropic explicitly allows it.
- Tusche never proxies model traffic through any server.

## Consequences

- ➕ Compliant by construction: Tusche never handles subscription credentials.
- ➕ Works with any CLI agent that supports MCP, not only Claude.
- ➖ The in-app panel depends on a locally installed CLI and on its output format (`claude -p --output-format stream-json`). Mitigation: an adapter per CLI, with the plain terminal as fallback.
- Before phase 2 starts, re-check current Anthropic, OpenAI and Google terms and update this ADR.
