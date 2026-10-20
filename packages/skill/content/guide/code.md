# Design ↔ code

Turning a `.pen` design into code, and code into a `.pen` design. For Tailwind projects also read [tailwind.md](tailwind.md).

## Design → code

1. Read the tokens: `GetVariables()`. They become the project's CSS variables or theme entries with the same names (`color-accent` → `--color-accent`).
2. Read the components: `Get(n => n.reusable ? {id: n.id, name: n.name} : undefined)`. Each one maps to a component in the codebase; reuse the project's existing components when the names or shapes match.
3. Read one screen at a time with depth, not the whole document: `Get(screenId, {depth: 6})`. Instances come back as `ref` nodes with overrides — implement them as the component with props.
4. Translate layout literally:

| `.pen` | Code |
|---|---|
| `layout: "horizontal"` / `"vertical"` | flex row / flex column |
| `gap`, `padding` | gap, padding |
| `justifyContent`, `alignItems` | justify-content, align-items |
| `width: "fill_container"` along the layout | `flex: 1` (across the layout: `align-self: stretch`) |
| `fit_content` | the element's natural size |
| `layout: "none"` + `x`/`y` | position: relative parent, absolute children |
| `textGrowth: "fixed-width"` + width | a max width on the text block |
| `lineHeight` (multiplier) | unitless line-height |

5. Render the screen (`render` with its id) and compare it with the running app; fix spacing and type in code until they match.
6. `Export([screenId], "html-tailwind", "./exports/screen.html")` gives a static reference. Use it to check values, not as production code.

- WRONG: guessing values from a screenshot. RIGHT: read the node properties and tokens.
- WRONG: hard-coding hex values the design binds to variables. RIGHT: use the variable.

## Code → design

1. Read the project's tokens (CSS variables, a Tailwind `@theme`, a theme file) and write them with `SetVariables`, keeping the names.
2. For each component the user names, build a `reusable` frame with the same name, the same children and the same variants (see [design-system.md](design-system.md)). Bind every value to a variable.
3. Rebuild screens from instances of those components; check each with `TakeScreenshot` against the running app.

- Mirror structure, not pixels: one frame per flex container in the code, the same nesting.
- Keep names identical on both sides (`Button/Primary` ↔ `<Button variant="primary">`), so the next round trip is mechanical.

## Check

- Every variable used in the design exists in code and vice versa (list both and diff the names).
- The render of the design and a screenshot of the app match in spacing, type sizes and colours.
