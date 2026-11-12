---
type: Decision
title: "The catalog: and workspace: protocols are shared, so their contracts stay in @effected/npm"
description: "bun's catalog: and workspace: protocols read and resolve the way pnpm 12's do for every case the kit implements, so CatalogResolver, WorkspaceResolver and the specifier grammar stay in @effected/npm; CatalogSet stays in @effected/workspaces because it assembles from lockfiles; and the @pnpm/catalogs.* dependency is replaced by a re-implementation of pnpm 12's Rust crates."
status: draft
tags:
  - architecture
  - deps
sources:
  - id: bun-catalogs
    resource: https://bun.com/docs/install/catalogs
    title: "bun: catalogs"
    last_modified: 2026-11-12T00:00:00Z
  - id: bun-workspaces
    resource: https://bun.com/docs/install/workspaces
    title: "bun: workspaces and the workspace: protocol"
    last_modified: 2026-11-12T00:00:00Z
  - id: pnpm-catalogs-config
    resource: ../../.repos/pnpm/pnpm/crates/catalogs-config/src/lib.rs
    title: "pnpm 12.20.0 catalogs-config: get_catalogs_from_workspace_manifest"
  - id: pnpm-catalogs-protocol-parser
    resource: ../../.repos/pnpm/pnpm/crates/catalogs-protocol-parser/src/lib.rs
    title: "pnpm 12.20.0 catalogs-protocol-parser: parse_catalog_protocol"
  - id: pnpm-catalogs-resolver
    resource: ../../.repos/pnpm/pnpm/crates/catalogs-resolver/src/lib.rs
    title: "pnpm 12.20.0 catalogs-resolver: resolve_from_catalog"
  - id: pnpm-workspace-spec
    resource: ../../.repos/pnpm/pnpm/crates/workspace-spec/src/lib.rs
    title: "pnpm 12.20.0 workspace-spec: the workspace: grammar"
  - id: pnpm-implied-version
    resource: ../../.repos/pnpm/pnpm/crates/lockfile/src/implied_version.rs
    title: "pnpm 12.20.0 lockfile: what catalog: and workspace: imply"
  - id: catalogs-module
    resource: ../../packages/workspaces/src/internal/catalogs.ts
    title: "The kit's catalog engine"
generated:
  by: "okfit/claude-code"
  at: 2026-11-12T23:51:04Z
integrity:
  generated:
    body: 7b5c1f115d1a4986
---

# The catalog: and workspace: protocols are shared, so their contracts stay in @effected/npm

## Context

The kit's rule puts a concept that one manager owns alone in that manager's package, and a concept several managers share in `@effected/npm`, the lowest package they all depend on. The `catalog:` and `workspace:` protocols were candidates for `@effected/pnpm`: `CatalogResolver` and `WorkspaceResolver` in `npm`, and `CatalogSet` with its engine `internal/catalogs.ts` in `workspaces`. The question was whether bun's protocols are the same definition as pnpm's for what the kit implements: naming a catalog and an entry, looking a range up, and projecting a `workspace:` specifier onto a member's version.

## Decision

Both protocols are shared. `CatalogResolver`, `WorkspaceResolver`, `DependencyResolutionError` and the `catalog:`/`workspace:` arms of `DependencySpecifier` stay in `@effected/npm`, and nothing about them moves to `@effected/pnpm`.

The evidence for `catalog:`:

- bun reads `catalog:` as the default catalog, `catalog:<name>` as a named one, and `catalog:default` as the same as `catalog:`. A package that defines both `catalog` and `catalogs.default` is an error, and "a catalog reference behaves exactly as if the catalog's range were written inline".[^bun-catalogs]
- pnpm 12 parses the same grammar (the name trimmed, empty meaning `default`)[^pnpm-catalogs-protocol-parser], rejects the same doubled default[^pnpm-catalogs-config], and resolves a reference to the entry as written.[^pnpm-catalogs-resolver]
- The managers differ only in where catalogs are written: `pnpm-workspace.yaml` for pnpm, the root `package.json` (top level or inside `workspaces`) for bun. That is source assembly, which `CatalogSet` already does for both.

