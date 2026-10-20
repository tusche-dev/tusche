# 05 · The `.pen` format — Tusche implementation spec

**English** · [Русский](../ru/05-pen-format.md)

`.pen` is the JSON document format created by High Agency for pen.dev. The normative reference is their public schema: <https://docs.pencil.dev/for-developers/the-pen-format>. This document describes **how Tusche reads, validates, edits and writes it**, in our own words, plus what we observed in real files. Where this spec and upstream differ, upstream wins; open an issue.

Target version: **2.21**. Read support: **2.x** (observed: 2.6, 2.17, 2.18, 2.21).

## 1. File

- UTF-8 JSON. Upstream tolerates comments; Tusche reads JSONC and **writes plain JSON** without comments.
- The file sits in a project folder. Assets (images, `.glsl` shaders, `.js` scripts, imported `.pen` libraries) are referenced by **paths relative to the file**.
- Line endings: both seen in the wild (CRLF in some app-created files). Tusche writes LF.

## 2. Document root

| Field | Type | Notes |
|---|---|---|
| `version` | string | e.g. `"2.21"`. Drives migrations. |
| `children` | Node[] | Top-level nodes: screens, components, containers |
| `variables` | map name → definition | Typed: `boolean`, `color`, `number`, `string` |
| `themes` | map axis → values[] | e.g. `{"mode": ["light","dark"]}`. The first value is the default. |
| `imports` | map alias → relative path | Other `.pen` files used as libraries |

Any other top-level key is preserved verbatim.

## 3. Common node fields

Every node has `type` and `id`. Ids are short random strings and **must not contain `/`**; `/` is reserved for paths into component instances (`instanceId/childId/...`).

| Field | Meaning |
|---|---|
| `name` | Human-readable layer name |
| `x`, `y` | Position relative to the parent's top-left; ignored when the parent has flex layout, unless `layoutPosition: "absolute"` |
| `rotation` | Degrees, counter-clockwise, around the top-left corner |
| `opacity`, `enabled` | `enabled: false` hides the node, also used to "delete" inside instances |
| `flipX`, `flipY` | Mirroring |
| `reusable` | `true` makes the node a component |
| `theme` | Selects theme values for this subtree, e.g. `{"mode":"dark"}` |
| `layoutPosition` | `"auto"` or `"absolute"` |
| `context`, `metadata` | Free-form annotations; preserved |

**Value references:** almost every scalar can be a variable reference, a string starting with `$` (`"$primary"`, `"$space-4"`).

## 4. Node types

| Type | Children | Essentials |
|---|---|---|
| `frame` | yes | Container with optional flex layout, fills, strokes, corner radius, `clip`, `placeholder`, `slot` |
| `group` | yes | Plain grouping, effects only |
| `rectangle` | — | Fills, strokes, `cornerRadius` (single value or 4 values) |
| `ellipse` | — | `innerRadius` (ring), `startAngle`, `sweepAngle` (arcs, donuts) |
| `polygon` | — | `polygonCount`, `cornerRadius` |
| `path` | — | SVG `geometry`, `viewBox` `[x,y,w,h]` stretched to the node box, `fillRule` |
| `text` | — | `content`, text style, `textGrowth` |
| `icon` | — | `library` + `icon` name, optional `weight`; scaled to the box |
| `ref` | — | Instance of a reusable node: `ref` (target id) + `descendants` overrides + top-level overrides |
| `note`, `prompt`, `context` | — | Canvas annotations; `prompt` has an optional `model` |
| `script` | — | `scriptUri` (JS file) + `inputs`; generates children at runtime |
| `browser` | — | A live web page: `url`, `deviceId`, `zoom`, `scrollX/Y` |

