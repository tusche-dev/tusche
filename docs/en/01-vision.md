# 01 · Vision

**English** · [Русский](../ru/01-vision.md)

## One sentence

Tusche is a free, open-source design canvas where **your** coding agent designs, and you watch, steer and edit — with files that live next to your code.

## The problem

AI coding agents became good at producing UI, but code is a poor medium for *exploring* design: you cannot see five variants side by side, drag a card, or compare a light and a dark theme at a glance. Agent-first canvases (pen.dev being the best-known) solved this by giving the agent a canvas it can write to and screenshot.

In October 2026 pen.dev introduced paid plans. On the Free plan an agent may work in the app on only **5 days per month** — and that limit counts work done through MCP by an external agent such as Claude Code, even when the user pays for the agent separately. The editor itself stays free; the *agent loop* — the reason people use it — does not.

OpenPencil (MIT) is a powerful free alternative with a Figma-grade engine and 100+ MCP tools, but its agent surface is broad and low-level, and `.pen` support is import-only.

## What Tusche is

1. **An agent-first canvas.** The primary user of the editing API is an LLM agent. The API is designed for token efficiency, transactional safety and self-verification, not for humans clicking buttons.
2. **Built on OpenPencil's engine**, not a fork of it. We consume the published `@open-pencil/*` packages and contribute fixes upstream.
3. **`.pen`-native.** The open, published `.pen` JSON schema is the file format. Existing pen.dev documents open, edit and save without conversion.
4. **Bring your own agent.** Claude Code, Codex, Gemini CLI, OpenCode or any MCP client. Tusche never needs an API key or an account of its own, and never meters agent usage.
5. **Local-first.** Files on disk, no cloud, no telemetry by default.

## Principles

| Principle | What it means in practice |
|---|---|
| Agent-first | A single transactional `execute` tool beats 100 granular tools. Errors are patched, not resent. Every response is compact. |
| Verify, don't guess | The agent gets cheap structural checks (bounds, clipping problems) and screenshots on demand. |
| Open format | `.pen` stays plain, canonical, diff-friendly JSON. Unknown properties survive a round trip. |
| No limits | No metering, no gated features, no hosted-model credits. |
| Thin layer | Reuse OpenPencil for everything an engine does; own only the agent layer, the `.pen` bridge and the UX. |
| Clean room | `.pen` support is implemented from public documentation only; no pen.dev code, assets or skill texts. |

## Non-goals

- Replacing Figma for large design teams (prototyping, branching, enterprise libraries).
- Our own rendering or layout engine. See [ADR-001](../adr/en/001-build-on-openpencil.md) and [ADR-005](../adr/en/005-stack-bun-tauri-rust.md).
- Hosting models, selling credits, or a cloud service.
- Pixel-perfect parity with pen.dev's renderer. Compatibility target is the *file format* and the *agent experience*.
- Real-time multiplayer in phases 0–2 (OpenPencil's Yjs layer may be adopted later).

## Who it is for

- **Developers using coding agents** who want visual design exploration before or alongside code.
- **Former pen.dev users** with a folder of `.pen` files who want to keep working without limits.
- **Tool builders** who want a scriptable, headless design engine for CI (render, lint, export).

## What success looks like

- Claude Code designs a multi-screen mobile app in a `.pen` file through Tusche, verifies it with screenshots, and the same file opens in pen.dev.
- A designer opens that file in the Tusche desktop app, tweaks it by hand, and the agent picks up the changes.
- The headless CLI renders the file in CI and fails the build on lint errors.
