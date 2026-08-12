# @effected/npm

Effect contracts for resolving pnpm `catalog:` and `workspace:` specifiers, the
kit's shared dependency vocabulary, and the registry-read and publish services
built over them.

**For full design rationale and deferred decisions:**
→ `@../../.claude/design/effected/packages/npm.md`

Load when changing contract shapes, adding a resident concept, or reconciling
against a real resolver.

## Child context files

Children carry surfaces and evidence; **every rule is here**.

- Vocabulary and contracts → `@./CLAUDE.vocabulary.md` — Load when: changing or extending the resolver contracts, `Manifest`, or the shared vocabulary types.
- Services → `@./CLAUDE.services.md` — Load when: touching registry reads or the publish flow (`NpmRegistry`, `PackagePublish`, `NpmExecutor`, `RegistryKind` and their doubles).

## What this is

An **internal package with no source repo**, extracted from the
`@effected/package-json` port to hold the dependency-resolution contracts
package-json *defines but cannot implement*: resolving a specifier needs
workspace and catalog context a document library has no access to. Contract
here, implementation elsewhere.

**Boundary tier since the Phase 5 extension (2026-07-25) — this package was
pure, and the change is deliberate. Do not let "pure" creep back in.**
`NpmRegistry` and `PackagePublish` perform IO themselves through core contracts
in `R` (`HttpClient`, `ChildProcessSpawner`, `FileSystem`, `Crypto`), which is
[R4](../../.claude/design/effected/effect-standards.md#dependency-policy)'s
definition of boundary. It is **not** R2: the `@effected/commands` edge is
boundary with zero runtime deps and does not propagate.

Peers on `effect` plus one pure-to-pure `@effected/semver` edge — `workspace:^`
in `peerDependencies` (a published patch floats), mirrored by plain
`workspace:*` in `devDependencies`, never `dependencies` — used only to detect
ranges in `DependencySpecifier`. `@effected/commands` is a `workspace:^`
**dependency**. Zero *external* runtime deps.

### The guardrail, and it is enforced

`@effected/lockfiles` is **pure** and depends on this package for vocabulary
only. It stays pure under R3 — a boundary dependency does not propagate — but
only while two things hold:

1. **The pure vocabulary modules must not reach IO** — the vocabulary types, the
   resolver contracts and `Manifest` import neither service nor
   `@effected/commands`.
2. **`index.ts` must export individually.** A namespace object (`export * as`)
   is one live binding: a bundler cannot see through it, so importing
   `IntegrityHash` would retain the HTTP client and the subprocess runner.

`__test__/reachability.test.ts` asserts both from the source graph and is proven
to fail when violated. **Do not weaken it**, and do not "tidy" `index.ts` into a
namespace.

**The escalation, if it ever comes:** the moment either service takes a
*non-core* runtime dependency (a registry SDK, a tarball reader), this package
becomes **integrated** and R2 *does* propagate — dragging `lockfiles` (pure!)
and `package-json` with it. Split the services into their own package then,
never accept an integrated npm. Re-check the tier before adding any dependency.

## Invariants

- **An unmatched specifier is `Option.none()`, not an error** at the contract
  level. `DependencyResolutionError` is failure of the resolution *mechanism*;
  `CatalogAssemblyError` failure to assemble the catalogs; at the **manifest**
  level `Manifest.resolve()` turns the `Option.none()` into a typed
  `UnresolvedDependencyError`. Do not blur these three.
- **`cause` stays structured.** Never fold it into a string.
- **`Schema.Defect` must be called** — the bare value throws at construction.
- **Layers bind to consts, never getters** — a getter mints a fresh layer per
  access and defeats memoization.
- **`DependencyResolutionError` lives in `WorkspaceResolver.ts`,
  `CatalogAssemblyError` in its own module**, and `CatalogResolver.ts`
  type-imports both — one runtime edge, `noImportCycles` satisfied, so `Default`
  lives in `index.ts`.
- **Never spread an `optionalKey` field in as explicit `undefined`** — v4
  constructors validate; `Manifest.resolve` uses conditional spreads.
- **Only `src/index.ts` re-exports.** No barrel files.
- **Grouped statics are a static class with a private constructor, never an
  `as const` object** — inferred member types lose their TSDoc in the `.d.ts`.
- **A `Schema.check` is erased from the built type**, so severing a consumer
  from the shared `CorepackIntegrityHash` is neither a type error nor a
  behaviour change. The catcher is a runtime **identity** assertion in each
  consumer's suite, with a control against the unrestricted brand — never
  downgrade one to a behavioural or source-text test.
- **A package-manager pin's first `+` after the version always begins the
  integrity** — a malformed tail fails typed, never falling back to
  build-metadata parsing. The pin's four-literal name grammar diverging from
  `@effected/package-json`'s permissive field model is evidence-backed; do not
  "finish" the consolidation by closing that set.
- **`PackageManagerCache` is a cited facts table of defaults only** —
  environment overrides are out of scope, and a "tidied" path is a cache that
  silently never hits.
- **`ReleaseAgeGate.combine` is the single clamping authority** (variadic,
  strictest-wins). Never clamp a `PartialReleaseAgeGate` in isolation.
- **Never send a token to a registry the classifier did not name** — subdomain
  matching requires a leading dot, so `evil-npmjs.org` is `custom`.
- **Never write an auth token into argv** — it goes to a caller-supplied npmrc
  path, and masking is the caller's job.
- **`NpmExecutor.dlx` with no launcher fails typed.** Never degrade to ambient
  npm; degrading reintroduces the exact bug the pin exists to avoid.
- **On a result record, match the neighbours.** `PublishOutcome.provenanceUrl`
  is a plain optional field, not an `Option` — as an `Option`, a bare
  `=== undefined` check compiled clean, was always true, and bit a consumer
  live. `Option` discipline is for the resolver contracts.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` —
never `expect`. Provide layers via top-level `layer(...)`, not per-test
`Effect.provide`. Each contract keeps a **stub-implementation layer** test
proving it is implementable; stubs build `Option` results with
`Option.fromUndefinedOr` (`Option.fromNullable` is gone in v4).

```bash
pnpm vitest run packages/npm          # from the repo root
pnpm build --filter @effected/npm     # dev, then prod
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`
and leaves a truncated `issues.json` shaped like a clean gate.

`savvy.build.ts` suppresses `ae-forgotten-export` for the `_base` pattern
(factory-backed classes are written inline per house policy), so a clean
`dist/prod/issues.json` has empty `warnings`/`errors` and one `suppressed` entry
per such class — read the file for the current set. **`suppressed: 0` in the
*prod* gate means the build did not run properly**; `dist/dev/issues.json`
legitimately has `suppressed: []`, since the dev target does not run API
Extractor.
