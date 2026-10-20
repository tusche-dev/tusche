# ADR-001 · Build on OpenPencil's packages (no fork, no own engine)

**English** · [Русский](../ru/001-build-on-openpencil.md)

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

A design canvas needs a renderer (vector paths, text shaping, effects, images), a layout engine (flex, hug/fill sizing), a scene graph with components and variables, hit testing, export, and an editor UI. Writing that from scratch means many months before the agent experience — the actual differentiator — can even start.

Options considered:

1. **Own engine from scratch** (e.g. Rust + vello + taffy, or TS + CanvasKit). Full control; huge effort.
2. **Fork OpenPencil.** Full freedom over its UI and code; we would carry merge cost forever against a fast-moving upstream (~3,000 commits in 8 months).
3. **Depend on OpenPencil's published npm packages** and build our own layer on top.
4. **Build on ZSeven-W/openpencil** (Rust core). It has its own `.op` format and imports `.pen` kits only. Adopting it means adopting its format and architecture.

Evidence (see [02-research](../../en/02-research.md)): `@open-pencil/core` works headless on Windows (one path bug, fixable); it renders real `.pen` designs with good fidelity; it exposes editor, layout, raster, lint and tools as subpath exports; MIT licence; the Vue SDK exists for a later desktop app.

## Decision

Option 3. Tusche depends on pinned versions of `@open-pencil/*` packages. **Only `@tusche/engine` imports `@open-pencil/core`**; `@tusche/pen-bridge` imports `@open-pencil/scene-graph`. Everything else talks to our own interfaces.

Fixes we need in OpenPencil go **upstream as PRs first**; we carry local patches (`bun patch`) only until they are merged.

## Consequences

- ➕ Weeks instead of months to an MVP; a Figma-grade renderer and layout for free; `.fig` import and many exports for free.
- ➕ Improvements flow both ways; goodwill with upstream.
- ➖ Dependence on a 0.x API with a bus factor of about 1. Mitigation: exact version pins, the adapter boundary, contract tests at the boundary, and the option to vendor a package if upstream stalls (MIT allows it).
- ➖ Rendering parity with pen.dev is not guaranteed; we accept "faithful", not "identical".
- A fork stays possible later if upstream direction diverges; the adapter boundary keeps that cost contained.
