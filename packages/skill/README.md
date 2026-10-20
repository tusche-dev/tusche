# @tusche/skill

The agent skill: `SKILL.md` and the guides it links to, served by the MCP tool `read_skill`.

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.

```ts
import { listSkillFiles, readSkill } from '@tusche/skill';

await readSkill(); // SKILL.md
await readSkill('execute.md');
await readSkill('guide/web-app.md');
await listSkillFiles(); // ['SKILL.md', 'execute.md', 'guide/code.md', …, 'pen-format.md']
```

The files live in `content/` and are written in English. Version 0.1.1 (after the 0.1.0 eval baseline):

- `SKILL.md` — workflow, golden rules, common mistakes, verification, taste, styles;
- `pen-format.md`, `execute.md` — the format and the `execute` API;
- `guide/` — one guide per task: `web-app`, `mobile-app`, `landing-page`, `design-system`, `slides`, `code`, `tailwind`.

Tests check that every file is linked from `SKILL.md`, every link resolves, and every `js` block in a guide runs in `execute` without errors or warnings (font warnings aside). Skill changes are measured with the evals in [`evals/`](../../evals/README.md); how the skill is written is in [07-skill-authoring](../../docs/dev/07-skill-authoring.md).
