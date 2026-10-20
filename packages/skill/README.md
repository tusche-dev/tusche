# @tusche/skill

The agent skill: `SKILL.md` and the guides it links to, served by the MCP tool `read_skill`.

Part of [Tusche](../../README.md), an open design canvas for AI agents. Not published yet.

```ts
import { listSkillFiles, readSkill } from '@tusche/skill';

await readSkill(); // SKILL.md
await readSkill('execute.md');
await listSkillFiles(); // ['SKILL.md', 'execute.md', 'pen-format.md']
```

The files live in `content/` and are written in English. Version 0.1.0-draft.1 (stage 1.5): the workflow, golden rules, the `.pen` format and the `execute` API. Task guides (`guide/*.md`) and evals come in stage 1.6; how the skill is written and tested is in [07-skill-authoring](../../docs/dev/07-skill-authoring.md).
