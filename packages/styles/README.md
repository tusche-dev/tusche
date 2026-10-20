# @tusche/styles

Style archetypes as data — fonts, palette, scales, imagery and rules — served by the MCP tool `get_style`.

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.

```ts
import { getStyle, listStyles } from '@tusche/styles';

await listStyles(); // [{ name: 'quiet-editorial', title, summary, params: { accent: [...] } }]
const style = await getStyle('quiet-editorial', { accent: 'olive' });
style.variables; // ready for SetVariables: color-*, font-*, text-*, space-*, radius-*
```

Each archetype is one file in `archetypes/` named after it. A palette value is a hex colour or `$param.<name>`; a parameter lists its options as name → colour with a default. Archetypes are original to Tusche and written in English.

Eight archetypes (stage 1.6):

| Name | Direction | Fonts (display / body / mono) |
|---|---|---|
| `quiet-editorial` | editorial | Lora / Inter |
| `blueprint` | technical | IBM Plex Sans / IBM Plex Sans / IBM Plex Mono |
| `soft-play` | playful | Unbounded / Rubik |
| `night-shift` | dark product | Geist / Geist / Geist Mono |
| `bento-grid` | bento | Onest / Inter |
| `raw-concrete` | brutalist | Dela Gothic One / Martian Mono |
| `mono-minimal` | minimal monochrome | Inter Tight / Inter |
| `warm-market` | warm consumer | Literata / Nunito |

Every font must cover Latin and Cyrillic. Tests check that text, muted text and on-accent stay at WCAG contrast 4.5 or more with every parameter value. Font coverage needs the network (or a warm font cache), so it is a script:

```sh
bun packages/styles/scripts/check-fonts.ts   # fails on missing-glyphs or unknown-font
```

How archetypes are chosen and written: [07-skill-authoring](../../docs/dev/07-skill-authoring.md).
