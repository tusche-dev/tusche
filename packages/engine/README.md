# @tusche/engine

Headless OpenPencil for Tusche: layout, resolved bounds by pen path, PNG rendering and pixel comparison. It is the only package that imports `@open-pencil/core` (ADR-001).

```ts
import { createEngine } from '@tusche/engine';

const engine = await createEngine(); // warm CanvasKit, fonts cached in ~/.cache/tusche
const scene = await engine.open(doc, { baseDir: dirname(file) });
await scene.bounds('dialog/okButton'); // {x, y, width, height, absolute}
const png = await scene.render(['screen'], { scale: 1, maxSide: 1600 });
engine.compare(baselinePng, png); // {changedPixels, ratio, diff}
```

For the live preview ([@tusche/preview](../preview/README.md)), `snapshotRoot(scene, id)` lays out a top-level node and returns its scene nodes and images, and `loadedFontFiles()` lists the font files the engine has loaded. `encodeMessage` / `decodeMessage` carry them over a socket. In the browser, `@tusche/engine/preview` (no Node imports) draws them: `PreviewScene` keeps the top-level nodes on one page and hit-tests by pen path, and `PreviewCanvas` renders them with WebGL, with pan, zoom, hover and selection. See ADR-011.

Reference renders: `bun packages/engine/scripts/render-baseline.ts <file.pen>... [--update]`.

`@open-pencil/core@0.16.0` is patched locally (`patches/`). One patch fixes the CanvasKit path on Windows. The others cover layout details where pen.dev and OpenPencil differ. See `docs/dev/02-research.md`.

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.
