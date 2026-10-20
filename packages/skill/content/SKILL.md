---
name: tusche
description: Design UI on the Tusche canvas — app screens, dashboards, landing pages, slides, design systems — by editing .pen files through the Tusche MCP `execute` tool. Use when the user asks to design, mock up, restyle, or visually explore an interface, or to turn a .pen design into code and back.
version: 0.1.0
---

# Tusche

Tusche is an infinite canvas stored as a `.pen` file (JSON) next to the user's code. You design by sending small JavaScript snippets to the `execute` tool. Each snippet is one transaction: all of it applies, or none of it.

## Read first

| File | When |
|---|---|
| [pen-format.md](pen-format.md) | Always, before the first edit |
| [execute.md](execute.md) | Always, before the first edit |

## Guides

Read the one guide that matches the task, before you build. Skip the others.

| Guide | Task |
|---|---|
| [guide/web-app.md](guide/web-app.md) | Desktop app screens: dashboards, settings, tables, forms, sidebars |
| [guide/mobile-app.md](guide/mobile-app.md) | Phone screens: onboarding, tab bars, lists, safe areas |
| [guide/landing-page.md](guide/landing-page.md) | Marketing pages: hero, sections, pricing, footer |
| [guide/design-system.md](guide/design-system.md) | Tokens, components, variants, light and dark themes |
| [guide/slides.md](guide/slides.md) | Decks and single slides, 16:9 |
| [guide/code.md](guide/code.md) | Design → code and code → design |
| [guide/tailwind.md](guide/tailwind.md) | Mapping variables and layout to Tailwind v4 |

## Workflow

1. `get_app_state` → which file is open and what is in it. No file yet: `open_document` with `create: true` (the user's path, or `design/<name>.pen`).
2. Look before you build: list top-level frames, components and variables (`Get` with a visitor, `GetVariables`). Reuse what exists.
3. Pick a direction, in this order: the project's existing tokens, the user's brand or words, else an archetype. `get_style` without a name lists archetypes; pick the one whose summary fits the product, then `get_style` with its name (and `params` if a variant fits better).
4. Tokens first: pass the style's `variables` to `SetVariables` in one call, then bind them: `fill: "$color-bg"`, `fontFamily: "$font-display"`, `gap: "$space-4"`. Follow the style's `rules`.
5. Components next: anything that appears twice becomes a `reusable` frame placed beside the screens.
6. Build one section per `execute` call. End each call with a visitor check and a `TakeScreenshot` of that section.
7. Look at the screenshot. Fix in place with `Update` and `Replace`. Never delete and rebuild a section to fix it.
8. Finish: `lint` the screen and fix errors, set `placeholder: false`, then summarise in two or three lines what you built.

## Golden rules

- One screen = one top-level frame in `document`, with `clip: true`. Nothing small (text, buttons, icons) at the root.
- Name every node you create. Names come back as a names → ids map.
- Never set `id`. Capture returned ids in globals without `const`: `heroId = Insert(...)`.
- Mark a top-level frame `placeholder: true` while you work on it.
- When a call fails, fix it with `editId` + `edits`. Never resend the snippet.
- A committed change you regret: `undo`, not a counter-snippet.
- Think in this format, not CSS: no margins, no percentages, no wrap, no `alignItems: stretch`. If a property is not in `pen-format.md`, it does not exist.
- Prefer `fill_container` / `fit_content` over pixel sizes. Never guess text sizes; use `textGrowth`.
- Text is invisible without `fill`.
- Copying a reusable node creates an instance. Customise it through `descendants` in the same call.
- Do only what was asked. Don't restyle what the user didn't mention.

## Common mistakes

| WRONG | RIGHT |
|---|---|
| `{type: "text", content: "Hi"}` | `{type: "text", content: "Hi", fill: "$color-text"}` |
| `width: "50%"`, `margin: 24` | `width: "fill_container"`; space with the parent's `gap` and `padding` |
| `x: 40` on a child of a frame with layout | `padding` / `gap` on the parent, or `layoutPosition: "absolute"` |
| `layoutPosition: "absolute"` + `width: "fill_container"` (collapses to 0) | an absolute node gets pixel sizes |
| long text with default `textGrowth` (one endless line) | `textGrowth: "fixed-width"` + `width: 560` or `"fill_container"` |
| a row of children that should stretch, parent `fit_content` | parent with a real width, children `fill_container` |
| deleting a broken section and inserting it again | `Update` / `Replace` the broken nodes |
| resending a failed snippet with one change | `editId` + `edits: [{find, replace}]` |
| Latin-only display font with Russian text (`missing-glyphs`) | a font that covers the script; all archetype fonts cover Latin and Cyrillic |
| a frame per word to space things out | one frame with `gap` |

## Verify, don't hope

```js
Get(screenId, (n, c) => c.problems && Print(n.name, n.id, c.problems, "in", c.parentCtx?.node.name))
TakeScreenshot([screenId])
```

Read every warning in the answer; each one names the node and what is wrong. Before you finish, run `lint` on the screen and fix every error (contrast, tiny text, clipped content).

Check the screenshot for:
- nothing clipped, nothing collapsed to 0, no text running out of its box;
- contrast is sufficient: muted text on tinted surfaces fails first;
- spacing follows the scale (`space-*`), edges line up;
- one clear focal point per section;
- every text in a font that covers its language (no `missing-glyphs` warning).

## Taste

- Hierarchy through size, weight and space before colour.
- Use one accent colour. Neutrals do most of the work.
- Avoid the generic-AI look:
  - cards wrapped around everything;
  - three identical feature boxes;
  - gradients on every surface;
  - heavy drop shadows;
  - everything centred;
  - emoji used as icons.
- Vary rhythm between sections. Make at least one deliberate, memorable layout move per page.
- Use `icon` nodes for icons (`lucide`, `phosphor`). Never draw logos or illustrations from paths. Use an image fill or a neutral placeholder and tell the user.
- Real-sounding content beats lorem ipsum: names, numbers, dates and prices that fit the product. Keep the user's language.
- Fonts must cover that language: many display fonts are Latin-only. A `missing-glyphs` warning means the text falls back to another font — pick a font that covers the script.

## Styles

`get_style` returns `fonts`, `palette`, `scale`, `imagery`, `rules` and `variables`.

- `variables` is ready for `SetVariables`: `color-<slot>`, `font-display` / `font-body` / `font-mono`, `text-1…n` (font sizes, small to large), `space-1…n`, `radius-1…n`.
- Bind tokens instead of pasting hex values, so a later restyle is one `SetVariables` call.
- `rules` are part of the direction, not decoration. Follow them unless the user says otherwise.
- Do not mix archetypes on one page.

## Images

Tusche does not generate images. If you have image tools, save files next to the `.pen` and use them as image fills (`{type: "image", url: "./images/hero.jpg"}`). Otherwise use a tasteful placeholder fill (a surface colour with a short label) and say so.
