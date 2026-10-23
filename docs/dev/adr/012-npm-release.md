# ADR-012 · Публикация в npm: сборка в `.release/`, Node ≥ 22, перепубликованные патчи OpenPencil

- **Статус:** Принято
- **Дата:** 2026-10-23
- **Уточняет:** [ADR-001](001-build-on-openpencil.md) (патчи upstream), [ADR-005](005-stack-bun-tauri-rust.md) (рантайм), [ADR-011](011-preview.md) §5 (сборка страницы)

## Контекст

Этап 1.9 — первый релиз `@tusche/*` 0.1.0. Документация обещает `npx -y @tusche/cli mcp` и «Bun ≥ 1.3 или Node.js ≥ 22». На момент релиза так не работает:

1. **Пакеты отдают исходники TypeScript.** `exports` и `bin` указывают на `./src/*.ts`. Bun их запускает, а Node внутри `node_modules` снятие типов не делает.
2. **Код завязан на API Bun.** `Bun.stdin` и `import.meta.main` в CLI. `import.meta.dir`, `Bun.build` (страница собирается при старте), `Bun.serve` с WebSocket и `Bun.file` в `@tusche/preview`.
3. **Патчи OpenPencil до пользователя не доходят.** `patchedDependencies` действуют только в нашем репозитории. Без патчей `@open-pencil/core@0.16.0` на Windows не находит `canvaskit.wasm`, раскладка `.pen` расходится с pen.dev (метки `tusche/cssGap`, `tusche/equalFill`, ширина переноса), а `io/formats/html` не экспортируется. Без патча `@open-pencil/dom-css` под Bun не загружается. PR в upstream открыты (этап 1.8), но OpenPencil новее 0.16.0 не вышел.

Бандл `@open-pencil/core` внутрь `@tusche/engine` решил бы третью проблему, но core ищет файлы относительно себя: `import.meta.resolve('canvaskit-wasm')`, шрифты в `assets/` через `@open-pencil/core/package.json`, воркеры через `new URL(…, import.meta.url)`. Каждое такое место пришлось бы переписывать при сборке и перепроверять с каждой версией OpenPencil.

## Решение

1. **Рантайм — Node ≥ 22 и Bun ≥ 1.3.** Код пакетов использует только `node:*` и переносимые API. CLI запускается через отдельный вход `src/bin.ts` вместо `import.meta.main`. Preview работает на `node:http` и `ws`. Страница preview собирается заранее, а `Bun.build` при старте остаётся только для запуска из исходников в репозитории.
2. **Репозиторий остаётся на исходниках.** В `package.json` пакетов, как и раньше, `src`, `workspace:*` и `private: true`: разработка, тесты и эвалы идут без сборки. Публикуемый вид готовит `scripts/release/build.ts` в `.release/<пакет>/`:
   - `src` компилируется в `dist` (`.js` + `.d.ts`) через `tsconfig.build.json` с `rewriteRelativeImportExtensions`;
   - `package.json` переписывается: `exports` и `bin` указывают на `dist`, `workspace:*` заменяется версией релиза, `private` и `devDependencies` убираются, добавляется `engines.node`;
   - рядом кладутся данные пакетов (`content/` скилла, `archetypes/` стилей) так же, как в репозитории, поэтому пути от `import.meta.url` не меняются.
   Публикация идёт только из `.release/`, так что случайный `npm publish` из репозитория невозможен: там `private: true`.
3. **Патчи OpenPencil перепубликуются как отдельные пакеты.** Пропатченные `@open-pencil/core` и `@open-pencil/dom-css` (MIT) публикуются как `@tusche/open-pencil-core` и `@tusche/open-pencil-dom-css` с версией `<upstream>-tusche.<n>`, например `0.16.0-tusche.1`. Содержимое — опубликованный тарбол upstream с нашими патчами, исходная лицензия и пометка в README. Опубликованный `@tusche/engine` подключает их npm-алиасом (`"@open-pencil/core": "npm:@tusche/open-pencil-core@…"`), а форк core так же получает `@open-pencil/dom-css`. Раскладка файлов пакета не меняется, поэтому `import.meta.resolve`, шрифты и воркеры работают без правок. Это не форк кода в смысле ADR-001: своей ветки разработки OpenPencil нет, только опубликованная копия с патчами из `patches/`. Как только патчи выйдут в релизе OpenPencil, форки снимаем.
4. **Версии.** Все `@tusche/*` выходят с одной версией (0.1.0), зависимости между ними точные.
5. **Публикация — GitHub Actions по тегу `v*`** (`release.yml`): `bun run check`, сборка, smoke-тест установленных тарболов под Node и Bun на Linux и Windows, затем `npm publish --provenance` в порядке зависимостей, сначала форки. Основная авторизация — trusted publishing (OIDC). Для первой публикации нужен токен `NPM_TOKEN`: trusted publisher настраивается только для уже существующего пакета.

## Последствия

- ➕ `npx -y @tusche/cli mcp` работает без Bun, а пользователь получает ту же раскладку и те же патчи, что и тесты.
- ➕ Разработка не меняется: сборки в цикле правка → тест нет.
- ➕ Smoke-тест проверяет именно опубликованный вид пакетов, включая алиасы и пути к данным.
- ➖ Два лишних пакета в scope `@tusche`, и их нужно перепубликовывать при смене патчей или версии OpenPencil.
- ➖ Пакеты в репозитории и в npm выглядят по-разному. Ошибки переписывания `package.json` ловит только smoke-тест, поэтому он гоняется и в `check.yml`.
- ➖ Preview получил зависимость `ws`.
