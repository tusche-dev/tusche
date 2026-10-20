import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';

/** Root of the repository. */
export const REPO = fileURLToPath(new URL('../..', import.meta.url));
/** Folder of the task files. */
export const TASK_DIR = join(REPO, 'evals', 'tasks');

const TaskSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
  kind: v.picklist(['screen', 'edit']),
  /** The `.pen` file the agent works on, relative to the task's working folder. */
  file: v.string(),
  prompt: v.string(),
  /** File of the repository copied to `file` before the run (edits). */
  fixture: v.optional(v.string()),
  /** Top-level ids an edit may change; `"variables"` allows changing variables and themes. */
  scope: v.optional(v.array(v.string())),
  maxTurns: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

export type Task = v.InferOutput<typeof TaskSchema>;

/** Every task, sorted by id; edits must have a fixture and a scope. */
export function loadTasks(dir = TASK_DIR): Task[] {
  const tasks = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const parsed = v.safeParse(TaskSchema, JSON.parse(readFileSync(join(dir, file), 'utf8')));
      if (!parsed.success) {
        const issue = parsed.issues[0];
        throw new Error(`${file}: ${v.getDotPath(issue) ?? '$'}: ${issue.message}`);
      }
      const task = parsed.output;
      if (`${task.id}.json` !== file) throw new Error(`${file}: id "${task.id}" ≠ file name`);
      if (task.kind === 'edit' && (task.fixture === undefined || task.scope === undefined)) {
        throw new Error(`${file}: an edit needs fixture and scope`);
      }
      return task;
    });
  return tasks;
}
