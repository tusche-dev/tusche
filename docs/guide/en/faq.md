# FAQ

**English** · [Русский](../ru/faq.md)

**Is Tusche free?**
Yes. MIT-licensed, no account, no usage limits, no paid tier. You pay only for your own AI agent subscription, which you already have.

**Does it work with my Claude Code subscription?**
Yes. Claude Code connects to Tusche as an MCP server, like any other tool. Tusche never sees your credentials and never counts your usage.

**Can I open my pen.dev (`.pen`) files?**
Yes. Tusche reads `.pen` files of format version 2.x and saves them in the same format. Properties it does not support yet are kept untouched, so the file still opens in pen.dev. Some features render as placeholders for now (shader fills, `script` and `browser` nodes).

**Will my designs look exactly as in pen.dev?**
Close, not pixel-identical. Tusche uses a different renderer (OpenPencil's, built on Skia).

**Is Tusche affiliated with pen.dev or OpenPencil?**
No. Tusche is independent. It builds on OpenPencil's open-source packages (MIT) and implements the `.pen` format from its public documentation.

**Is there a desktop app?**
Planned for phase 2. Phase 1 works through your agent plus a live preview in the browser.

**Can Tusche generate images?**
Not by itself. If your agent has image tools, it saves files next to the `.pen` and uses them as image fills.

**Where are my files stored?**
On your disk, wherever you choose, usually next to your code. Nothing is uploaded anywhere.
