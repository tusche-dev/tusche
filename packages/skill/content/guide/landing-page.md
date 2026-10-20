# Landing pages

Marketing pages: hero, features, social proof, pricing, FAQ, footer. Read [pen-format.md](../pen-format.md) and [execute.md](../execute.md) first.

## Frame

- One page = one top-level frame, `width: 1440`, `height: "fit_content(900)"`, `layout: "vertical"`, `clip: true`. A mobile version is a separate 390-wide frame beside it.
- Each section is a full-width frame (`width: "fill_container"`) with vertical padding 80–128 px. Inside it, a content frame of fixed width (1120–1200) centred by the section's `alignItems: "center"`.
- Build the page skeleton (empty named sections with placeholder heights) in the first call, then one section per call.

```js
SetVariables({
  "color-bg": {type: "color", value: "#F7F4EE"}, "color-text": {type: "color", value: "#1B1A17"},
  "color-muted": {type: "color", value: "#6B675F"}, "color-accent": {type: "color", value: "#B4532F"},
  "color-on-accent": {type: "color", value: "#FFFDF9"},
  "font-display": {type: "string", value: "Lora"}, "font-body": {type: "string", value: "Inter"}
})
pageId = Insert(document, {type: "frame", name: "Landing", width: 1440, height: "fit_content(900)", layout: "vertical", clip: true, placeholder: true, fill: "$color-bg"})
heroId = Insert(pageId, {type: "frame", name: "Hero", width: "fill_container", layout: "vertical", alignItems: "center", padding: [120, 0, 96, 0]})
heroInnerId = Insert(heroId, {type: "frame", name: "Hero content", width: 1160, layout: "vertical", gap: 28})
Insert(heroInnerId, {type: "text", name: "Headline", content: "Bookkeeping that closes the month for you", fontFamily: "$font-display", fontSize: 64, lineHeight: 1.1, width: 820, textGrowth: "fixed-width", fill: "$color-text"})
Insert(heroInnerId, {type: "text", name: "Lead", content: "Ledgerly reconciles bank feeds, chases receipts and hands your accountant a clean file on the first of every month.", fontFamily: "$font-body", fontSize: 20, lineHeight: 1.5, width: 600, textGrowth: "fixed-width", fill: "$color-muted"})
ctaId = Insert(heroInnerId, {type: "frame", name: "Primary CTA", padding: [16, 28], cornerRadius: 6, fill: "$color-accent"})
Insert(ctaId, {type: "text", name: "CTA label", content: "Start a free month", fontFamily: "$font-body", fontSize: 16, fontWeight: "500", fill: "$color-on-accent"})
TakeScreenshot([heroId])
```

## Hero

- Pick one pattern and commit: text left + product visual right; huge headline full width with the visual below; or a split with a strong colour field. Not a centred headline over a gradient.
- Headline 56–88 px, 6–10 words, what the product does for whom. Lead 18–22 px, at most 640 px wide (`textGrowth: "fixed-width"`).
- One primary action, one quiet secondary link. Social proof (logos, a number, a quote) right under or beside the CTA.

## Sections and rhythm

- Vary the layout from section to section: a two-column text+image, then a full-width quote, then a list, then a grid. Never three in a row of the same shape.
- Features: not three identical boxes. Use an asymmetric grid (one large, two small), a numbered list with a visual, or alternating text/image rows.
- Section titles left-aligned with the content edge; centre only short, single-line statements.
- Keep one content width and one outer margin through the page. Change the background (bg / surface / a dark band) to separate sections instead of borders and shadows.

## Pricing

- 2–3 plans side by side, equal width (`fill_container` each inside a fixed-width row). Highlight one plan with the accent border or a dark fill — not with scale or a shadow.
- Each plan: name, price (large), period (muted), one-line who it is for, 4–6 features with check icons, a button at the bottom. Align buttons by giving the cards the same height (`height: "fill_container"` in a row with a fixed height) or by putting features in a `fill_container` frame.
- Monthly / yearly switch above the plans when asked; show the saving as text ("2 months free"), not a badge storm.

## Footer

- Dense and quiet: columns of small muted links, the logo text, legal line. 64–80 px padding.

## Check

- `TakeScreenshot` each section after you build it; at the end, one screenshot of the whole page (it is scaled to 1600 px on the long side).
- Lines of body text no wider than ~640 px; headlines do not run into the visual.
- Each section has one focal point; the page has at least one memorable layout move.
