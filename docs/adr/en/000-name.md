# ADR-000 · Project name: Tusche (working title)

**English** · [Русский](../ru/000-name.md)

- **Status:** Accepted (working title; can be revisited before the first public release)
- **Date:** 2026-10-20

## Context

The project needs a name that:

- does not use "pen.dev", "Pencil" or "OpenPencil", to avoid trademark confusion and confusion with two existing projects named OpenPencil;
- is short, pronounceable in English and Russian, and works as a CLI command;
- has a free npm name, a free `.dev` domain and a possible GitHub organisation.

Availability checked on 2026-10-20 (npm registry, GitHub API, DNS NS records):

| Candidate | npm | GitHub user/org | `.dev` domain | Verdict |
|---|---|---|---|---|
| Nib | taken (`nib`) | taken | free | ✗ npm |
| Stylo | taken | taken | — | ✗ |
| Grafit | free | taken | taken (grafit.dev, grafit.app) | ✗ domains |
| Inkline | taken (UI framework) | taken | — | ✗ conflict |
| Vellum, Linework, Chalkline | taken | taken | taken | ✗ |
| Stilus | free | taken | free | possible |
| **Tusche** | **free** (`tusche`, `@tusche/*` unused) | `tusche` taken; **`tusche-dev` free** | **tusche.dev free** | ✓ |

## Decision

Use **Tusche**.

- *Tusche* is German for drawing ink. The Russian *тушь* comes from it, so the name has a natural meaning for Russian-speaking users and a craft feel in English.
- CLI: `tusche`. npm scope: `@tusche/*` (to be registered). GitHub org: `tusche-dev` (to be created). Domain: `tusche.dev` (to be registered).
- Pronunciation: "TOO-sheh" (EN) / «туше» (RU), which also echoes the fencing *touché*.

## Consequences

- Register the npm org, the GitHub org and the domain before announcing anything publicly; availability can change.
- If the name is replaced before release, only the README, NOTICE, CLAUDE.md and this ADR mention it prominently; package names do not exist yet.
