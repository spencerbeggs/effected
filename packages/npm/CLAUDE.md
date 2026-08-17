# @effected/npm

Effect contracts for resolving pnpm `catalog:` and `workspace:` specifiers, the
kit's shared dependency vocabulary, and the registry-read and publish services
over them.

**Design doc:** `@../../.claude/design/effected/packages/npm.md` — load when changing contract shapes, adding a resident concept, or reconciling against a real resolver.

## Child context files

Children carry surfaces and evidence; **every rule is here**.

- Vocabulary and contracts → `@./CLAUDE.vocabulary.md` — Load when: changing or extending the resolver contracts, `Manifest`, or the shared vocabulary types.
- Services → `@./CLAUDE.services.md` — Load when: touching registry reads or the publish flow (`NpmRegistry`, `PackagePublish`, `NpmExecutor`, `RegistryKind` and their doubles).

## What this is

An **internal package with no source repo**, holding the dependency-resolution contracts `@effected/package-json` *defines but cannot implement*: resolving a specifier needs workspace and catalog context a document library cannot reach. Contract here, implementation elsewhere.

**Boundary tier since 2026-07-25 — it was pure, and the change is deliberate. Do
not let "pure" creep back in.**
`NpmRegistry` and `PackagePublish` do their own IO through core contracts in `R` (`HttpClient`, `ChildProcessSpawner`, `FileSystem`, `Crypto`) — [R4](../../.claude/design/effected/effect-standards.md#dependency-policy)'s definition of boundary. Not R2: the `@effected/commands` edge is boundary with zero runtime deps and does not propagate.

Peers on `effect` plus one pure-to-pure `@effected/semver` edge — `workspace:^`
in `peerDependencies` (a published patch floats), mirrored by plain
`workspace:*` in `devDependencies`, never `dependencies` — used only for range
detection in `DependencySpecifier`. `@effected/commands` is a `workspace:^`
**dependency**. Zero *external* runtime deps.

### The guardrail, and it is enforced

`@effected/lockfiles` is **pure** and depends on this package for vocabulary only; it stays pure under R3 — a boundary dependency does not propagate — while two things hold:

1. **The pure vocabulary modules must not reach IO** — the vocabulary types, the
   resolver contracts and `Manifest` import neither service nor
   `@effected/commands`.
2. **`index.ts` must export individually.** A namespace object (`export * as`)
   is one live binding a bundler cannot see through, so importing
   `IntegrityHash` would retain the HTTP client and the subprocess runner.

`__test__/reachability.test.ts` asserts both from the source graph and is proven to fail when violated — **do not weaken it**, and never "tidy" `index.ts` into a namespace.

**The escalation, if it ever comes:** a *non-core* runtime dependency in either service (a registry SDK, a tarball reader) makes this package **integrated**, and R2 *does* propagate — dragging `lockfiles` (pure!) and `package-json` with it. Split the services out then; never accept an integrated npm. Re-check the tier before adding any dependency.

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
  `CatalogAssemblyError` in its own module**; `CatalogResolver.ts` type-imports
  both — one runtime edge, `noImportCycles` satisfied, so `Default` lives in
  `index.ts`.
- **Never spread an `optionalKey` field in as explicit `undefined`** — v4
  constructors validate; `Manifest.resolve` uses conditional spreads.
- **Only `src/index.ts` re-exports.** No barrel files.
- **Grouped statics are a static class with a private constructor, never an
  `as const` object** — inferred member types lose their TSDoc in the `.d.ts`.
- **A `Schema.check` is erased from the built type**, so severing a consumer
  from the shared `CorepackIntegrityHash` is neither a type error nor a
  behaviour change. The catcher is a runtime **identity** assertion in each
  consumer's suite, with a control against the unrestricted brand; never
  downgrade it to a behavioural or source-text test.
- **The SRI bridge is one-way.** `CorepackIntegrityHash.FromSri` / `fromSri` decode npm's `sha512-<base64>` to the corepack form only; an already-corepack input **fails typed** rather than passing through, so a caller feeding pins back in cannot mask a wiring bug. Its hand-rolled base64 reader is strict and canonical for the same reason: `Buffer`-style lenience would mint pins corepack rejects at install. Encode is its exact inverse, not a second acceptance rule.
- **A package-manager pin's first `+` after the version always begins the
  integrity** — a malformed tail fails typed, never falling back to
  build-metadata parsing. The pin's four-literal name grammar diverging from
  `@effected/package-json`'s permissive field model is evidence-backed — do not
  "finish" the consolidation by closing that set.
- **`PackageManagerCache` is a cited facts table of defaults only** —
  environment overrides are out of scope, and a "tidied" path silently never
  hits.
- **`ReleaseAgeGate.combine` is the single clamping authority** (variadic,
  strictest-wins). Never clamp a `PartialReleaseAgeGate` in isolation.
- **Never send a token to a registry the classifier did not name** — subdomain
  matching requires a leading dot, so `evil-npmjs.org` is `custom`.
- **Never write an auth token into argv** — it goes to a caller-supplied npmrc
  path, and masking is the caller's job.
- **`NpmExecutor.dlx` with no launcher fails typed.** Never degrade to ambient
  npm — that reintroduces the exact bug the pin exists to avoid.
- **On a result record, match the neighbours.** `PublishOutcome.provenanceUrl`
  is a plain optional field, not an `Option` — as an `Option` a bare
  `=== undefined` check compiled clean, was always true, and bit a consumer
  live. `Option` discipline is for the resolver contracts.

## Testing and building

Provide layers via top-level `layer(...)`, not per-test `Effect.provide`. Each contract keeps a **stub-implementation layer** test proving it is implementable; stubs build `Option` results with `Option.fromUndefinedOr` (`Option.fromNullable` is gone in v4).

```bash
pnpm vitest run packages/npm          # from the repo root
pnpm build --filter @effected/npm     # dev + prod
```

Never run `node savvy.build.ts --target prod` directly (root `CLAUDE.md` says why). `savvy.build.ts` suppresses `ae-forgotten-export` for the `_base` pattern (inline factory-backed classes), so a clean *prod* `issues.json` carries empty `warnings`/`errors` and one `suppressed` entry per such class. **`suppressed: 0` in the prod gate means the build did not run properly**; `dist/dev/issues.json` legitimately has `suppressed: []` — the dev target does not run API Extractor.
