# @effected/npm

Effect contracts for resolving pnpm `catalog:` and `workspace:` specifiers, the
kit's shared dependency vocabulary, and the registry, tarball and publish
services over them. **Boundary tier**, deliberately — never let "pure" creep
back in, and never accept an integrated npm.

## Knowledge bundle

Everything durable about this package lives in `okf/`, not here. Start at
`okf/index.md`, then load what the task needs:

- Package design (purpose, tier posture, module layout, every surface and the
  reasoning behind its shape, consumers and implementers, testing, build) →
  `okf/modules/npm.md` — Load when: changing a contract shape, `Manifest`, a
  vocabulary module, or any of `NpmRegistry`, `PackageTarball`,
  `RegistryCredential`, `PackagePublish`, `NpmExecutor`, `RegistryKind`.
- The tier guardrail (pure vocabulary never reaches IO; `index.ts` exports
  individually; the escalation answer is a split, never a retier) →
  `okf/decisions/npm-tier-guardrail.md`,
  `okf/conventions/dependency-policy.md` — Load when: adding any dependency
  or import to a service or vocabulary module, or touching
  `__test__/reachability.test.ts` (do not weaken it).
- Why the contracts live here, not beside their implementer →
  `okf/decisions/contract-inversion-default.md`; why `CatalogAssemblyError`
  is not in a shared errors package →
  `okf/decisions/no-shared-errors-package.md`.
- `CorepackIntegrityHash` is shared by identity, and only a runtime identity
  assertion can see a re-fork →
  `okf/invariants/corepack-integrity-hash-shared-by-identity.md` — Load
  when: touching `IntegrityHash.ts`, `PackageManagerPin.integrity`, or the
  matching `@effected/package-json` field. Its SRI sibling,
  `SriIntegrityHash`, is consumed the same way by `@effected/workspaces`'
  `ConfigDependencySpec` → the vocabulary section of `okf/modules/npm.md`.
- Traps → `okf/gotchas/npm-renamed-field-silent-spread-drop.md`
  (`RegistryTarget.token` is a `never` tripwire — never alias or delete it
  early), `okf/gotchas/npm-12-pack-json-is-keyed-by-name.md` (`pack --json`
  is an array on npm 11 and a name-keyed object on npm 12),
  `okf/gotchas/action-macos-npm-cache.md` (why `withCacheDir` exists) —
  Load when: a publish or pack fails on a runner, or a caller loses auth.
- Known edge → `okf/limitations/npm-no-packument-caching.md`.
- Package-manager support window (which npm majors `PackagePublish` must
  decode) → `okf/conventions/package-manager-support-policy.md`.
- Kit-wide standards this package is bound by →
  `okf/conventions/no-barrel-re-exports.md` (only `src/index.ts`
  re-exports; grouped statics are a class, never an `as const` object),
  `okf/conventions/error-standards.md`, `okf/conventions/testing-standards.md`.

## Operating instructions

- Read `okf/modules/npm.md` before changing anything; re-check the tier
  against `okf/decisions/npm-tier-guardrail.md` before adding a dependency.
- Verify a claim against `src/` and `__test__/` before acting on it; the
  bundle describes the present, and the source settles disputes.
- Tests provide layers via top-level `layer(...)`, assert with `assert.*`,
  and take any `FileSystem` from `@effected/memfs`.

```bash
pnpm vitest run packages/npm          # from the repo root
pnpm build --filter @effected/npm     # dev + prod
```

Never run `node savvy.build.ts --target prod` directly (root `CLAUDE.md` says
why). A prod `issues.json` with `suppressed: 0` means the build did not run
properly; `dist/dev/issues.json` legitimately has `suppressed: []`.
