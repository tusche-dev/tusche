# The .pen format

A `.pen` file is JSON. Tusche keeps its tree as the source of truth; everything you see is rendered from it. If a property is not on this page, it does not exist.

## Document

| Key | What |
|---|---|
| `version` | Format version, `"2.21"` |
| `children` | Top-level nodes: screens, components, boards |
| `variables` | Name → `{type, value}`; types `color`, `number`, `string`, `boolean` |
| `themes` | Axis → values, e.g. `{"mode": ["light", "dark"]}`; the first value is the default |

## Every node

`type` and `id` (Tusche generates ids — never set one). Common keys:

| Key | What |
|---|---|
| `name` | Layer name. Name everything you create |
| `x`, `y` | Position in the parent. **Ignored** when the parent lays children out, unless `layoutPosition: "absolute"` |
| `width`, `height` | Number, `"$variable"`, `"fit_content"`, `"fill_container"`, or with a fallback: `"fit_content(320)"` |
| `opacity`, `rotation` | Rotation in degrees, counter-clockwise |
| `enabled` | `false` hides the node (and is how you remove a node inside an instance) |
| `reusable` | `true` makes the node a component |
| `theme` | Picks theme values for the subtree: `{"mode": "dark"}` |
| `layoutPosition` | `"auto"` or `"absolute"` |

Almost any value can be a variable reference: a string starting with `$` (`"$primary"`, `"$space-4"`).

## Node types

| Type | Key properties |
|---|---|
| `frame` | Container. `layout`, `gap`, `padding`, `justifyContent`, `alignItems`, `fill`, `stroke`, `cornerRadius`, `clip`, `effect`, `placeholder` |
| `group` | Plain grouping; size follows the children |
| `rectangle` | `fill`, `stroke`, `cornerRadius` (one value or four) |
| `ellipse` | `innerRadius` (ring), `startAngle`, `sweepAngle` (arcs) |
| `polygon` | `polygonCount`, `cornerRadius` |
| `path` | `geometry` (SVG path data), `viewBox` `[x, y, w, h]` stretched to the node's box, `fillRule` |
| `text` | `content`, text style, `textGrowth`, `fill` |
| `icon` | `library` (`lucide`, `phosphor`) + `icon` name, optional `weight`; scales to its box |
| `ref` | An instance: `ref` (component id), root overrides, `descendants` |

## Layout

- `layout`: `"horizontal"` (**the default for frames**), `"vertical"` or `"none"` (children placed by `x`/`y`).
- `gap`; `padding`: one value, `[vertical, horizontal]` or `[top, right, bottom, left]`.
- `justifyContent`: `start | center | end | space_between | space_around`. `alignItems`: `start | center | end`.
- A frame is `fit_content` on both axes by default. `fit_content` needs a layout on the node itself.
- `fill_container` stretches along the parent's layout. Siblings with `fill_container` share the space equally.
- A `fit_content` parent whose children are all `fill_container` on that axis is circular: the fallback value is used and you get a `circular-size` warning.
- **Not supported:** percentages, `calc`, margins, wrapping, `alignItems: stretch` or `baseline`.
- `clip: false` by default. Screens should have `clip: true`.

## Text

| `textGrowth` | Width | Height | Wraps |
|---|---|---|---|
| `auto` (default) | from content | from content | never |
| `fixed-width` | required (number or `fill_container`) | from content | yes |
| `fixed-width-height` | required | required | yes; may overflow |

Style: `fontFamily` (Google Fonts names), `fontSize`, `fontWeight` (a string: `"400"`, `"600"`), `fontStyle`, `letterSpacing`, `lineHeight` (a **multiplier** of the font size), `textAlign` (`left | center | right | justify`), `textAlignVertical` (`top | middle | bottom`), `underline`, `strikethrough`.

**Text has no fill by default.** Text without `fill` is invisible.

## Fills, strokes, effects

A fill is one value or a list, painted bottom to top:

- colour: `"#RGB"`, `"#RRGGBB"`, `"#RRGGBBAA"` or `"$variable"`;
- `{type: "gradient", gradientType: "linear" | "radial" | "angular", colors: [{color, position}], rotation}`;
- `{type: "image", url: "./images/hero.jpg", mode: "cover" | "contain" | "stretch"}` — the path is relative to the `.pen` file.

Stroke: `stroke` + `strokeWidth` (no width, no stroke) + `strokeAlignment` (`inner | center | outer`, default `center`).

- `stroke` takes the same values as `fill`: `stroke: "$color-line"`. Not an object with a `fill` key.
- `strokeWidth` is one number or one per side: `{top, right, bottom, left}`, missing sides are 0. A row divider is `stroke: "$color-line", strokeWidth: {bottom: 1}`.

Effects (`effect`, one or a list): `{type: "shadow", shadowType: "outer" | "inner", offset: {x, y}, blur, color}`, `{type: "blur", radius}`, `{type: "background_blur", radius}`.

## Components and instances

- Any node with `reusable: true` is a component. Keep components outside the screens, on the canvas.
- `{type: "ref", ref: "<componentId>"}` is an instance. Top-level keys override the component's root.
- `descendants` maps the **id** of a node inside the component to an override. One id reaches a node at any depth (`"Kp2xQ"`, never `"row/Kp2xQ"`); a two-part key is only for reaching into a nested instance (`"nestedInstanceId/childId"`). Names are not keys: find ids with a visitor (`Get(componentId, n => n.name === "Title" ? n.id : undefined)`). Each value is:
  - an object **without** `type` — property overrides for that node;
  - an object **with** `type` — a replacement subtree.
- A node inside an instance is addressed `instanceId/childId` however deep it sits (not `instanceId/rowId/childId`). Hide it with `enabled: false`.
- Copying a component creates an instance, not a deep copy.

## Variables and themes

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

The last entry whose theme matches wins; with no match, the default theme's value is used. Theme context is inherited down the tree from the nearest node with `theme`.

## Not rendered yet

`shader` fills and effects, `script`, `browser`, `note`, `prompt` and `context` nodes are kept in the file but drawn as placeholders (`unsupported-render` warning).
