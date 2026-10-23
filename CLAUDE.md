# CLAUDE.md — Tusche

Инструкции для ИИ-агентов, работающих с этим репозиторием.

## Что это

Tusche — открытый дизайн-холст для ИИ-агентов. Формат `.pen` — родной, движок — OpenPencil, сверху — API `execute` в духе pen.dev. Начни с [docs/dev/README.md](docs/dev/README.md), затем прочитай [04-architecture](docs/dev/04-architecture.md) и [06-agent-api](docs/dev/06-agent-api.md).

**Текущая фаза — 1 (MCP-компаньон).** Пакеты лежат в `packages/`. Готовы `@tusche/pen-format`, `@tusche/pen-bridge` (проекция в scene graph), `@tusche/engine` (раскладка, границы, PNG, экспорт) `@tusche/exec` (движок `execute`: песочница QuickJS, API, транзакции, edits, предупреждения, undo, отложенная запись, `lintDocument`; таблица покрытия — в `packages/exec/README.md`), `@tusche/mcp` (MCP-сервер на stdio, ADR-009), `@tusche/preview` (живой предпросмотр: сервер следит за файлом, страница рисует разложенную движком сцену через WebGL из `@tusche/engine/preview`, ADR-011), `@tusche/cli` (`bun packages/cli/src/index.ts mcp|exec|render|export|lint|validate|migrate|preview`), `@tusche/skill` (скилл 0.1.1: `SKILL.md`, формат, `execute`, семь гайдов `guide/*.md`) и `@tusche/styles` (8 архетипов; покрытие кириллицы — `bun packages/styles/scripts/check-fonts.ts`). Эвалы скилла — `evals/` (ADR-010): `bun evals/src/run.ts` гоняет `claude -p` (тратит квоту), `bun evals/src/compare.ts evals/baseline/metrics.json <прогон>` — правило приёмки; любое изменение скилла или архетипов проверяется ими. Проверка — `bun run check` (типы, Biome, `bun test`). Эталонные рендеры — `bun packages/engine/scripts/render-baseline.ts <файлы>`, замеры `execute` — `bun packages/exec/scripts/bench-execute.ts <файлы>`. `@open-pencil/core` пропатчен (`patches/`, список — в [02-research](docs/dev/02-research.md)). Релиз в npm (ADR-012): `bun run release:build` собирает пакеты и форки OpenPencil с патчами в `.release/packages`, `bun run release:smoke` ставит их в чистую папку и гоняет под Node и Bun, а публикует `.github/workflows/release.yml` по тегу `v*`. В репозитории пакеты остаются на `src` и `private`.

## Языки документации

- `docs/dev/` — документация для разработки: **только русский**. ADR лежат в `docs/dev/adr/`.
- `docs/guide/en/` и `docs/guide/ru/` — пользовательская документация, **на двух языках**, имена файлов совпадают. Меняешь одну версию — в том же коммите меняй вторую. Первая строка под заголовком — ссылка на версию на другом языке.
- `README.md` (EN) и `README.ru.md` (RU) держи синхронными. С `CONTRIBUTING.md` и `CONTRIBUTING.ru.md` так же.
- Всё, что читает агент, — **на английском**: скилл (`packages/skill/content/`), архетипы (`packages/styles/archetypes/`), описания и ответы инструментов MCP, вывод CLI, инструкция по установке для агентов `docs/agent-setup.md` (на неё ссылаются промпт и комментарий в начале README — меняешь команды подключения, меняй её).

## Правила

- **«Чистая комната».** Не копируй тексты, код и ассеты pen.dev, в том числе файлы установленного приложения. `.pen` реализуется по публичной схеме (https://docs.pencil.dev/for-developers/the-pen-format) и [docs/dev/05-pen-format.md](docs/dev/05-pen-format.md).
- **Изменения архитектуры — через ADR:** `docs/dev/adr/NNN-название.md`, разделы «Статус», «Контекст», «Решение», «Последствия».
- **`@open-pencil/core` импортирует только `@tusche/engine`.** Остальные пакеты работают через него, чтобы изменения API OpenPencil не расползались по коду.
- **Источник истины — дерево `.pen`.** Scene graph OpenPencil — производная проекция (ADR-002).
- **Стек:** Bun workspaces, TypeScript (strict, ESM), Valibot, QuickJS (WASM), Tauri v2 в фазе 2. См. ADR-005.
- **Коммиты:** Conventional Commits.

## Карта

```
docs/dev/            01-vision … 08-roadmap, adr/                    (RU)
docs/guide/en|ru/    getting-started, cli, faq                       (EN + RU)
packages/            pen-format, pen-bridge, engine, exec, mcp, skill, styles, preview, cli
evals/               задачи, раннер claude -p, оценка, baseline (ADR-010)
apps/                (фаза 2) desktop
```
