# Tailwind v4

Mapping `.pen` variables and layout to Tailwind CSS v4. Read [code.md](code.md) first.

## Tokens → `@theme`

Tailwind v4 is configured in CSS. Each variable becomes a theme variable whose namespace creates the utilities:

| `.pen` variable | `@theme` | Utilities |
|---|---|---|
| `color-accent` | `--color-accent` | `bg-accent`, `text-accent`, `border-accent` |
| `font-display` | `--font-display` | `font-display` |
| `text-4` (a size) | `--text-4` | `text-4` |
| `space-*` | `--spacing` (base unit) or explicit values | `p-4`, `gap-6`, or `p-(--space-4)` |
| `radius-2` | `--radius-2` | `rounded-2` |

```css
@import "tailwindcss";

@theme {
  --color-bg: #f7f4ee;
  --color-text: #1b1a17;
  --color-accent: #b4532f;
  --font-display: "Lora", serif;
  --font-body: "Inter", sans-serif;
  --radius-2: 4px;
}
```

- Spacing: if the `space-*` scale is a 4 px grid, keep Tailwind's `--spacing: 4px` and use the numeric utilities (`gap-4` = 16 px). Otherwise reference the variables directly: `gap-(--space-5)`.
- Themed variables (`mode: light / dark`): put the light values in `@theme` and override them for dark under the project's dark selector (`.dark { --color-bg: … }` or `@media (prefers-color-scheme: dark)`). Utilities follow automatically.

## Layout → classes

| `.pen` | Tailwind |
|---|---|
| `layout: "horizontal"` / `"vertical"` | `flex` / `flex flex-col` |
| `gap: 16` | `gap-4` |
| `padding: [12, 20]` | `py-3 px-5` |
| `justifyContent: "space_between"` | `justify-between` |
| `alignItems: "center"` | `items-center` |
| `width: "fill_container"` (along the layout) | `flex-1` (`min-w-0` for text that must truncate) |
| `width: "fill_container"` (across the layout) | `self-stretch` |
| `width: 320` | `w-80` or `w-[320px]` |
| `cornerRadius: 8` | `rounded-lg` or `rounded-(--radius-2)` |
| `clip: true` | `overflow-hidden` |
| `layoutPosition: "absolute"` + `x`/`y` | `absolute left-[x] top-[y]` in a `relative` parent |

- Text: `fontSize` → `text-[size]` or the `text-*` token; `lineHeight: 1.5` → `leading-normal` or `leading-[1.5]`; `fontWeight: "600"` → `font-semibold`; `letterSpacing: -1` → `tracking-[-1px]`.
- Shadows: `{type: "shadow", offset: {x: 0, y: 8}, blur: 24, color: "#0000001A"}` → `shadow-[0_8px_24px_#0000001A]`.

## Check

- No raw hex in class names where a token exists (`bg-[#B4532F]` → `bg-accent`).
- Build the page and compare it with `render` of the design at the same width.
