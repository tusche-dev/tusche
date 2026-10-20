# Mobile app screens

Phone screens: onboarding, feeds, lists, details, tab bars. Read [pen-format.md](../pen-format.md) and [execute.md](../execute.md) first.

## Frame

- One screen = one top-level frame, `width: 390`, `height: 844`, `clip: true`, `layout: "vertical"`. Place screens of one flow side by side with a 80 px gap (`FindEmptySpace` with `direction: "right"`).
- Safe areas: keep the top 54 px for the status bar and the bottom 34 px for the home indicator. Put them in as named frames (`Status bar`, `Home indicator`) so nothing slides under them.
- Side padding 16–24 px, the same on every screen of the flow.

## Structure that never overlaps

Stack the screen vertically: status bar, header, content (`height: "fill_container"`), tab bar. The content absorbs the remaining height, so the tab bar sits at the bottom without absolute positioning.

```js
SetVariables({
  "color-bg": {type: "color", value: "#FFFBF4"}, "color-text": {type: "color", value: "#2B1D14"},
  "color-muted": {type: "color", value: "#6C5A4C"}, "color-line": {type: "color", value: "#E8D7BF"},
  "color-accent": {type: "color", value: "#B5441F"}, "color-on-accent": {type: "color", value: "#FFFBF4"}
})
phoneId = Insert(document, {type: "frame", name: "Home", width: 390, height: 844, clip: true, placeholder: true, layout: "vertical", fill: "$color-bg"})
Insert(phoneId, {type: "frame", name: "Status bar", width: "fill_container", height: 54})
contentId = Insert(phoneId, {type: "frame", name: "Content", width: "fill_container", height: "fill_container", layout: "vertical", padding: [8, 20], gap: 16, clip: true})
tabsId = Insert(phoneId, {type: "frame", name: "Tab bar", width: "fill_container", layout: "vertical", fill: "$color-bg"})
Insert(tabsId, {type: "rectangle", name: "Divider", width: "fill_container", height: 1, fill: "$color-line"})
tabRowId = Insert(tabsId, {type: "frame", name: "Tabs", width: "fill_container", height: 49, justifyContent: "space_around", alignItems: "center"})
for (const [name, icon] of [["Home", "house"], ["Search", "search"], ["Orders", "receipt"], ["Profile", "user"]]) {
  const tab = Insert(tabRowId, {type: "frame", name: `Tab ${name}`, width: 64, height: 44, layout: "vertical", gap: 2, alignItems: "center", justifyContent: "center"})
  Insert(tab, {type: "icon", name: `${name} icon`, library: "lucide", icon, width: 22, height: 22, fill: name === "Home" ? "$color-accent" : "$color-muted"})
  Insert(tab, {type: "text", name: `${name} label`, content: name, fontSize: 12, fontWeight: "500", fill: name === "Home" ? "$color-accent" : "$color-muted"})
}
Insert(tabsId, {type: "frame", name: "Home indicator", width: "fill_container", height: 34})
TakeScreenshot([phoneId])
```

- WRONG: tab bar with `layoutPosition: "absolute"`, `y: 760` and `width: "fill_container"` — it collapses to 0 wide and covers content. RIGHT: the vertical stack above.
- Content longer than one screen: keep the frame 844 high and let `Content` clip (the clipped part is "below the fold"), or make a separate tall frame named `Home (scroll)` with `height: "fit_content(844)"` when the user wants the whole page.

## Touch and type

- Touch targets at least 44 × 44 px, even when the icon is 20 px: give the button frame the size, not the icon.
- Body 15–17 px, secondary 13 px, nothing below 12 px (tab labels included; `lint` flags smaller text). Titles 28–34 px.
- Checkboxes, radios and switches: the visible box may be 20–24 px, but the frame that holds it and its label is the target, at least 44 px high.
- Primary action: a full-width button (`width: "fill_container"`, `height: 52`) in the thumb zone near the bottom of `Content`.
- Lists: rows 56–72 px high, `alignItems: "center"`, leading icon or avatar, text block `fill_container`, trailing chevron or value. Separate with 1 px lines inset to the text start.

## Onboarding

- One idea per screen: illustration or image area (about half the height), a title, one or two lines of text, the primary button, a quiet secondary action ("Skip", "I already have an account").
- Page dots as small ellipses in a horizontal frame; the current one wider or in the accent.
- Build the first screen, check it, then `Copy` it for the next ones and change the texts with `Update`.

## Check

- Nothing sits under the status bar or the home indicator.
- Every tappable element is at least 44 px on both axes (`lint` reports small touch targets).
- The flow's screens share padding, title position and button position: a visitor printing the `c.bounds` of the titles shows the same `y`.
