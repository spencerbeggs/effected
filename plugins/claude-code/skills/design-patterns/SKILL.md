---
name: design-patterns
description: Use when choosing or applying a proven architecture pattern for a project built on Effect v4 / the @effected kit — splitting a tool into cli + mcp + lsp packages, deciding how a monorepo ships its bins, making "install one package" true for a consumer, a Claude Code or Copilot plugin launching a project's own bins, or threading one version identity through several front ends. This skill indexes patterns as loadable references; consult it before inventing an architecture the kit's own consumers have already worked out.
when_to_use: carrier package, meta-package, one package to install, bins missing from node_modules/.bin, cli + mcp + lsp split, front end vs engine, keeping the package graph acyclic, plugin loader script, version threading, distribution, engine_version, manifest DAG test, packed-install e2e
---

# Design patterns

Proven architecture patterns for building on Effect v4 and the `@effected`
kit, distilled from real multi-package tools and indexed as loadable
references. This skill routes; depth lives in `references/`.

## Pattern index

| Pattern | Reach for it when | Reference |
| --- | --- | --- |
| Carrier package — core/engine/front ends → carrier | a tool ships more than one bin (CLI, MCP server, LSP server, …) and you want "install one package" to be true, or you're debugging why a consumer's `node_modules/.bin` is missing a bin that resolves fine as a dependency | [carrier-package.md](./references/carrier-package.md), [carrier-entry-contract.md](./references/carrier-entry-contract.md), [carrier-version-threading.md](./references/carrier-version-threading.md), [carrier-plugin-loader.md](./references/carrier-plugin-loader.md), [carrier-verification.md](./references/carrier-verification.md), [carrier-app-and-schemas.md](./references/carrier-app-and-schemas.md) (optional), [carrier-case-studies.md](./references/carrier-case-studies.md) |

More rows land here as more patterns are distilled. A pattern earns a row
once it has shipped in more than one real tool and the trade-offs are
settled, not on first use.

## Standards

- **Name the layer, not the file.** "Front end", "engine", "carrier" are
  roles a package plays, not folder names — a repo may fold a role into an
  existing package (the carrier as a library) as long as the edges still
  point one way.
- **Keep every edge pointing down.** A pattern that needs a same-layer or
  upward edge to work is the wrong shape for the problem, not a reason to
  add an exception.
- **Verify a pattern against a real tool before applying it**, the same
  evidence discipline as any other platform claim — a pattern description
  is a distillation, not a substitute for reading the case study it came
  from.
- **Prefer adding a package over introducing a back-edge.** Smaller,
  focused packages composed acyclically have proven more reliable than a
  shared package importing "up" for convenience.

## Footguns

- Bin-linking is direct-dependency-only in every package manager — see
  [carrier-package.md](./references/carrier-package.md) for why hoisting
  and hand-rolled hoist patterns don't fix it.
- A carrier's front ends belong in `dependencies`, never
  `peerDependencies` — see
  [carrier-package.md](./references/carrier-package.md).
- An MCP `main.ts` that imports its server graph statically can die
  silently behind the stdio transport — see
  [carrier-entry-contract.md](./references/carrier-entry-contract.md).
- A package.json read for "my own version" reports the wrong package's
  version once code moves to a shared engine — see
  [carrier-version-threading.md](./references/carrier-version-threading.md).
- A plugin loader that dispatches through `pnpm exec` / `yarn exec` /
  `bunx` resolves bins differently per package manager — see
  [carrier-plugin-loader.md](./references/carrier-plugin-loader.md).
- A manifest DAG test with no positive-control fixture can pass while
  checking nothing — see
  [carrier-verification.md](./references/carrier-verification.md).

## Additional resources

- [references/carrier-package.md](./references/carrier-package.md) — the
  problem the carrier pattern solves, its roles and edge direction, the
  carrier-as-library deviation, the dependencies-vs-peers rule, and the
  release model. Load when: deciding whether a multi-bin tool needs this
  shape at all, or reviewing a package's `dependencies` vs
  `peerDependencies` split.
- [references/carrier-entry-contract.md](./references/carrier-entry-contract.md)
  — the four-file front-end contract (`bin.ts`/`main.ts`/`index.ts`/`version.ts`),
  the carrier's mirror-bin shims, and the MCP crash-guard requirement. Load
  when: scaffolding a new front-end package or a carrier's bin shims.
- [references/carrier-version-threading.md](./references/carrier-version-threading.md)
  — build-time version literals, the `Distribution` `Context.Reference`,
  `engine_version` as the comparable version, and the `--version` format.
  Load when: a tool needs to report which meta-package it was installed
  through, or two front ends disagree about "the version."
- [references/carrier-plugin-loader.md](./references/carrier-plugin-loader.md)
  — the Claude Code / Copilot plugin loader shape (`node_modules/.bin`
  first, install hint, major-pinned `npx` fallback) and the hook CLI
  resolution order. Load when: writing or reviewing a plugin's
  `mcpServers`/`lspServers` loader script or a hook that shells out to a
  project's own CLI.
- [references/carrier-verification.md](./references/carrier-verification.md)
  — the manifest DAG test with non-vacuity, source boundary tests, and the
  packed-install e2e across package managers. Load when: writing or
  reviewing the tests that keep a multi-package tool's shape honest.
- [references/carrier-app-and-schemas.md](./references/carrier-app-and-schemas.md)
  — the OPTIONAL extension: where the app layer (platform + config
  discovery) and a published config-file JSON Schema belong — core owns
  shape/version/hosted identity, the engine owns platform + discovery,
  front ends only pass in process-derived inputs. Load when: the tool has
  a user config file a person hand-edits, or publishes a JSON Schema for
  it — cross-links `building-schemastore-schemas` for the generation and
  drift-gate mechanics rather than re-teaching them here.
- [references/carrier-case-studies.md](./references/carrier-case-studies.md)
  — okfit, vitest-agent and systems: what each does best, what each is
  missing, and the deviations each made and why. Load when: you want a
  worked, citable example instead of the prescriptive rule alone.
