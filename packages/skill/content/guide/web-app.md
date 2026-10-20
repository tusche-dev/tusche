# Web app screens

Dashboards, settings, tables, forms and anything with a sidebar. Read [pen-format.md](../pen-format.md) and [execute.md](../execute.md) first.

## Frame

- One screen = one top-level frame, `width: 1440`, `height: 900`, `clip: true`. A screen that scrolls: keep 1440 wide and give it the height of its content (`height: "fit_content(900)"`).
- Place the next screen to the right with `FindEmptySpace`, not on top of the last one.
- Set tokens before the first screen (see the style or the project's variables).

## App shell

Build the shell first, in one call, then fill the regions one per call.

```js
SetVariables({
  "color-bg": {type: "color", value: "#F6F7F9"}, "color-surface": {type: "color", value: "#FFFFFF"},
  "color-text": {type: "color", value: "#15181D"}, "color-muted": {type: "color", value: "#5D6570"},
  "color-line": {type: "color", value: "#DDE1E6"}, "color-accent": {type: "color", value: "#2457C5"},
  "font-body": {type: "string", value: "Inter"}
})
appId = Insert(document, {type: "frame", name: "Orders", width: 1440, height: 900, clip: true, placeholder: true, fill: "$color-bg", layout: "horizontal"})
sidebarId = Insert(appId, {type: "frame", name: "Sidebar", width: 248, height: "fill_container", layout: "vertical", padding: [20, 16], gap: 4, fill: "$color-surface", stroke: "$color-line", strokeWidth: 1, strokeAlignment: "inner"})
mainId = Insert(appId, {type: "frame", name: "Main", width: "fill_container", height: "fill_container", layout: "vertical", padding: [28, 40], gap: 24})
TakeScreenshot([appId])
```

- Sidebar 232–264 px, fixed. Main area `fill_container` on both axes.
- Top bar inside Main (title, search, primary action) — not a full-width bar above everything, unless the product has global navigation.
- Content padding 24–40 px; one gap value per region.

## Navigation

- Nav items: horizontal frames, `height: 36`, `padding: [0, 12]`, `gap: 10`, `alignItems: "center"`, an `icon` (18–20 px) and a label.
- The active item gets a tinted fill and the text colour; the others no fill and muted text. No accent-coloured backgrounds on every item.
- Group items under small muted labels; push account and settings to the bottom with a `fill_container` spacer frame. A spacer works only in a parent with a real size (the sidebar is `height: "fill_container"`); in a `fit_content` row or card it collapses to 0 (`zero-size`) — use `justifyContent: "space_between"` there.

## Tables

```js
tableId = Insert(mainId, {type: "frame", name: "Orders table", width: "fill_container", layout: "vertical", fill: "$color-surface", stroke: "$color-line", strokeWidth: 1, cornerRadius: 8, clip: true})
for (const [i, row] of [["Order", "Customer", "Total", "Status"], ["#1042", "Mia Chen", "$248.00", "Paid"], ["#1041", "Omar Haddad", "$96.50", "Refunded"]].entries()) {
  const r = Insert(tableId, {type: "frame", name: i ? `Row ${i}` : "Header", width: "fill_container", height: i ? 52 : 40, padding: [0, 20], gap: 16, alignItems: "center", fill: i ? "$color-surface" : "$color-bg"})
  row.forEach((cell, c) => Insert(r, {type: "text", name: cell, content: cell, width: c === 1 ? "fill_container" : 120, textGrowth: "fixed-width", fontFamily: "$font-body", fontSize: i ? 14 : 12, fontWeight: i ? "400" : "500", fill: i ? "$color-text" : "$color-muted", textAlign: c === 2 ? "right" : "left"}))
}
TakeScreenshot([tableId])
```

- A row is a horizontal frame. Columns line up because every cell in a column has the same fixed `width`; one column (the main text) is `fill_container`.
- Numbers right-aligned; ids and amounts can use the mono font if the style has one.
- Separate rows with a 1 px line (a stroke on the row or a 1 px rectangle), not zebra stripes and shadows.
- Show 6–10 rows of believable data, a header, and a footer with pagination or a count.
- Status as a small pill (tinted fill, text colour of the same hue), not a saturated block.

## Forms and settings

- Label above the field, 6–8 px between them, 20–24 px between fields.
- Inputs: `height: 40`, `width: "fill_container"`, `padding: [0, 12]`, 1 px stroke in the line colour, radius from the style.
- Settings: a two-column section — title and one-line description on the left (`width: 320`), controls on the right (`fill_container`) — with a 1 px rule between sections.
- One primary button per form, aligned to the end of the form; a secondary button beside it, never two filled buttons.
- Toggles, checkboxes and radios are small frames you build once as components.

## Dashboards

- One headline metric row, then the detail. Not four identical KPI cards: vary width or emphasis (one large number with a sparkline, the rest compact).
- Charts are frames with `layout: "none"` holding rectangles or a `path`; label axes with muted 12 px text.
- Every card answers one question; title it with that question's answer ("Revenue up 12 %"), not "Card".

## Check

- No text in the table clips (`clipped` warnings name the cell).
- Columns line up across rows: run a visitor printing `c.bounds.x` of one column's cells.
- `lint` has no contrast errors: muted text on the bg colour fails first.
