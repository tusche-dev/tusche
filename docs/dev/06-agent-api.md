# 06 · API для агента — инструменты MCP и `execute`

Цель дизайна: агент, который уже знает словарь `execute` из pen.dev, должен сразу продуктивно работать в Tusche. **Имена функций и их семантика намеренно совместимы.** Реализация, документация и скилл — наши собственные.

## 1. Инструменты MCP

Транспорт: stdio (фаза 1). Имя сервера: `tusche`. Каждый инструмент принимает необязательный `filePath`; если он не указан, используется активный документ.

| Инструмент | Вход | Выход |
|---|---|---|
| `get_app_state` | — | Активный документ, открытые документы, версии, выделение (фаза 2), несохранённые изменения, конфликты, короткая подсказка «с чего начать» |
| `read_skill` | `path?` | `SKILL.md` или файл-гайд, на который он ссылается (`execute.md`, `guide/web-app.md`, …) |
| `get_style` | `name?`, `params?` | Без аргументов — список архетипов. С `name` — стиль или список его обязательных параметров |
| `open_document` | `filePath`, `create?` | Открывает или создаёт `.pen`; возвращает сводку: фреймы верхнего уровня, компоненты, переменные |
| `save_document` | `filePath?` | Принудительное сохранение (обычно файл сохраняется сам после каждого успешного `execute`) |
| `execute` | `filePath`, `input` **или** `editId` + `edits[]` | См. ниже |
| `render` | `nodeIds[]`, `scale?` | PNG-картинки — для людей и агентов, которым нужна картинка без запуска JS |
| `lint` (could) | `nodeId?` | Замечания линтера OpenPencil, привязанные к id в `.pen` |

В фазе 1 **нет** `browser` и `Generate` (см. roadmap).

## 2. `execute`

### Запрос

```jsonc
// first attempt
{ "filePath": "/abs/design/app.pen", "input": "<javascript snippet>" }

// fix after a failure — never resend the whole snippet
{ "filePath": "/abs/design/app.pen", "editId": "e7", "edits": [
  { "find": "fontSize:64", "replace": "fontSize:56" },
  { "find": "Inter", "replace": "Manrope", "all": true }
]}
```

- `edits` применяются по порядку к сохранённому упавшему сниппету. Каждый `find` должен совпасть ровно один раз, если не указан `all: true`. Исправленный сниппет запускается с нуля.
- Если он снова падает, агент продолжает патчить под тем же `editId`.

### Ответ

Обычный компактный текст в таком порядке:

```
ok · 3 inserted · 1 updated · 0 deleted · 142 ms
names:
  Hero=Kp2xQ  Headline=a9Fz1  Subhead=Lm3Qe
print:
  Kp2xQ Hero 1440 640
warnings:
  [clipped] "Card Grid" (Rt5Yu) is partially clipped by "Hero" (Kp2xQ)
```

К нему добавляется по одному блоку `image` на каждый id из `TakeScreenshot`. При ошибке ответ такой:

```
error · rolled back · editId=e7
  TypeError: Insert(): "padding" is not allowed on node type "text"
  at line 4:  Insert(card,{type:"text",content:"Hi",padding:12})
hint: wrap the text in a frame and put padding on the frame
```

### Модель выполнения

- Каждый вызов — **транзакция**: либо применяются все изменения, либо ни одно.
- Каждый вызов получает свежую область видимости. **Глобальные переменные сохраняются** между вызовами на одном документе, если присвоены без `const` / `let` / `var` (`heroId = Insert(...)`). Сохраняются только значения, которые сериализуются в JSON.
- Лимиты: 10 с на вызов (время хоста, например раскладки, тоже считается), 256 МБ памяти, 2000 изменений, 6 скриншотов и 20 000 символов `Print` за вызов.
- `document` — заранее определённая константа, id корня.
- Id всегда генерирует Tusche. Если во входных данных указан `id`, он игнорируется с предупреждением.

### Справочник API

