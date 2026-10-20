# CLAUDE.md — Tusche

Инструкции для ИИ-агентов, работающих с этим репозиторием.

## Что это

Tusche — открытый дизайн-холст для ИИ-агентов. Формат `.pen` — родной, движок — OpenPencil, сверху — API `execute` в духе pen.dev. Начни с [docs/dev/README.md](docs/dev/README.md), затем прочитай [04-architecture](docs/dev/04-architecture.md) и [06-agent-api](docs/dev/06-agent-api.md).

**Текущая фаза — 1 (MCP-компаньон).** Пакеты лежат в `packages/`. Готовы `@tusche/pen-format`, `@tusche/pen-bridge` (проекция в scene graph), `@tusche/engine` (раскладка, границы, PNG, экспорт) и `@tusche/exec` (движок `execute`: песочница QuickJS, API, транзакции, edits, предупреждения; таблица покрытия — в `packages/exec/README.md`), остальные пока заготовки. Проверка — `bun run check` (типы, Biome, `bun test`). Эталонные рендеры — `bun packages/engine/scripts/render-baseline.ts <файлы>`, замеры `execute` — `bun packages/exec/scripts/bench-execute.ts <файлы>`. `@open-pencil/core` пропатчен (`patches/`, список — в [02-research](docs/dev/02-research.md)).

## Языки документации

- `docs/dev/` — документация для разработки: **только русский**. ADR лежат в `docs/dev/adr/`.
- `docs/guide/en/` и `docs/guide/ru/` — пользовательская документация, **на двух языках**, имена файлов совпадают. Меняешь одну версию — в том же коммите меняй вторую. Первая строка под заголовком — ссылка на версию на другом языке.
- `README.md` (EN) и `README.ru.md` (RU) держи синхронными. С `CONTRIBUTING.md` и `CONTRIBUTING.ru.md` так же.
- Скилл агента (`docs/dev/drafts/SKILL.md`) — **на английском**.

## Правила

- **«Чистая комната».** Не копируй тексты, код и ассеты pen.dev, в том числе файлы установленного приложения. `.pen` реализуется по публичной схеме (https://docs.pencil.dev/for-developers/the-pen-format) и [docs/dev/05-pen-format.md](docs/dev/05-pen-format.md).
- **Изменения архитектуры — через ADR:** `docs/dev/adr/NNN-название.md`, разделы «Статус», «Контекст», «Решение», «Последствия».
- **`@open-pencil/core` импортирует только `@tusche/engine`.** Остальные пакеты работают через него, чтобы изменения API OpenPencil не расползались по коду.
- **Источник истины — дерево `.pen`.** Scene graph OpenPencil — производная проекция (ADR-002).
- **Стек:** Bun workspaces, TypeScript (strict, ESM), Valibot, QuickJS (WASM), Tauri v2 в фазе 2. См. ADR-005.
- **Коммиты:** Conventional Commits.

## Карта

```
docs/dev/            01-vision … 08-roadmap, adr/, drafts/SKILL.md   (RU)
docs/guide/en|ru/    getting-started, cli, faq                       (EN + RU)
packages/            pen-format, pen-bridge, engine, exec, mcp, skill, styles, cli
apps/                (фаза 1) preview, (фаза 2) desktop
```
