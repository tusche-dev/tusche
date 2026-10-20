# 04 · Архитектура

## Общая схема

```
 ┌───────────────────────────┐        stdio (MCP)        ┌───────────────────────────────────────┐
 │ Claude Code / Codex / any │ ────────────────────────▶ │ @tusche/mcp                           │
 │ MCP client (user's own    │ ◀──────────────────────── │  get_app_state · read_skill ·         │
 │ subscription)             │   text + PNG screenshots   │  get_style · execute · open/save      │
 └───────────────────────────┘                           └──────────────┬────────────────────────┘
                                                                         │
                                         ┌───────────────────────────────▼──────────────────────────┐
                                         │ @tusche/exec — execute engine                            │
                                         │  QuickJS (WASM) sandbox ⇄ host API (Insert/Get/…)         │
                                         │  transaction = snapshot → run → commit | rollback         │
                                         └───────────────┬──────────────────────────┬───────────────┘
                                                         │ edits                    │ layout / render
                                         ┌───────────────▼──────────────┐ ┌─────────▼────────────────────┐
                                         │ @tusche/pen-format           │ │ @tusche/pen-bridge            │
                                         │  PenDocument (source of truth)│→│  PenDocument → SceneGraph     │
                                         │  schema, validate, migrate,  │ │  (incremental, by node id)    │
                                         │  canonical serialize         │ └─────────┬────────────────────┘
                                         └───────────────┬──────────────┘           │
                                                         │ read / write             │
                                                   ┌─────▼─────┐        ┌───────────▼─────────────────────┐
                                                   │ file.pen  │        │ @open-pencil/core               │
                                                   │ (JSON)    │        │  layout (Yoga) · render (Skia)  │
                                                   └───────────┘        │  export · lint · analyze        │
                                                                        └─────────────────────────────────┘
```

## Пакеты

Монорепозиторий на Bun workspaces. Все пакеты на TypeScript, ESM.

| Пакет | За что отвечает | Зависит от |
|---|---|---|
| `@tusche/pen-format` | Типы `.pen` и схема на Valibot (2.21); валидация с понятными ошибками; миграции со старых 2.x; каноничный сериализатор; генератор id; разрешение путей (`instance/child`) | — |
| `@tusche/pen-bridge` | Проецирует `PenDocument` в `SceneGraph` из `@open-pencil/scene-graph`: типы нод, заливки, обводки, эффекты, раскладка, текст, переменные и темы, компоненты и инстансы. Обновляет инкрементально, по изменённым id. В фазе 2 — обратная проекция ручных правок | pen-format, `@open-pencil/scene-graph` |
| `@tusche/engine` | Тонкий адаптер над `@open-pencil/core`: раскладка, чтение рассчитанных границ, рендер PNG, экспорт SVG / PDF, линт и анализ. Единственный пакет, который импортирует `@open-pencil/core` | pen-bridge, `@open-pencil/core` |
| `@tusche/exec` | Движок `execute`: песочница QuickJS, привязка API хоста, транзакции, хранилище `edits` / `editId`, карта имён, предупреждения, сохранение глобальных переменных | pen-format, engine |
| `@tusche/mcp` | MCP-сервер (stdio; позже HTTP): определения инструментов, сессии документов, слежение за файлами | exec, skill, styles |
| `@tusche/skill` | Скилл агента: `SKILL.md` и гайды (Markdown, на английском) | — |
| `@tusche/styles` | Стилевые архетипы как данные: шрифты, палитра, отступы, подсказки по изображениям, параметры | — |
| `@tusche/cli` | `tusche mcp | exec | render | lint | export | validate | migrate` | все |
| `apps/preview` (фаза 1) | Минимальная локальная веб-страница: рендерит текущий документ и обновляется при изменениях | engine |
| `apps/desktop` (фаза 2) | Tauri v2 + Vue 3 + `@open-pencil/vue` | все |

## Ключевое решение: источник правды — дерево `.pen`

`SceneGraph` в OpenPencil устроен как в Figma, а у `.pen` своя модель: `fit_content` / `fill_container`, `ref` + `descendants`, переменные по темам, ноды `note` / `prompt` / `script` / `browser`, заливки-шейдеры. Сделать круговую конвертацию `.pen` → `SceneGraph` → `.pen` без потерь сложно, и она ломалась бы при каждом изменении любой из сторон.

Поэтому:

1. **Документ — это `PenDocument`, обычное JSON-дерево.** Все правки агента применяются к нему. Сохранить файл — значит сериализовать это дерево.
2. **`SceneGraph` — производная одноразовая проекция.** Она нужна для раскладки, hit testing, рендера и экспорта. После транзакции `pen-bridge` перестраивает только поддеревья с изменёнными id.
3. **Каждая нода сцены хранит свой pen id.** Поэтому границы и проблемы, посчитанные на scene graph, напрямую сопоставляются с pen id; для развёрнутых ref — через путь внутри инстанса.
4. **Неподдержанные возможности `.pen`** (заливка-шейдер, `script`, `browser` и т. п.) всё равно проецируются во что-то видимое: заглушку-заливку или пустой фрейм нужного размера. В `PenDocument` они остаются нетронутыми.
5. **Ручные правки в фазе 2.** Десктопный редактор меняет scene graph. Обратный маппер превращает набор изменений («свойство X ноды Y») в операции `Update` над `PenDocument`, а затем, как обычно, срабатывает прямая проекция. Редактировать можно только свойства, у которых есть аналог в `.pen`; остальные в инспекторе только для чтения.

См. [ADR-002](adr/002-pen-native-format.md).

## Конвейер execute

```
execute(input | editId+edits, filePath)
  │
  ├─ resolve snippet (apply find/replace edits to the stored failed snippet)
  ├─ session = documents.get(filePath)          // open + migrate on first use
  ├─ tx = session.begin()                        // structural-sharing snapshot of PenDocument
  ├─ vm = quickjs.newContext(globals = session.globals)
  │     host fns: Insert Copy Update Replace Move Delete SetVariables GetVariables
  │               Get FindEmptySpace Print TakeScreenshot Export
  ├─ run snippet (time limit 10 s, memory limit 256 MB, interrupt handler)
  │     • mutations go to tx (validated per op; invalid → throw)
  │     • Get / FindEmptySpace / TakeScreenshot flush pending ops to pen-bridge and run layout
  ├─ on throw → tx.rollback(); store snippet under new editId; return error + line + hint
  └─ on success → tx.commit(); persist globals; save file (atomic; MCP delays it 300 ms, ADR-009);
                  return Print lines + names→ids map + warnings + screenshots
```

- **Снапшоты** используют структурное разделение (иммутабельные обновления), поэтому откат стоит O(1). Каждая операция ещё и атомарна сама по себе: если сниппет поймал её ошибку через `try/catch`, отменяется только она.
- Модель выполнения (asyncify-сборка QuickJS, контекст на вызов, синхронизация сцены посреди вызова) — [ADR-008](adr/008-execute-runtime.md).
- **Валидация** проходит на каждой операции: по схеме Valibot и по смысловым правилам («`padding` только у фреймов», «текст с `width` требует `textGrowth`»). Нарушения, которые pen.dev считает ошибками, у нас тоже ошибки. Стилистические недочёты — предупреждения.
- **Предупреждения** собирает проход после коммита:
  - дочерние элементы обрезаны;
  - фрейм нулевого размера;
  - текст без `fill`;
  - `fill_container` внутри родителя с `fit_content` (циклическая зависимость);
  - неизвестный шрифт.

## Сессии, файлы и конкурентный доступ

- На каждый абсолютный путь к файлу — одна `DocumentSession`. В ней `PenDocument`, производный scene graph, глобальные переменные, хранилище упавших сниппетов и стек undo.
- **Слежение за файлом** — по запросу, по хэшу содержимого. Перед каждым инструментом MCP сравнивает файл на диске с тем, что сессия последней прочитала или записала. Если файл изменился и несохранённых правок нет, документ перечитывается. Если несохранённые правки есть, это конфликт: о нём сообщают `get_app_state` и `execute`. Подробности — в [ADR-009](adr/009-mcp-sessions.md).
- **Запись атомарная:** сначала временный файл, затем переименование. Каноничная сериализация держит git-диффы маленькими. В MCP запись отложена на 300 мс после коммита, CLI пишет сразу.
- **Undo:** каждая закоммиченная транзакция — один шаг отмены, глубина 50. Шаг откатывает и глобальные переменные. Агенту доступны инструменты `undo` и `redo`. В фазе 2 ручные правки попадают в тот же стек.

## Рендер и скриншоты

API `@tusche/engine` (этап 1.3):