The evidence for `workspace:`: bun accepts `workspace:*`, `workspace:^`, `workspace:~`, an explicit version, a relative path and the `workspace:<name>@<range>` alias, and publishes them as the version, `^version`, `~version`, the explicit version, the version, and an `npm:` alias.[^bun-workspaces] pnpm 12's grammar is the same, alias form and path form included.[^pnpm-workspace-spec][^pnpm-implied-version] The kit's `WorkspaceResolver.versionOf` and `DependencySpecifier.resolveWorkspace` model exactly that projection.

`CatalogSet` and `internal/catalogs.ts` stay in `@effected/workspaces`. `CatalogSet.fromLockfile` takes a `Lockfile` from `@effected/lockfiles`, which no manager package may depend on, and the set already assembles from both pnpm's and bun's sources, so it is manager-neutral workspace assembly rather than pnpm's alone.

`@effected/workspaces` no longer depends on `@pnpm/catalogs.config`, `.protocol-parser`, `.resolver` or `.types`. Those are pnpm 11's JavaScript packages. Checked against pnpm 12.20.0's crates (vendored at `.repos/pnpm`), the protocol parse matches, but two behaviours differ: the doubled-default check tests `catalogs.default`'s value where pnpm 12 tests the key (`contains_key`), so a null `catalogs.default` beside a top-level `catalog` passed[^pnpm-catalogs-config], and `resolveFromCatalog` rejects a `link:` or `file:` catalog entry, which pnpm 12's `resolve_from_catalog` resolves.[^pnpm-catalogs-resolver] The kit is pnpm 12 only, so `internal/catalogs.ts` re-implements the four functions it used against the Rust crates: the default catalog defined twice is decided by the key, an entry resolves to its specifier as written (pnpm 12's `AsWritten` anchor), a missing entry or a recursive `catalog:` entry is a misconfiguration, and a merge copies keys with `Object.defineProperty`.[^catalogs-module]

## Consequences

- No `@effected/pnpm` → `@effected/workspaces` or `@effected/pnpm` → `@effected/lockfiles` edge is needed, and `@effected/package-json`'s and `npm`'s own `Manifest` resolution keeps reaching the resolver contracts without depending on `pnpm`.
- A `link:` or `file:` catalog entry now resolves through `CatalogSet.resolveSpecifier` to the entry as written, where it answered `Option.none()` before.
- A future bun or pnpm release that changes either protocol for one manager alone moves that manager's part into its own package; the shared contract stays in `npm`.

## Alternatives rejected

- **Move the resolvers to `@effected/pnpm`.** `npm`'s `Manifest` and `package-json`'s `Package` resolve through them, so both would need a `pnpm` edge for a protocol bun reads the same way.
- **Move the catalog engine into `@effected/npm`.** It would put an implementation with one consumer into `npm`, and `CatalogSet` still could not move with it.
- **Keep `@pnpm/catalogs.*`.** Its resolver disagrees with pnpm 12 on `link:` and `file:` entries, and its version line follows pnpm 11.

[^bun-catalogs]: <https://bun.com/docs/install/catalogs>
[^bun-workspaces]: <https://bun.com/docs/install/workspaces>
[^pnpm-catalogs-config]: `.repos/pnpm/pnpm/crates/catalogs-config/src/lib.rs`
[^pnpm-catalogs-protocol-parser]: `.repos/pnpm/pnpm/crates/catalogs-protocol-parser/src/lib.rs`
[^pnpm-catalogs-resolver]: `.repos/pnpm/pnpm/crates/catalogs-resolver/src/lib.rs`
[^pnpm-workspace-spec]: `.repos/pnpm/pnpm/crates/workspace-spec/src/lib.rs`
[^pnpm-implied-version]: `.repos/pnpm/pnpm/crates/lockfile/src/implied_version.rs`
[^catalogs-module]: `packages/workspaces/src/internal/catalogs.ts`
