# Design systems

Tokens, components, variants, light and dark themes. Read [pen-format.md](../pen-format.md) and [execute.md](../execute.md) first.

## Order

1. Read what exists: `GetVariables()` and the reusable nodes (`Get(n => n.reusable ? n.name + " " + n.id : undefined)`). Extend, never duplicate.
2. Tokens: colours, fonts, type sizes, spacing, radii — one `SetVariables` call.
3. Components, smallest first: button, input, badge, avatar, then composites (card, list row, nav item).
4. A board that shows them, then screens that use instances.

## Tokens

- Names are `group-role`: `color-bg`, `color-surface`, `color-text`, `color-muted`, `color-line`, `color-accent`, `color-on-accent`; `font-display`, `font-body`; `text-1…6`; `space-1…8`; `radius-1…3`. Styles from `get_style` already use these names.
- Name colours by role, never by hue (`color-accent`, not `color-blue`), so a theme can change the value.
- Light and dark: declare `themes: {"mode": ["light", "dark"]}` by giving variables themed values; set `theme: {"mode": "dark"}` on a frame to see the dark version.

```js
SetVariables({
  "color-bg": {type: "color", value: [{value: "#FAFAF8", theme: {mode: "light"}}, {value: "#121315", theme: {mode: "dark"}}]},
  "color-surface": {type: "color", value: [{value: "#FFFFFF", theme: {mode: "light"}}, {value: "#1C1E21", theme: {mode: "dark"}}]},
  "color-text": {type: "color", value: [{value: "#16181B", theme: {mode: "light"}}, {value: "#EEF0F2", theme: {mode: "dark"}}]},
  "color-accent": {type: "color", value: [{value: "#2F4BE0", theme: {mode: "light"}}, {value: "#8EA2FF", theme: {mode: "dark"}}]},
  "color-on-accent": {type: "color", value: [{value: "#FFFFFF", theme: {mode: "light"}}, {value: "#121315", theme: {mode: "dark"}}]},
  "font-body": {type: "string", value: "Inter"},
  "space-2": {type: "number", value: 8}, "space-4": {type: "number", value: 16}, "radius-2": {type: "number", value: 8}
})
Print(GetVariables().themes)
```

## Components

- A component is a frame with `reusable: true`, placed on the canvas outside screens, in a `Components` board.
- Name with a slash path: `Button/Primary`, `Button/Secondary`, `Input/Default`. Name every child (`Label`, `Icon`) — instances override children by their ids, and you find those ids by name.
- Bind every value to tokens. Size with `fit_content` (buttons) or `fill_container` (inputs) so instances adapt.
- Variants are separate components side by side (`Button/Primary`, `Button/Secondary`, `Button/Ghost`), each a copy of the first with a few `Update`s.

```js
boardId = Insert(document, {type: "frame", name: "Components", layout: "horizontal", gap: 40, padding: 40, fill: "$color-bg"})
buttonId = Insert(boardId, {type: "frame", name: "Button/Primary", reusable: true, padding: [12, 20], gap: "$space-2", alignItems: "center", cornerRadius: "$radius-2", fill: "$color-accent"})
Insert(buttonId, {type: "text", name: "Label", content: "Button", fontFamily: "$font-body", fontSize: 15, fontWeight: "500", fill: "$color-on-accent"})
labelId = Get(buttonId, n => n.name === "Label" ? n.id : undefined)[0]
TakeScreenshot([boardId])
```

## Instances

- `Copy(componentId, parent, overrides)` creates an instance. Change its parts with `descendants` in the same call, keyed by the child ids of the component.

```js
screenId = Insert(document, {type: "frame", name: "Sign in", width: 390, height: 844, clip: true, layout: "vertical", padding: [80, 24], gap: 16, fill: "$color-bg"})
Copy(buttonId, screenId, {name: "Sign in button", width: "fill_container", justifyContent: "center", descendants: {[labelId]: {content: "Sign in"}}})
Copy(buttonId, screenId, {name: "Dark sign in", theme: {mode: "dark"}, descendants: {[labelId]: {content: "Dark variant"}}})
TakeScreenshot([screenId])
```

- WRONG: inserting a fresh frame that looks like the button. RIGHT: `Copy` the component; the instance keeps following it.
- WRONG: `Update(instanceId, {children: [...]})` to change a label. RIGHT: `Update("instanceId/labelId", {content: "…"})` or `descendants`.
- To remove a part in one instance: `Update("instanceId/iconId", {enabled: false})`.
- Changing the component (`Update(buttonId, …)`) changes every instance: that is the point; do it on purpose.

## The board

- Group components by kind in rows with small muted captions. Show each variant and state (default, hover, disabled) as its own component.
- Add a token sheet: colour swatches (rectangles bound to each `color-*` with the name under it) and the type scale (one line per `text-*`).

## Check

- No hex values left inside components: a visitor printing nodes whose `fill` does not start with `$` finds them.
- Every instance on screens is a `ref` (`Get(screenId, n => n.type === "ref" ? n.name : undefined)`).
- Dark theme screenshot of the board has no invisible text and no low-contrast pairs (`lint`).