```ts
const engine = await createEngine({ cacheDir?, allowNetwork? })   // тёплый CanvasKit на процесс
const scene = await engine.open(doc, { baseDir, allowRemoteAssets? })
await scene.layout(roots?)          // проекция и раскладка по корням, лениво
await scene.bounds('inst/child')    // {x, y, width, height} в пространстве родителя + absolute
await scene.render(paths, { scale: 1, maxSide: 1600 })  // PNG
await scene.export(paths, 'png' | 'jpeg' | 'webp' | 'svg' | 'html-tailwind', { scale })
await scene.update(doc, roots | 'all')  // новая версия документа, пересборка корней
scene.clippingSync(path)            // {state: 'partially clipped' | 'fully clipped', by}
scene.invalidate(rootId)            // корень пересоберётся из документа
engine.compare(pngA, pngB)          // pixelmatch через comparePNGs
```

API `@tusche/exec` (этап 1.4):

```ts
const exec = createExecutor({ engine?, limits?, root? })   // root — то же, что TUSCHE_ROOT
const session = await exec.open(filePath, { create? })      // одна сессия на файл
const result = await session.execute({ input } | { editId, edits })
const { text, images } = formatResult(result)               // ответ как в 06-agent-api
```

- Рендер — `renderNodesToImage` из `@open-pencil/core/io/formats/raster` с **«тёплым» экземпляром CanvasKit и SkiaRenderer** на процесс. Каждая нода верхнего уровня лежит на своей странице графа, поэтому раскладка и рендер одного корня не трогают остальные.
- Шрифты загружаются один раз и кэшируются на диске (`$TUSCHE_CACHE_DIR` или `~/.cache/tusche`). Веб-шрифты Google Fonts через `unifont` приходят подмножествами под символы. Поэтому сразу запрашиваются все символы документа, а кэш хранит несколько подмножеств на начертание.
- Скриншоты возвращаются как MCP-контент `image`: PNG, по умолчанию scale 1, длинная сторона не больше 1600 px для экономии токенов.
- Иконки — векторы из данных Iconify. lucide и phosphor берутся из офлайн-пакетов `@iconify-json/*`, остальные библиотеки (`feather`, `Material Symbols *`) — из Iconify API с кэшем на диске.
- Там, где раскладка OpenPencil расходится с pen.dev, разницу закрывают метки в `pluginData` и патчи `@open-pencil/core` (см. [02-research](02-research.md), раздел об этапе 1.3).

## Живой предпросмотр (фаза 1)

`tusche preview file.pen` поднимает страницу с холстом `@open-pencil/core` в браузере (WebGL). По WebSocket страница подписывается на события изменения документа от MCP-процесса. Предпросмотр только для чтения: панорама, масштаб, выделение, чтобы узнать id. Так видно, что делает агент, ещё до появления десктопного приложения.

## Десктоп в фазе 2

- Оболочка Tauri v2 (Rust): нативные окна, диалоги файлов, ассоциация `.pen`, автообновление и **запуск CLI агента** дочерним процессом с настроенным MCP Tusche.
- Фронтенд: Vue 3 + `@open-pencil/vue` (`CanvasRoot`, `useCanvas`, панели) плюс наши панели инспектора для свойств, специфичных для `.pen`.
- MCP-сервер работает внутри процесса приложения: либо как Node-sidecar, либо в webview через локальный HTTP-эндпоинт MCP — решим в фазе 2. Внешние агенты подключаются к запущенному приложению так же, как сегодня к бинарнику pen.dev.

## Безопасность

- Песочница QuickJS: нет `fetch`, `require` и файловой системы — только функции хоста. Есть лимиты времени и памяти.
- `Export` пишет только в папку документа или в папку, разрешённую пользователем (`TUSCHE_ROOT`).
- URL изображений в заливках разрешаются относительно `.pen`-файла. Удалённые URL загружаются, только если включён `allowRemoteAssets`.

## Тестирование

- **Эталонные файлы:** примеры и `.pen`-файлы от пользователей → рендер → сравнение PNG через `pixelmatch` (OpenPencil экспортирует `comparePNGs`). Скрипт — `packages/engine/scripts/render-baseline.ts`. Эталоны фикстур лежат рядом с ними (`fixtures/pen/eval/baseline/`), рендеры приватных файлов — в `.tusche/renders/` (в `.gitignore`). Baseline проверяется сверкой с экспортом pen.dev.
- **Тесты круговой конвертации:** чтение → запись должны давать побайтно тот же файл для каноничных входных данных; неизвестные свойства сохраняются.
- **Контрактные тесты `execute`:** каждая функция API, каждый путь ошибки, откат и патч через edits.
- **Оценка агента (конец фазы 1):** фиксированный набор запросов прогоняется через Claude Code и оценивается по проблемам раскладки, замечаниям линта и расходу токенов.
