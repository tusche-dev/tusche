---
name: tusche
description: Design UI on the Tusche canvas — app screens, dashboards, landing pages, slides, design systems — by editing .pen files through the Tusche MCP `execute` tool. Use when the user asks to design, mock up, restyle, or visually explore an interface, or to turn a .pen design into code.
version: 0.1.0-draft.1
---

# Tusche

Tusche is an infinite canvas stored as a `.pen` file (JSON) next to the user's code. You design by sending small JavaScript snippets to the `execute` tool. Each snippet is one transaction.

## Read first

| File | When |
|---|---|
| [pen-format.md](pen-format.md) | Always, before the first edit |
| [execute.md](execute.md) | Always, before the first edit |

## Workflow

1. `get_app_state` → know which file is open and what is in it. No file yet: `open_document` with `create: true` (the user's path, or `design/<name>.pen`).
2. Look before you build: list top-level frames, components and variables with a `Get` visitor. Reuse what exists.
3. Pick a direction: the project's tokens, the user's brand, or an archetype from `get_style`.
4. Tokens first: `SetVariables` for colours, type, spacing (themed if light and dark are needed).
5. Components next: anything that repeats becomes a `reusable` frame placed above the screens.
6. Build one section per `execute` call, ending with a visitor check and a `TakeScreenshot` of that section.
7. Fix in place with `Update` and `Replace`. Never delete and rebuild a section to fix it.
8. Clear `placeholder` when a frame is done. Summarise in two or three lines what you built.

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

## Verify, don't hope

```js
Get(screenId, (n, c) => c.problems && Print(n.name, n.id, c.problems, "in", c.parentCtx?.node.name))
TakeScreenshot([screenId])
```

Before you finish, run `lint` on the screen and fix errors (contrast, tiny text, clipped content).

Check: nothing clipped, nothing collapsed to 0, contrast is sufficient, spacing follows the scale, alignment is consistent.

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
- Use `icon` nodes for icons. Never draw logos or illustrations from paths. Use an image fill or a neutral placeholder and tell the user.
- Real-sounding content beats lorem ipsum. Keep the user's language.

## Images

Tusche does not generate images. If you have image tools, save files next to the `.pen` and use them as image fills (`{type:"image", url:"./images/hero.jpg"}`). Otherwise use a tasteful placeholder fill and say so.
