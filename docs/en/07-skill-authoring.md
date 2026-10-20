# 07 · Agent skill authoring

**English** · [Русский](../ru/07-skill-authoring.md)

The skill is half the product. pen.dev's results come as much from its skill (taste rules, verification habits) as from its API. Tusche ships its **own** skill, written from scratch. Draft: [`docs/drafts/SKILL.md`](../drafts/SKILL.md).

## Where the skill lives

- Source: `packages/skill/` (phase 1). The draft lives in `docs/drafts/` until then.
- Served by the MCP tool `read_skill` (`SKILL.md` plus referenced files), so it works in any MCP client without installing anything.
- Optionally installable as a Claude Code skill (`~/.claude/skills/tusche/`) for clients that support skills natively.
- **The skill is written in English** (models follow English instructions most reliably). This document, which explains it to humans, exists in both languages.

## Structure

```
SKILL.md                 entry: what Tusche is, required reading, golden rules, workflow
pen-format.md            the schema in agent-oriented form (concise, examples, antipatterns)
execute.md               API reference + patterns (loops, components, verification visitors)
guide/
  web-app.md             dashboards, settings, tables, sidebars
  mobile-app.md          safe areas, tab bars, 390×844 screens, touch targets
  landing-page.md        sections, rhythm, hero patterns
  design-system.md       tokens, components first, variants, naming
  slides.md              16:9 frames, type scale for slides
  code.md                design → code and code → design workflows
  tailwind.md            mapping variables and layout to Tailwind v4
```

## Writing rules

1. **Instructions, not essays.** Short imperative bullets. Every rule earns its tokens.
2. **Show the antipattern next to the pattern.** Models learn constraints fastest from "WRONG / RIGHT" pairs.
3. **Encode verification as a habit:** build a section → visitor check (`ctx.problems`) → screenshot of that section → fix in place. Never delete and rebuild.
4. **Encode taste explicitly.** Name the generic-AI smells and forbid them: cards around everything, gradient soup, three equal feature boxes, centred everything, giant drop shadows, emoji as icons.
5. **Keep it format-true.** No CSS thinking: no margins, no percentages, no wrap. The skill must match `pen-format` validation exactly; if the validator rejects something, the skill must say so.
6. **Progressive disclosure.** `SKILL.md` stays under ~250 lines; detail goes in referenced files that the agent reads only when needed.
7. **Version it.** The skill carries a version and is tested by agent evals (see below) on every change.

## Evaluating the skill

A small benchmark in `evals/` (phase 1):

| Prompt set | Measured |
|---|---|
| 10 screens (web, mobile, landing, dashboard, slides) | layout warnings in the final doc, lint findings, number of `execute` calls, total tokens, rollbacks |
| 5 edits on existing real `.pen` files | instance overrides correct, no unintended changes (diff size) |
| Human review | 1–5 taste score from two reviewers, blind |

A skill change is merged only if it does not worsen the automatic metrics.

## Style archetypes

`get_style` complements the skill: when the user gives no direction, the agent picks an archetype instead of inventing yet another blue SaaS page. Each archetype is **original** (name, palette, type pairing, rules) and ships with a ready `SetVariables` payload. Initial target: 8 archetypes in phase 1, covering editorial, technical, playful, dark product, bento, brutalist, minimal mono and warm consumer.
