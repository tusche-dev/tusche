# Tusche

[English](README.md) · **Русский**

<p>
  <a href="https://www.npmjs.com/package/@tusche/cli"><img alt="npm version" src="https://shieldcn.dev/npm/v/@tusche/cli.svg?variant=secondary"></a>
  <a href="https://github.com/tusche-dev/tusche/actions/workflows/check.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/tusche-dev/tusche.svg?workflow=check.yml&branch=main&variant=secondary"></a>
  <a href="LICENSE"><img alt="Лицензия" src="https://shieldcn.dev/github/license/tusche-dev/tusche.svg?variant=secondary"></a>
  <img alt="Node.js 22 и новее" src="https://shieldcn.dev/badge/node-%E2%89%A522-339933.svg?variant=secondary&logo=nodedotjs">
  <a href="https://modelcontextprotocol.io"><img alt="MCP server" src="https://shieldcn.dev/badge/MCP-server-000000.svg?variant=secondary&logo=modelcontextprotocol"></a>
</p>

> *Tusche* по-немецки — тушь.

**Tusche — бесплатный дизайн-холст с открытым кодом для ИИ-агентов.** Ваш агент (Claude Code, Codex или любой MCP-клиент) рисует экраны приложений, дашборды, лендинги и слайды на бесконечном холсте и проверяет себя по скриншотам. Всё сохраняется в обычный JSON-файл рядом с кодом. Работает на *вашей* подписке агента — без аккаунта и без лимитов.

- **Свой агент.** Один раз подключаете по MCP — Tusche ничего не считает и не ограничивает.
- **Открывает файлы pen.dev.** `.pen` — родной формат, файлы остаются совместимыми.
- **Движок [OpenPencil](https://github.com/open-pencil/open-pencil):** рендер на Skia, flex-раскладка, компоненты, переменные и темы.
- **Удобно для git:** канонический JSON, маленькие диффы, линтер и рендер в CI.

## Быстрый старт

Нужен Node.js ≥ 22 или Bun ≥ 1.3. Подключите Tusche к Claude Code:

```bash
claude mcp add tusche -- npx -y @tusche/cli mcp
```

Затем в своём проекте попросите: *«Сделай экран онбординга в `design/app.pen`»*. Чтобы видеть, как работает агент, откройте живой просмотр в другом терминале:

```bash
npx @tusche/cli preview design/app.pen --open
```

Другие MCP-клиенты (Codex, Gemini CLI, OpenCode…) подключаются той же командой — см. [Быстрый старт](docs/guide/ru/getting-started.md).

## Статус

**0.1.0, первый релиз.** Фаза 1 готова: MCP-сервер, CLI, живой просмотр и скилл агента. Дальше — фаза 2, десктопное приложение, в котором дизайн агента можно поправить руками. Подробнее — в [roadmap](docs/dev/08-roadmap.md) и [списке изменений](CHANGELOG.md) (на английском).

## Руководство пользователя

- [Быстрый старт](docs/guide/ru/getting-started.md)
- [Справочник CLI](docs/guide/ru/cli.md)
- [Частые вопросы](docs/guide/ru/faq.md)

## Для разработчиков

Документация для разработки — видение, архитектура, спецификация `.pen`, API агента, ADR — ведётся **на русском** в [`docs/dev`](docs/dev/). Как участвовать — в [CONTRIBUTING](CONTRIBUTING.ru.md).

## Лицензия

[MIT](LICENSE). Сторонние компоненты и товарные знаки перечислены в [NOTICE](NOTICE). Tusche не связан с High Agency (pen.dev), OpenPencil и Figma.