```ts
declare const document: string

// ── mutations ────────────────────────────────────────────────
Insert(parent: string, node: PenNode): string          // appends; returns the new id
Copy(path: string, parent: string, overrides?: Partial<PenNode> & { descendants?: Descendants }): string
Update(path: string, props: Partial<PenNode>): void    // cannot change id/type/ref; null deletes; children replaces
Replace(path: string, node: PenNode): string           // whole node, incl. inside instances; returns the new id
Move(path: string, parent?: string, index?: number): void
Delete(path: string): void                             // inside instances: use Update(path,{enabled:false})
SetVariables(vars: Record<string, VariableDef>, replace?: boolean): void

// ── reads ────────────────────────────────────────────────────
Get(path: string, opts?: GetOptions): PenNode
Get<T>(path: string, visit: Visit<T>, opts?: GetOptions): T[]
Get<T>(visit: Visit<T>, opts?: GetOptions): T[]
GetVariables(): { variables: Record<string, VariableDef>; themes?: Record<string, string[]> }
FindEmptySpace(q: { width: number; height: number; direction?: 'top'|'right'|'bottom'|'left'; padding?: number; nodeId?: string }): { x: number; y: number; parentId?: string }

// ── output ───────────────────────────────────────────────────
Print(...values: unknown[]): void
TakeScreenshot(nodeIds: string[], opts?: { scale?: number }): void
Export(nodeIds: string[], format: 'png'|'jpeg'|'webp'|'pdf'|'svg'|'html-tailwind', outPath: string, opts?: ExportOptions): void

interface GetOptions { depth?: number; resolveVariables?: boolean; resolveInstances?: boolean; includePathGeometry?: boolean }
type Visit<T> = (node: PenNode, ctx: Ctx) => T | undefined
interface Ctx {
  node: PenNode; parentCtx?: Ctx; depth: number; index: number
  bounds: { x: number; y: number; width: number; height: number }  // resolved, in parent space
  problems?: 'partially clipped' | 'fully clipped'
  skipChildren(): void
}
```

Что важно в семантике:

- **Пути.** `path` — это id ноды или `instanceId/childId[/…]` для нод внутри инстансов компонентов. Никогда не сам объект ноды.
- **`Get` видит несохранённые изменения** того же вызова: перед чтением он передаёт их в мост и пересчитывает layout.
- **Visitor'ы:** если функция вернула `undefined`, ничего не собирается, любое другое значение попадает в результат. Чтения всего документа без visitor'а намеренно нет.
- **`Copy` переиспользуемой ноды возвращает `ref`.** Потомков настраивают через аргумент `descendants` в том же `Copy`, потому что у потомков копии новые id.
- **`TakeScreenshot`** рендерит после применения всех изменений вызова; картинки прикладываются к ответу. Упавший вызов скриншотов не возвращает.
- **`Export`** пишет в папку документа, если `TUSCHE_ROOT` не разрешает больше. Пути записанных файлов возвращаются в ответе.

### Уточнения семантики (этап 1.4)

Как ведёт себя реализация там, где справочник выше оставляет выбор. Поведение инстансов, `Replace`, карты имён и `Get` сверено с pen.dev на копии `design.pen` (2026-10-20); где мы намеренно отличаемся, это сказано.

- **Ошибки и откат.** Ошибка, которую сниппет не поймал, откатывает весь вызов. Если сниппет поймал ошибку операции через `try/catch`, отменяется только эта операция, остальные правки вызова остаются. *Отличие:* pen.dev валит весь вызов при любой ошибке операции, даже пойманной.
- **Карта имён** (`names:`) — только корень каждого `Insert`, `Copy` и `Replace`, вложенные ноды не перечисляются. Безымянный инстанс называется по своему компоненту.
- **Ноды компонента внутри инстанса** правятся только через `Update` и `Replace`. `Insert` в них — ошибка (так и в pen.dev). Детей такой ноды целиком задаёт `Update("inst/slot", {children: [...]})`: это запись `children` в переопределение `descendants`, дети получают новые id и адресуются как `inst/<id>`. Так заполняют слоты.
- **`Copy`.** Копия переиспользуемой ноды — это инстанс `{type: "ref", ref}` с `overrides` на корне и `descendants` как есть. Остальные копии получают новые id на всё поддерево; `reusable` у вложенных нод снимается, а `ref` внутри копии по-прежнему указывают на оригиналы. Ключи `descendants` у обычной копии — id *исходных* нод: свойства сливаются, нода с `type` заменяет ту, что была.
- **`Update`.** `null` удаляет свойство. `children` заменяет детей целиком (новые id). Внутри инстанса правка — переопределение в `descendants`; переопределение, ставшее пустым, удаляется. `id`, `type` и `ref` менять нельзя. *Отличие:* pen.dev такие правки молча принимает и портит ноду (новый id, потерянные свойства), мы отвечаем ошибкой с подсказкой про `Replace`.
- **`Replace`** даёт новой ноде новый id и возвращает его (голый id, как в pen.dev). Внутри инстанса это замена в `descendants` под ключом заменённой ноды, а адрес — `inst/<новый id>`; старый путь больше не находится. Компонент с инстансами заменить нельзя: инстансы потеряли бы его.
- **`Move`.** `index` считается после того, как нода убрана со старого места. Нельзя перемещать в инстанс и из него.
- **`Delete`** компонента, у которого есть инстансы, — ошибка. Внутри инстанса — ошибка с подсказкой `Update(path, {enabled: false})` (так и в pen.dev); ребёнка, которого добавил сам инстанс, удалить можно.
- **`SetVariables`.** `null` удаляет переменную; `replace: true` заменяет весь набор. Значения тем из тематических значений дописываются в `themes`.
- **`Get` без visitor'а.** `depth` по умолчанию 2: столько уровней детей отдаётся полностью, глубже — `children: "..."`. `Get(document)` отдаёт ноды верхнего уровня, `depth` по умолчанию 1. Внутри инстансов `id` — полный путь (`inst/child`). `geometry` у path-нод скрыта, пока не указан `includePathGeometry`. С `resolveInstances` инстанс раскрыт в дерево компонента. *Отличие:* `Get("inst/child")` без `resolveInstances` у нас отдаёт итоговую ноду с переопределениями, pen.dev — только форму переопределения.
- **Visitor'ы.** Дети инстансов обходятся только с `resolveInstances`, `node.id` у них — путь. `ctx.bounds` есть и у скрытых нод (`enabled: false`): собственный размер в точке `0, 0`, как в pen.dev.
- **`FindEmptySpace`.** По умолчанию `direction: "right"`, `padding: 100`. Без `nodeId` место ищется рядом со всем содержимым холста, с `nodeId` — рядом с этой нодой. Координаты холста.
- **`Export`.** `pdf` пока недоступен (OpenPencil строит его через DOM браузера). Без расширения в `outPath` оно добавляется по формату.
- **Ещё замечено у pen.dev:** при вставке текста он дописывает в файл `fontFamily: "Inter"`, `fontSize: 14`, `fontWeight: "normal"`. Мы этого не делаем: у нас те же значения действуют по умолчанию.

