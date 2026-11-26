# Entry points: a second subpath, a self-import, a bin-only package

API Extractor models one surface per entry point. This reference covers the
three package shapes where that bites: a second published subpath, a subpath
that names the root's own types, and a package with no entry point at all.

## A second published entrypoint models its own surface

A `package.json` `exports` map can publish more than one subpath — `.` and
`./testing`, say — and api-extractor builds and gates **each entrypoint
independently**, as its own closed surface. A type that one entrypoint's
public signature reaches is not automatically visible through another
entrypoint just because both ship from the same package: every kit type an
entrypoint's own exported signatures name must be re-exported from **that**
entrypoint too, or that entrypoint alone reports `ae-forgotten-export` —
"already exported from `.`" is never the fix for a second entrypoint's own
gate.

Worked example: `@effected/workspaces/testing`.
`WorkspaceLayering.checkWorkspace`'s requirement and error channel reach the
`WorkspaceDiscovery` service — its shape, options and failures.
`WorkspaceDiscovery` is not part of the package's main `.` surface at all;
`./testing` re-exports it anyway, because `./testing`'s own signatures are the
ones naming it. State the rule in the module's header comment: "This module is
an ENTRY POINT: api-extractor models it as its own surface, so every kit type
its signatures name is re-exported here."

```ts
import type { WorkspaceDiscovery, WorkspaceLayering } from "@effected/workspaces/testing"

// Both resolve from the SAME subpath: WorkspaceLayering's own signatures
// reach WorkspaceDiscovery (edgesOf's parameter, checkWorkspace's
// requirement and error channel), so this entrypoint re-exports
// WorkspaceDiscovery too rather than relying on the package's main entry
// to already have done so.
declare const service: WorkspaceDiscovery
declare const layering: typeof WorkspaceLayering
```

A second entrypoint that re-exports types whose TSDoc `{@link}`s a class only
the main entry exports fails `ae-unresolved-link` on the second entry's own
report: the link has nothing to resolve against there. Spell those references
in backticks instead of `{@link}`, as `@effected/commands` and
`@effected/memfs` do.

## A subpath that names the root's types: the self-import pattern

A second entrypoint whose signatures name types the root already exports —
`@effected/npm/node` names `NpmConfig`, `@effected/pnpm/settings` names
`PnpmSettings`, `PeerDependencyRules` and `VersioningConfig` — should import
them from the package's own name rather than carry a copy. Three parts, all
required:

1. **Keep the self-import external in the declarations**, in the package's
   `effected.toml`: `[package.build] dtsExternals = ["@effected/npm"]`. The
   subpath's `.d.ts` then refers to the root's type instead of inlining it.
2. **Scope a suppression to that entry point only.** The second API Extractor
   pass resolves the self-import to the built root declarations but still
   reports the root types it reaches as forgotten, so add
   `{ messageId = "ae-forgotten-export", pattern = 'entry point node\.d\.ts$' }`
   (the subpath's own file name) to `[package.build.meta.tsdoc]
   suppressWarnings`. A bare pattern would hide a real leak in the root.
3. **Pin what the suppression could hide with a built-declaration test.** The
   suppression is never unpinned: a declaration local to the subpath and left
   unexported would be silenced, so a test reads the built `<entry>.d.ts` and
   asserts that every top-level declaration is exported and the import
   specifiers are the expected ones. Build before the test reads it.

## A bin-only package has no API model — `emitDts: false`, not a fake entry point

A package whose published surface is a `bin` and nothing else (`exports`
limited to `"./package.json"`, no `index.ts`) fails the build under the
default config with `Cannot merge zero API models`. Nothing is wrong
with the package: the declaration pass ran over zero entry points and the
prod meta pass then had nothing to extract. The fix is **not** an `index.ts`
that exports nothing, and not a `meta: false` (which still runs the dts
pass). It is `emitDts = false` in the package's `effected.toml`:

```toml
# Bin-only: no declarations to bundle, no API model to extract.
[package.build]
emitDts = false
```

`BuildConfigInput.emitDts` is documented as the switch for *"JS-only artifacts
that never consume declarations (e2e fixtures, bins, internal tools)"* — it
skips the dts pass (dev and prod) and therefore the meta pass, while still
emitting JS, the byte-variant targets and the transformed `package.json`.
Such a package therefore carries **no `_base` suppression, no `tsdoc.json`, no
api-extractor model and no docs page** — all of that machinery reads a
`.d.ts` that does not exist. It is also the one package shape a
doc-model-driven enumerator (a construct index, a docs site) must exclude by
its `exports` map (every key `"./package.json"`), or it reports the bin as a
perpetually missing build. The `effect-v4-cli` skill covers the package shape
itself.
