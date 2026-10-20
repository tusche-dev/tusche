# The execute tool

You change a design by sending a JavaScript snippet to `execute`. One call is one transaction: every change applies, or none does.

```jsonc
{ "filePath": "design/app.pen", "input": "heroId = Insert(document, {type: \"frame\", name: \"Hero\"})" }
// after a failure — patch the stored snippet, never resend it:
{ "filePath": "design/app.pen", "editId": "e3", "edits": [{ "find": "fontSize: 64", "replace": "fontSize: 56" }] }
```

Each `find` must match exactly once unless it has `all: true`. The patched snippet runs from the start; if it fails again, keep patching under the same `editId`.

## Rules of the sandbox

- `document` is the id of the root.
- Each call gets a fresh scope. Globals assigned **without** `const` / `let` / `var` survive to the next call on the same document (`heroId = Insert(...)`); only JSON values are kept.
- Limits per call: 10 s, 256 MB, 2000 changes, 6 screenshots, 20 000 characters of `Print`.
- Ids are always generated. An `id` you pass is ignored with a warning.
- No file system, no network, no `Generate`: bring images as files next to the `.pen`.

## API

```ts
declare const document: string

// mutations
Insert(parent: string, node: PenNode): string            // appends; returns the new id; a null property is left out
Copy(path: string, parent: string, overrides?: Partial<PenNode> & { descendants?: Descendants }): string
Update(path: string, props: Partial<PenNode>): void      // null deletes a property; children replaces all children
Replace(path: string, node: PenNode): string             // a whole new node; returns its new id
Move(path: string, parent?: string, index?: number): void
Delete(path: string): void                               // inside an instance: Update(path, {enabled: false})
SetVariables(vars: Record<string, VariableDef | null>, replace?: boolean): void

// reads
Get(path: string, opts?: GetOptions): PenNode
Get<T>(path: string, visit: Visit<T>, opts?: GetOptions): T[]
Get<T>(visit: Visit<T>, opts?: GetOptions): T[]
GetVariables(): { variables: Record<string, VariableDef>; themes?: Record<string, string[]> }
FindEmptySpace(q: { width: number; height: number; direction?: 'top' | 'right' | 'bottom' | 'left'; padding?: number; nodeId?: string }): { x: number; y: number }

// output
Print(...values: unknown[]): void
TakeScreenshot(nodeIds: string[], opts?: { scale?: number }): void
Export(nodeIds: string[], format: 'png' | 'jpeg' | 'webp' | 'svg' | 'html-tailwind', outPath: string, opts?: { scale?: number }): void

interface GetOptions { depth?: number; resolveVariables?: boolean; resolveInstances?: boolean; includePathGeometry?: boolean }
type Visit<T> = (node: PenNode, ctx: Ctx) => T | undefined
interface Ctx {
  node: PenNode; parentCtx?: Ctx; depth: number; index: number
  bounds: { x: number; y: number; width: number; height: number }   // laid out, in the parent's space
  problems?: 'partially clipped' | 'fully clipped'
  skipChildren(): void
}
```

## Semantics worth knowing

- **Paths.** A path is a node id, or `instanceId/childId` for any node inside an instance, however deep (one more `/childId` only to go into a nested instance). Never pass node objects.
- **Reads see the call's own changes.** `Get` lays out what you inserted a line earlier.
- **Visitors.** Return `undefined` to collect nothing. There is no whole-document read without a visitor. `Get(document)` returns the top-level nodes. Without a visitor, `depth` defaults to 2; deeper children come back as `"..."`.
- **Visitors and instances.** A visitor stops at an instance (`type: "ref"`): it does not see the component's nodes inside it. Pass `{resolveInstances: true}` to walk into instances. Then `n.id` of a node inside one is already its full path (`"instId/childId"`): pass it to `Update` as it is, never prefix it with the instance id again.
- **Instances.** `Copy` of a component returns an instance; customise its parts through `descendants` in the same `Copy`. Nodes of a component inside an instance change only through `Update` and `Replace`; fill a slot with `Update("inst/slot", {children: [...]})`.
- **`Update`** cannot change `id`, `type` or `ref`: use `Replace`.
- **`Move`.** `index` counts after the node left its old place. Nothing moves into or out of an instance.
- **`Delete`** of a component that has instances is an error.
- **Caught errors.** A failing operation caught with `try/catch` undoes only itself. An uncaught error rolls back the whole call.
- **`TakeScreenshot`** renders after the commit; the images come with the answer (scale 1, long side at most 1600 px). A failed call returns none.
- **`Export`** writes next to the document. `pdf` is not available yet.

## The answer

```
ok · 3 inserted · 1 updated · 0 deleted · 142 ms
names:
  Hero=Kp2xQ  Headline=a9Fz1
print:
  Kp2xQ Hero 1440 640
warnings:
  [clipped] "Card Grid" (Rt5Yu) is partially clipped by "Hero" (Kp2xQ)
```

On failure: `error · rolled back · editId=e7`, the error, the line, and a `hint:`.

Warnings are checked only for the nodes the call created or changed:

| Code | Means |
|---|---|
| `clipped` | A child is partly or fully outside a clipping ancestor. Siblings overlapping each other are not reported: check the screenshot |
| `invisible-text` | Text without `fill` |
| `zero-size` | A frame collapsed to 0 on an axis |
| `circular-size` | `fit_content` parent, only `fill_container` children |
| `ignored-xy` | `x`/`y` set inside a parent with layout |
| `unknown-font` | The font was not found; a fallback was used |
| `missing-glyphs` | The font has no glyphs for some characters (e.g. a Latin-only font with Cyrillic text); they are drawn in a fallback font |
| `id-ignored` | You passed an `id` |
| `unsupported-render` | Kept in the file but drawn as a placeholder |

## Other tools

- `undo` / `redo` (`steps?`) — one step per committed `execute` that changed the document, globals included.
- `render` (`nodeIds`, `scale?`) — PNGs without a snippet.
- `lint` (`nodeId?`) — the whole document or one subtree: everything above plus contrast, text size and other design rules.
- `save_document` — the file is saved automatically shortly after each change; this saves now.
