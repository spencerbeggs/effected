# @effected/lockfiles

Pure lockfile parsing for the four package-manager formats — bun (`bun.lock` JSONC), npm (`package-lock.json`), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) — normalized into one unified `Lockfile` model, plus pure integrity checking of that model against workspace manifests. The `LockfileReader` service (root find, PM detect, file IO, dispatch) lives in the consumer, `@effected/workspaces`, never here.

## Knowledge bundle

Durable knowledge about this package lives in `okf/`, not here. Load the concept a task needs:

- Purpose, tier and peers, the supported input domain (pnpm `lockfileVersion` 9+, npm 3+; the gate is on the *format* version and runs before the shape decode), the model, per-format identity and resolution, importers, hardening, observability, testing and fixture conventions, consumer contract → `okf/modules/lockfiles.md` — Load when: changing the model, the parse pipeline, either seam repair, or adding a fixture.
- Instances and resolution — `instanceId`, `resolved`, `unresolvedEdges`, peer declarations, the pnpm `link:` / publish-directory / `npm:` alias readings → the "Per-format identity and resolution" section of `okf/modules/lockfiles.md`, plus `okf/invariants/lockfiles-npm-bun-never-populate-unresolved-edges.md`, `okf/invariants/lockfiles-positional-walk-is-deepest-first.md`, `okf/limitations/lockfiles-yarn-carries-no-peer-edges.md`, `okf/gotchas/yarn-berry-lockfile-has-no-devdependencies-section.md` — Load when: touching any per-format resolution walk or the fields a consumer's peer check reads.
- Document framing (a pnpm lockfile is a YAML *stream*; the lockfile is the **last** document; `LockfileFramingError`) → `okf/decisions/lockfile-is-a-yaml-stream.md` — Load when: touching `src/internal/documents.ts` or anything that selects a document.
- The env preamble (`PnpmEnvLockfile.packageManager` reads the **first** of two documents into `PackageManagerLock`; `none` for nothing recorded, a typed failure for a recorded version the preamble cannot back) → the "The env preamble: the pinned package manager" section of `okf/modules/lockfiles.md` — Load when: touching `src/PnpmEnvLockfile.ts`, `src/PackageManagerLock.ts` or `src/internal/pnpmEnv.ts`.
- Contract edges (bun tuple shape, importer-name map carries names only, pnpm root importer is not a package row) → `okf/limitations/lockfiles-*.md` — Load when: a consumer asks for something the model does not carry.

## Operating instructions

- `src/index.ts` is the only re-exporting module; read it for the public surface rather than any prose listing. Internals under `src/internal/` import only the leaf model modules, never `Lockfile.ts` (`noImportCycles`), and fail with a raw `ParseFailure = { stage, cause }` that `materializeFailure` (in `Lockfile.ts`) turns into `LockfileParseError` or `LockfileFramingError` — the one mapping both `Lockfile.parse` and `PnpmEnvLockfile.packageManager` use; never map a `ParseFailure` a second way.
- `LockfileParseError.cause` stays `Schema.Defect`; narrow the version-gate case with `isUnsupportedLockfileVersion`, never by parsing prose.
- Malformed input **always** exits typed (`stage: "syntax"` or `"validation"`) — never a defect. Key-bearing intermediates are `Map`/`Set`, records are built with `Object.fromEntries`.
- Fixtures are stored as `<lockfile>.fixture`, never under the real lockfile name (a real name is a Dependabot manifest), and read with `fixture()` from `__test__/helpers/fixtures.ts`.
- Fixtures: a directory named `unsupported-*` is input the parser must reject, and the version-gate guard enumerates the fixtures directory to skip exactly those — never re-hard-code the list. A pnpm fixture's `packages.length` is an *instance* count; expect it to move when peer variants are added.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — never `expect`.

```bash
pnpm vitest run packages/lockfiles          # from the repo root
pnpm build --filter @effected/lockfiles     # from the repo root
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. A clean `dist/prod/issues.json` carries **13** `_base` `suppressed` entries; `suppressed: 0` in the *prod* gate means the build did not run. A `suppressed: 13` in the log does not prove it ran either — a turbo cache hit replays the previous output verbatim; check that `dist/prod/issues.json`'s `generatedAt` postdates your last source edit (`okf/gotchas/turbo-cache-hit-replays-clean-log.md`).
