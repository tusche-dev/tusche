# Contributing to Tusche

**English** · [Русский](CONTRIBUTING.ru.md)

Thanks for your interest! Tusche is in **phase 0 (specification)**. The most valuable contributions right now are:

1. **Review the specs** in [`docs/en`](docs/en) and open issues on gaps or mistakes.
2. **Share `.pen` test files** that you have the right to share. They become golden files for the round-trip and render tests.
3. **Upstream fixes to OpenPencil** that we depend on (see [02-research](docs/en/02-research.md#5-risks-found)).

## Ground rules

- **Clean room.** Implement `.pen` support only from public documentation (<https://docs.pencil.dev/for-developers/the-pen-format>) and from observing files. Do not copy code, binaries, skill texts, images or other assets from pen.dev, and do not decompile pen.dev.
- **Bilingual docs.** Every document in `docs/en` has a mirror in `docs/ru` with the same file name. Update both in the same PR, or open a follow-up issue labelled `translation`.
- **Decisions go to ADRs.** Anything that changes architecture, format or public API gets an ADR in `docs/adr/en` + `docs/adr/ru`.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:` …).

## Development (from phase 1)

```bash
bun install
bun run check   # typecheck + lint + tests
```

Requirements: Bun ≥ 1.3 (Node ≥ 22 supported for running published packages).
