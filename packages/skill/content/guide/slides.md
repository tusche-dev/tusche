# Slides

Decks and single slides. Read [pen-format.md](../pen-format.md) and [execute.md](../execute.md) first.

## Frames

- One slide = one top-level frame, `width: 1920`, `height: 1080`, `clip: true`. Name them in order: `01 Title`, `02 Problem`, …
- Lay slides out in a row, 120 px apart, or in rows of five for long decks. Place each new slide with `FindEmptySpace({width: 1920, height: 1080, direction: "right", padding: 120, nodeId: lastSlideId})`.
- Margins 120 px on all sides; the content area is 1680 × 840.

```js
SetVariables({
  "color-bg": {type: "color", value: "#0B0D10"}, "color-text": {type: "color", value: "#EDEFF2"},
  "color-muted": {type: "color", value: "#9AA1AB"}, "color-accent": {type: "color", value: "#B8F04A"},
  "font-display": {type: "string", value: "Geist"}
})
slideId = Insert(document, {type: "frame", name: "01 Title", width: 1920, height: 1080, clip: true, placeholder: true, layout: "vertical", justifyContent: "end", padding: 120, gap: 32, fill: "$color-bg"})
Insert(slideId, {type: "text", name: "Kicker", content: "Series A · 2026", fontFamily: "$font-display", fontSize: 32, fill: "$color-accent"})
Insert(slideId, {type: "text", name: "Title", content: "Every warehouse, one live map", fontFamily: "$font-display", fontSize: 120, fontWeight: "600", lineHeight: 1.05, letterSpacing: -3, width: 1400, textGrowth: "fixed-width", fill: "$color-text"})
spot = FindEmptySpace({width: 1920, height: 1080, direction: "right", padding: 120, nodeId: slideId})
nextId = Insert(document, {type: "frame", name: "02 Problem", x: spot.x, y: spot.y, width: 1920, height: 1080, clip: true, placeholder: true, layout: "vertical", padding: 120, gap: 48, fill: "$color-bg"})
TakeScreenshot([slideId])
```

## Type scale

- Title slide 96–160 px; slide titles 56–72 px; body 32–40 px; captions and footnotes 24 px. Nothing under 24 px.
- At most 3 sizes per slide. One font family is enough; the style's display font for titles.
- At most ~25 words of body text per slide. Split, don't shrink.

## Layouts

- One idea per slide. The title states the takeaway ("Churn halves after week two"), not the topic ("Churn").
- Reuse 3–4 layouts across the deck: title, statement (one huge sentence), split (text left, visual right), number (one giant figure + one line), and a chart slide.
- Keep the title at the same position on every content slide: build a `Slide/Content` component with a `Title` and a `Body` slot frame and `Copy` it.
- Charts: few bars or one line, direct labels instead of legends, the key bar in the accent.

## Check

- Screenshot each slide; at scale 1 a 1920 slide is downscaled to 1600, so check that the smallest text still reads.
- Titles sit at the same `y` across content slides.
- No slide has more than one accent use.
