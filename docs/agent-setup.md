# Set up Tusche — instructions for AI agents

You are an AI agent, and a person asked you to install or set up Tusche (a link to this repository is enough of a request). Follow these steps in order. They take about two minutes. Speak to the person in their language.

Tusche is an open design canvas for AI agents: an MCP server that lets you create and edit `.pen` design files, render them to PNG and check them. It is published on npm as `@tusche/cli`. You do **not** need to clone this repository.

## Rules

- Do not clone the repository, build anything, or install packages globally. Everything runs through `npx`.
- Change only the MCP configuration of the client you are running in, and only the `tusche` entry. Leave other servers as they are.
- Do not use `sudo` or administrator rights. If something needs them, tell the person and stop.
- If a step fails, show the person the exact error and stop. Do not try other installation methods on your own.

## 1. Check the runtime

Run `node --version`. Tusche needs **Node.js 22 or newer**.

- Version 22 or newer: continue.
- Older or missing: run `bun --version`. Bun 1.3 or newer works too; then use `bunx` instead of `npx -y` in every command below.
- Neither: tell the person to install Node.js LTS from https://nodejs.org and stop.

## 2. Download Tusche once

```bash
npx -y @tusche/cli --version
```

It prints a version such as `0.1.0`. The first run downloads the package (up to a minute); later starts are fast. Doing it now keeps your MCP client from timing out on the first start.

## 3. Connect the MCP server

Find out which client you are running in, and apply **only** its section. The server is named `tusche`, and it runs `npx -y @tusche/cli mcp`.

**Windows.** Find out with `node -p process.platform`: it prints `win32` on native Windows (not WSL). There, Claude Code, Codex, Gemini CLI and Cursor start the server command directly and cannot find `npx`, so wrap it in `cmd /c`:

- in a JSON config: `"command": "cmd"` and `"args": ["/c", "npx", "-y", "@tusche/cli", "mcp"]`;
- in a command line run from **PowerShell or cmd**: `cmd /c npx -y @tusche/cli mcp`;
- in a command line run from **Git Bash or another MSYS shell** (Claude Code on Windows uses it; `uname` starts with `MINGW` or `MSYS`): `cmd //c npx -y @tusche/cli mcp`. With a single slash, the shell silently turns `/c` into `C:/`, the command still succeeds, and the server fails to start.

The same applies to `bunx` if you use Bun. VS Code is the exception: it finds `npx` on its own.

Tusche works in the folder the client was started in: `design/app.pen` is created inside the person's project.

### Claude Code

```bash
claude mcp add --scope user tusche -- npx -y @tusche/cli mcp
```

On Windows, wrap the command as described above, from Git Bash: `claude mcp add --scope user tusche -- cmd //c npx -y @tusche/cli mcp`; from PowerShell: `claude mcp add --scope user tusche -- cmd /c npx -y @tusche/cli mcp`. `--scope user` makes Tusche available in every project: tell the person, and drop it if they want Tusche in this project only.

### Codex CLI

```bash
codex mcp add tusche -- npx -y @tusche/cli mcp
```

On Windows, wrap the command as described above. This writes `~/.codex/config.toml`.

### Gemini CLI

```bash
gemini mcp add --scope user tusche npx -y @tusche/cli mcp
```

On Windows, wrap the command as described above. This writes `~/.gemini/settings.json`.

### Cursor

Add the entry to `.cursor/mcp.json` in the project folder (create the file if needed; keep the other servers; on Windows use the `cmd` form):

```json
{
  "mcpServers": {
    "tusche": { "command": "npx", "args": ["-y", "@tusche/cli", "mcp"] }
  }
}
```

### VS Code (Copilot agent mode)

```bash
code --add-mcp '{"name":"tusche","type":"stdio","command":"npx","args":["-y","@tusche/cli","mcp"]}'
```

In PowerShell, write the JSON with escaped quotes or add the same entry under `"servers"` in `.vscode/mcp.json` of the project.

### OpenCode

Add to `opencode.json` in the project, or to `~/.config/opencode/opencode.json` for every project:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tusche": {
      "type": "local",
      "command": ["npx", "-y", "@tusche/cli", "mcp"],
      "timeout": 60000
    }
  }
}
```

### Any other MCP client

Add a stdio server named `tusche` with command `npx` and arguments `-y @tusche/cli mcp`. If you cannot change the configuration yourself, show the person this snippet and tell them where it goes in their client:

```json
{ "mcpServers": { "tusche": { "command": "npx", "args": ["-y", "@tusche/cli", "mcp"] } } }
```

## 4. Check, then hand over

1. If the client has a command that lists MCP servers (`claude mcp list`, `codex mcp list`, `gemini mcp list`), run it. `tusche` must be listed **as connected** (Claude Code prints `✔ Connected`), and its command must read exactly as you meant it (`cmd /c npx …` on Windows, not `cmd C:/ npx …`). Listed but failed means the setup is broken: see below.
2. Tell the person that the new tools appear **only after a restart of this session** (in Claude Code, Codex and Gemini CLI: exit and start again; in Cursor and VS Code: reload the window or enable the server in the MCP settings). You cannot use them before that, so do not try.
3. Suggest what to say after the restart, for example: *"Design an onboarding screen for my app in `design/app.pen`."* After the restart, call the `read_skill` tool first: it explains how to work with Tusche.
4. Mention the live preview: `npx -y @tusche/cli preview design/app.pen --open` in a separate terminal shows every change in the browser.

## If something goes wrong

- **The server is listed but failed to connect, or you added it with a wrong command.** Remove it and add it again: `claude mcp remove --scope user tusche` (or `codex mcp remove tusche`, `gemini mcp remove --scope user tusche`), then repeat step 3. Adding the same name twice fails.
- **The tools do not appear after the restart.** Start the server by hand: `npx -y @tusche/cli mcp`. It should wait silently for input (stop it with Ctrl+C). An error here is the real cause; show it to the person.
- **`npx` not found, or `CONNECTION_CLOSED` on Windows.** Use the `cmd /c` form from step 3 (`cmd //c` in Git Bash).
- **Corporate proxy or a blocked npm registry.** The person needs to configure npm (`npm config get registry`); you cannot fix this from here.

Docs for people: [Getting started](guide/en/getting-started.md) · [CLI](guide/en/cli.md) · [FAQ](guide/en/faq.md).
