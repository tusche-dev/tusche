# @tusche/preview

Live preview of a `.pen` file in the browser: what `tusche preview` runs.

Part of [Tusche](https://github.com/tusche-dev/tusche), an open design canvas for AI agents.

```ts
import { startPreview } from '@tusche/preview';

const preview = await startPreview({ file: 'design/app.pen' }); // port 4848 or the next free one
console.log(preview.url); // http://127.0.0.1:4848/
await preview.close();
```

- The server watches the file (any writer: the MCP server, the CLI, pen.dev, git), reads it again, and lays it out with [@tusche/engine](../engine/README.md), the same way the agent's screenshots are made.
- A new page gets the whole document over a WebSocket. After that it gets only the top-level nodes that changed, including instances of a changed component.
- The page draws the laid-out scene with WebGL (`@tusche/engine/preview`). Drag or scroll to pan, Ctrl/⌘ + scroll (or pinch) to zoom, `Shift+1` or **Fit** to fit everything. Click a layer to see its pen id (for an instance child, its path), name, size and ancestors.
- A file that cannot be read keeps the last good state on screen, with the error shown above it.

Options: `port` (`0` for any free port), `host` (default `127.0.0.1`), `engine`, `allowRemoteAssets` (default `TUSCHE_ALLOW_REMOTE_ASSETS=1`), `debounceMs` (default 100), `log`. Design notes: `docs/dev/adr/011-preview.md`.
