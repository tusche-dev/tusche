# Справочник CLI

[English](../en/cli.md) · **Русский**

> **Статус: описание будущей фазы 1.** До первого релиза команды могут измениться.

Установка глобально: `npm i -g @tusche/cli` (или `bun add -g @tusche/cli`). Можно и без установки: `npx @tusche/cli <команда>`.

| Команда | Что делает |
|---|---|
| `tusche mcp` | Запускает MCP-сервер на stdio. Именно эту команду запускает ваш агент. |
| `tusche preview <file.pen>` | Открывает в браузере живой просмотр, который обновляется при каждом изменении. |
| `tusche render <file.pen> [--node <id>…] [--scale 2] [--out dir/]` | Рендерит в PNG фреймы верхнего уровня или указанные ноды. |
| `tusche export <file.pen> --format png\|jpeg\|webp\|pdf\|svg [--node <id>…] --out <path>` | Экспортирует ноды в картинки или PDF. |
| `tusche exec <file.pen> <script.js>` | Выполняет `execute`-сниппет над файлом без агента. Удобно для правок скриптом. |
| `tusche lint <file.pen>` | Ищет проблемы вёрстки и дизайна: обрезанный контент, невидимый текст, неизвестные шрифты и другие. При ошибках код выхода 1. |
| `tusche validate <file.pen>` | Проверяет файл по схеме `.pen`. |
| `tusche migrate <file.pen>` | Обновляет старый файл `.pen` до текущей версии формата. |

## Переменные окружения

| Переменная | Значение |
|---|---|
| `TUSCHE_ROOT` | Дополнительная папка, куда разрешено писать `Export`. По умолчанию запись идёт только рядом с файлом `.pen`. |
| `TUSCHE_ALLOW_REMOTE_ASSETS=1` | Разрешает картинки по ссылкам `http(s)` в заливках |
| `TUSCHE_FONTS_OFFLINE=1` | Не скачивать шрифты, брать только кэшированные и системные |

## Пример: проверка дизайна в CI

```yaml
# .github/workflows/design.yml
- run: npx @tusche/cli lint design/app.pen
- run: npx @tusche/cli render design/app.pen --out design/shots
```