Older files may contain `icon_font` (observed in OpenPencil's importer), which migrates to `icon`.

## 5. Sizing and layout

- `width` / `height`: a number, a variable, or a **sizing behaviour** string: `fit_content` (hug children; needs layout on the node) or `fill_container` (stretch in the parent's layout). An optional fallback goes in parentheses: `"fit_content(320)"`.
- **Not supported:** percentages, `calc`, viewport units, margins, `alignItems: baseline|stretch`, flex wrap.
- Frame layout: `layout` is `none`, `horizontal` (**default for frames**) or `vertical`; also `gap`, `padding` (1, 2 or 4 values), `justifyContent` (`start|center|end|space_between|space_around`), `alignItems` (`start|center|end`), `layoutIncludeStroke`.
- Default frame size is `fit_content` on both axes. Default `clip` is `false`.
- A `fit_content` parent whose children are all `fill_container` on the same axis is a circular dependency. Tusche resolves it with the fallback and emits a warning.

### Text growth

| `textGrowth` | Width | Height | Wraps |
|---|---|---|---|
| `auto` (default) | from content | from content | never |
| `fixed-width` | required (number or `fill_container`) | from content | yes |
| `fixed-width-height` | required | required | yes; may overflow |

Text has **no default fill**, so text without `fill` is invisible. Tusche emits a warning.

## 6. Paint

**Fill** (one value or an array, painted bottom to top):

| Kind | Fields |
|---|---|
| colour | `"#RGB" | "#RRGGBB" | "#RRGGBBAA"`, a variable, or `{type:"color", color, enabled, blendMode}` |
| `gradient` | `gradientType` (`linear|radial|angular`), `colors[{color, position}]`, `center`, `size`, `rotation`, `opacity` |
| `image` | `url` (relative), `mode` (`cover|contain|stretch`), `transform` (affine crop), `opacity` |
| `shader` | `url` to a GLSL ES 1.0 fragment shader, `uniforms` |
| `mesh_gradient` | `columns`, `rows`, `colors[]`, `points[]` with optional bezier handles |

**Stroke:** `stroke` (fills), `strokeWidth` (uniform or per side), `strokeAlignment` (`inner|center|outer`), `strokeLinecap`, `strokeLinejoin`.

**Effects:** `blur`, `background_blur`, `shadow` (`inner|outer`, `offset`, `blur`, `color`, `blendMode`), `shader` (post-process). Blend modes follow the usual 18 Figma-style names.

## 7. Text style

`fontFamily`, `fontSize`, `fontWeight` (string), `fontStyle`, `letterSpacing`, `lineHeight` (a **multiplier** of font size), `textAlign` (`left|center|right|justify`), `textAlignVertical` (`top|middle|bottom`), `underline`, `strikethrough`, `href`.

## 8. Components and instances

- Any node with `reusable: true` is a component.
- `{"type":"ref","ref":"<componentId>", ...overrides}` is an instance. Top-level keys override the root.
- `descendants` maps an **id path inside the component** (`"childId"` or `"nestedInstance/childId"`) to:
  - an object **without** `type` → property overrides merged into that descendant;
  - an object **with** `type` → the descendant is **replaced** by this new subtree.
- Deleting a descendant inside an instance is done by `enabled: false`.
- `slot: ["componentId", ...]` on a frame marks it as an insertion slot, listing recommended components.
- Copying a reusable node creates a `ref`, not a deep copy.

## 9. Variables and themes

```json
{
  "themes": { "mode": ["light", "dark"] },
  "variables": {
    "bg": { "type": "color", "value": [
      { "value": "#FAFAF7", "theme": { "mode": "light" } },
      { "value": "#141414", "theme": { "mode": "dark" } }
    ] },
    "space-4": { "type": "number", "value": 16 }
  }
}
```

- A plain value or a list of `{value, theme}` entries. When resolving, the **last** entry whose theme matches the active theme wins; otherwise the default theme is used.
- Theme context is inherited down the tree from the nearest node with `theme`.
- Values can reference other variables.

## 10. Compatibility matrix: `.pen` → OpenPencil scene graph (via `pen-bridge`)

Status: ✅ planned direct mapping · 🟡 approximation · ⬜ placeholder only (kept intact in the file)

| `.pen` feature | Scene graph target | Status | Notes from 2026-10-20 tests |
|---|---|---|---|
| frame / flex layout / gap / padding / align | FRAME + auto layout (Yoga) | ✅ | Correct in renders |
| `fit_content` / `fill_container` / fallback | HUG / FILL sizing | ✅ | |
| `clip` | clipsContent | ✅ | |
| group | GROUP | ✅ | Not mapped by `@open-pencil/pen` today |
| rectangle, ellipse (arcs, ring) | RECTANGLE, ELLIPSE (arcData) | ✅ | |
| polygon | REGULAR_POLYGON | ✅ | Not mapped today |
| path + viewBox | VECTOR (scaled) | ✅ | |
| text + textGrowth | TEXT with auto-resize modes | ✅ | Cyrillic OK |
| icon | VECTOR from Iconify data | 🟡 | OpenPencil maps it to a text glyph today; we want vectors |
| ref + descendants | INSTANCE + overrides | ✅ | Expansion can blow up node counts (39k from 2.5k); render-time expansion should be lazy |
| variables + themes | Variables + modes | 🟡 | Theme-dependent fills went missing in one test; to fix |
| colour / gradient / image fills | Paints | ✅ | |
| mesh_gradient | — | 🟡 | Rasterise to an image paint, or approximate with a gradient |
| shader fill / effect | — | ⬜ → 🟡 | Rendered black today; phase 1 shows a neutral placeholder; phase 2 can use CanvasKit `RuntimeEffect` (SkSL) after translating GLSL |
| shadow, blur, background blur | Effects | ✅ | |
| note / prompt / context | STICKY-like frame | ⬜ | Shown as labelled cards |
| script | FRAME | ⬜ | Phase 3: run in the QuickJS sandbox |
| browser | FRAME | ⬜ | Phase 2: real webview overlay in desktop |
| imports (libraries) | Library | 🟡 | Phase 3 |

## 11. Canonical serialisation (how Tusche writes)

To make git diffs minimal and deterministic:

1. Two-space indentation, LF, trailing newline, UTF-8 without BOM.
2. Key order in a node: `type`, `id`, `name`, `reusable`, `ref`, `x`, `y`, `width`, `height`, then the remaining known keys in schema order, then unknown keys in their original order, `descendants`, and **`children` last**.
3. Root key order: `version`, `themes`, `imports`, `variables`, `children`, then unknown keys.
4. **Defaults are omitted** (pen.dev convention), unless the value overrides a non-default inside an instance.
5. Numbers: shortest round-trip representation; no `-0`.
6. Files that are already canonical are rewritten byte-identically when nothing changed (requirement N3).

## 12. Versioning and migrations

- `pen-format` holds an ordered list of migrations `2.x → 2.y`. Migrations run in memory on open; the file is written at the newest version **only when it is saved after an edit**.
- An unknown **newer** version opens read-write with a warning; unknown properties survive.
- Every migration has fixture tests built from real files.

## 13. Validation levels

| Level | Example | Behaviour |
|---|---|---|
| Error | `padding` on a text node; `width: "50%"`; id containing `/` | `execute` throws, so the transaction rolls back |
| Warning | text without fill; child clipped by its parent; circular sizing | Returned in the `execute` response |
| Info | default value set explicitly | Silently normalised on save |
