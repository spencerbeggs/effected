# pnpm-lock.yaml fixtures

Each file is a byte-for-byte copy of a fixture in `packages/lockfiles/__test__/fixtures/pnpm/`,
which records its full provenance. The `.fixture` suffix keeps GitHub's
dependency graph from reading real manager output as a manifest. Do not
reformat or hand-edit them.

| Fixture | Copied from | Provenance (from the lockfiles README) | Pins here |
| --- | --- | --- | --- |
| `v2/pnpm-lock.yaml.fixture` | `pnpm/v2` | Real pnpm output, `lockfileVersion: '9.0'`, from the original fixture set (#38, 2026-07-10). The producing pnpm version and command were never recorded. | A single-document workspace lockfile decodes with its `settings`, `catalogs` and `overrides` header, `importers`, `packages` and `snapshots`, and has no env preamble. |
| `unsupported-v6/pnpm-lock.yaml.fixture` | `pnpm/unsupported-v6` | Real pnpm 8 output (`lockfileVersion: '6.0'`), workspace-shaped; the exact pnpm 8 patch is not recorded (#432). | A pre-v9 lockfile fails `reason: "version"`. |
| `env-configdeps-pnpm12/pnpm-lock.yaml.fixture` | `pnpm/env-configdeps-pnpm12` | Real pnpm 12.6.0 output, captured 2026-09-27 on darwin-arm64 with `npx pnpm@12.6.0 install --dir <d> --store-dir <tmp>` over a `package.json` depending on `is-number@7.0.0` and a `pnpm-workspace.yaml` declaring one bare `configDependencies` entry. | The two-document stream: `PnpmLockDocument.parse` reads the last document, `PnpmEnvDocument.parse` the first. |

The malformed cases (broken YAML, three documents, an empty stream, an empty
or missing `importers` map, a pre-v9 preamble) are inline strings in
`PnpmLockDocument.test.ts`, written by hand or assembled from the fixtures
above: no package manager writes them.
