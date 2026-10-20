# Contributing to Tusche

**English** · [Русский](CONTRIBUTING.ru.md)

Thanks for your interest! Tusche is in **phase 1 (first usable version)**. Right now the most valuable contributions are:

1. **Share `.pen` test files** that you have the right to share. They become golden files for the round-trip and render tests.
2. **Fix upstream OpenPencil issues** that we depend on. See "Risks" in [docs/dev/02-research.md](docs/dev/02-research.md).
3. **Review the specs** and open issues.

## Languages

- **User docs** (README, `docs/guide/`) are kept in **English and Russian**. Every page in `docs/guide/en` has a mirror with the same name in `docs/guide/ru`.
- **Development docs** (`docs/dev/`: vision, architecture, specs, ADRs) are written in **Russian**. Issues and PRs in English are welcome; a machine translation of `docs/dev` works well enough to follow along.
- The agent skill (`docs/dev/drafts/SKILL.md`, later `packages/skill`) is written in **English**, because models follow English instructions most reliably.

## Ground rules

- **Clean room.** Implement `.pen` support only from the public documentation (<https://docs.pencil.dev/for-developers/the-pen-format>) and from observing files. Do not copy code, binaries, skill texts, images or other assets from pen.dev, and do not decompile it.
- **Decisions go to ADRs** in `docs/dev/adr/`.
- **Conventional commits:** `feat:`, `fix:`, `docs:`, `chore:` …

## Development

```bash
bun install
bun run check   # typecheck + lint + tests
```
