# Эвалы скилла

Бенчмарк скилла Tusche (этап 1.6, [ADR-010](../docs/dev/adr/010-skill-evals.md)). Любое изменение скилла, архетипов или ответов MCP прогоняется здесь: изменение принимается, только если автоматические метрики не ухудшились относительно [baseline](baseline/summary.md).

## Задачи

`tasks/*.json` — 15 задач: 10 экранов (веб, мобильные, лендинги, слайды, дизайн-система) и 5 правок реального файла `fixtures/pen/eval/design.pen`. Промпты написаны так, как их написал бы пользователь: по-английски, у двух задач — по-русски (проверка кириллицы).

```jsonc
{
  "id": "edit-key-label",           // = имя файла
  "kind": "edit",                    // screen | edit
  "file": "design/eval.pen",         // с каким .pen работает агент (от его рабочей папки)
  "fixture": "fixtures/pen/eval/design.pen",  // правки: что скопировать в file
  "scope": ["JbAx9"],                // правки: какие верхние ноды можно менять; "variables" — переменные
  "prompt": "…",
  "maxTurns": 80                     // необязательно
}
```

## Запуск

```sh
bun evals/src/run.ts                                   # все задачи, метка = дата и время
bun evals/src/run.ts --tasks screen-pricing,edit-key-label --label try-1
bun evals/src/run.ts --model claude-sonnet-5-5 --effort high
bun evals/src/run.ts --rescore --label try-1           # пересчитать оценки без агента
```

Каждая задача — отдельная сессия `claude -p` (тратит квоту Claude) во временной папке вне репозитория:

- только MCP-сервер `tusche` из этого репозитория (`--strict-mcp-config`), без встроенных инструментов (`--tools ""`) и без пользовательских настроек и CLAUDE.md;
- сервер пишет журнал вызовов (`TUSCHE_CALL_LOG`), CLI — транскрипт в stream-json;
- по умолчанию 80 ходов и 30 минут на задачу.

Результаты — в `evals/runs/<метка>/` (в `.gitignore`): по папке на задачу (`task.json`, `work/`, `calls.jsonl`, `transcript.jsonl`, `stderr.txt`, `score.json`, `renders/`), плюс `metrics.json` и `summary.md` на всю метку.

### Ручной режим

Файл, собранный руками или субагентом через живой MCP `tusche`, оценивается так же, только без метрик сессии и журнала:

```sh
bun evals/src/score.ts --task screen-pricing --pen path/to/app.pen [--out evals/runs/manual/screen-pricing]
```

Если рядом положить `calls.jsonl` (сервер, запущенный с `TUSCHE_CALL_LOG`) и `transcript.jsonl`, `bun evals/src/score.ts <папка>` посчитает и их.

## Метрики

| Группа | Метрика | Откуда |
|---|---|---|
| Файл | замечания `lint` (error / warning), которых не было в исходном файле; из них layout (`clipped`, `zero-size`, `ignored-xy`, `invisible-text`, `circular-size`) и шрифты (`missing-glyphs`, `unknown-font`); оставшиеся `placeholder: true` | итоговый `.pen` |
| Вызовы | `execute`, неудачные, исправления через `editId`, `undo`, прочитанные файлы скилла, запрошенные стили | `calls.jsonl` |
| Сессия | токены (вход, выход, кэш), ходы, стоимость, длительность, модель, ошибка сессии | `transcript.jsonl` |
| Правки | изменённые строки относительно исходника (после миграции, как его записал бы Tusche); верхние ноды и переменные, изменённые вне `scope` | итоговый `.pen` |

## Сравнение с baseline

```sh
bun evals/src/compare.ts evals/baseline/metrics.json evals/runs/<метка>/metrics.json
```

Код выхода 1, если сумма по набору выросла: файлы не созданы, ошибки сессий, замечания lint, layout, шрифты, placeholder'ы, неудачные `execute`, правки вне `scope` — строго; строки диффа и токены — больше чем на 15 %. Наборы задач должны совпадать.

Новый baseline записывается, когда меняется версия скилла и изменение принято: скопировать `metrics.json` и `summary.md` прогона в `baseline/`.

## Слепая оценка

```sh
bun evals/src/sheet.ts evals/runs/<метка> [ещё метки…]
```

Собирает рендеры экранных задач под случайными кодами в `evals/runs/<метка>/review/`: `index.html` (только картинки), `ratings.csv` (оценка вкуса 1–5 от двух ревьюеров) и `key.json` (код → задача; не открывать до оценки). Несколько меток в одном листе — сравнение версий вслепую.
