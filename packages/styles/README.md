# @tusche/styles

Style archetypes as data — fonts, palette, scales, imagery and rules — served by the MCP tool `get_style`.

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.

```ts
import { getStyle, listStyles } from '@tusche/styles';

await listStyles(); // [{ name: 'quiet-editorial', title, summary, params: { accent: [...] } }]
const style = await getStyle('quiet-editorial', { accent: 'olive' });
style.variables; // ready for SetVariables: color-*, font-*, text-*, space-*, radius-*
```

Each archetype is one file in `archetypes/` named after it. A palette value is a hex colour or `$param.<name>`; a parameter lists its options as name → colour with a default. Archetypes are original to Tusche and written in English. One archetype ships in stage 1.5; the eight planned for phase 1 come in stage 1.6 ([07-skill-authoring](../../docs/dev/07-skill-authoring.md)).