## 3. Каталог предупреждений (фаза 1)

| Код | Когда срабатывает |
|---|---|
| `clipped` | Рассчитанные границы ноды выходят за обрезающего предка |
| `invisible-text` | У текстовой ноды нет `fill` |
| `zero-size` | Фрейм схлопнулся до нулевой ширины или высоты |
| `circular-size` | У родителя `fit_content`, а все дети по этой оси — `fill_container` |
| `ignored-xy` | `x` / `y` заданы у потомка flex-родителя |
| `unknown-font` | Семейство шрифта не найдено, используется запасное |
| `id-ignored` | Во входных данных указан `id` |
| `unsupported-render` | Нода или заливка пока не рендерится (shader, script, browser); в файле сохраняется |

Кроме кодов каталога ответ может содержать предупреждения валидатора и проекции (`unknown-variable`, `unknown-ref`, `unknown-property`, `missing-asset`, `unknown-icon`) и служебные (`global-not-saved`, `save-failed`, `export-failed`, `empty-screenshot`). Все проверки идут только по нодам, которые вызов создал или изменил. Полностью показываются первые 20 предупреждений, остальные считаются.

## 4. Формат архетипа для `get_style`

```jsonc
{
  "name": "Quiet Editorial",
  "summary": "Serif display + grotesk body, generous whitespace, one accent",
  "params": { "accent": ["terracotta", "ink-blue", "olive"] },   // optional
  "fonts": { "display": "Fraunces", "body": "Inter" },
  "palette": { "bg": "#F7F4EE", "text": "#1B1A17", "muted": "#6B675F", "accent": "$param.accent" },
  "scale": { "type": [14, 16, 20, 28, 40, 64], "space": [4, 8, 12, 16, 24, 40, 64, 96], "radius": [0, 4, 8] },
  "imagery": "Warm natural-light photography; no 3D renders",
  "rules": ["Left-aligned headlines", "No drop shadows", "Max 2 font weights per screen"],
  "variables": { /* ready-to-pass SetVariables payload */ }
}
```

Архетипы — собственные, придуманы для Tusche и лежат в `@tusche/styles` в виде JSON. Вклад приветствуется.

## 5. Совместимость с pen.dev

| Область | Tusche, фаза 1 |
|---|---|
| Основной словарь `execute` | Те же имена и семантика |
| `Generate` (AI / стоки / SVG / удаление фона) | Нет. Скилл говорит агенту пользоваться своими инструментами, сохранять файлы рядом с `.pen` и применять их как image-заливки |
| Инструмент `browser` | Нет (фаза 2) |
| `spawn_agents` / параллельные агенты | Нет (фаза 3, через суб-агентов CLI пользователя) |
| Дополнительно | `render`, `open_document`, `save_document`, `lint`, экспорт в `svg` |
