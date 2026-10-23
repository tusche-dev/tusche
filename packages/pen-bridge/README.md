# @tusche/pen-bridge

Projects a `.pen` document into the OpenPencil scene graph (`@open-pencil/scene-graph`). The `.pen` tree stays the source of truth; the scene graph is a disposable projection (ADR-002, ADR-007).

```ts
import { PenProjection } from '@tusche/pen-bridge';

const projection = new PenProjection(doc, { loadAsset, icons }).project(['screen']);
projection.node('dialog/okButton/label'); // scene node ids are pen paths
projection.warnings; // placeholders, approximations, unknown refs and icons
```

- Instances are expanded into plain nodes. A node inside an instance has the id `instanceId/childId/…`.
- Variables and themes resolve to values, using the theme of the place where an instance is used.
- Icons are vectors built from Iconify data. Lucide and Phosphor are bundled.
- Shader fills, `script`, `browser`, `note`, `prompt` and `context` are drawn as placeholders.
- No file system or network access: images and icons come in through `loadAsset` and `IconProvider`.

Part of [Tusche](https://github.com/tusche-dev/tusche), an open design canvas for AI agents.
