# package-lock.json fixtures

Each file is a byte-for-byte copy of a fixture in `packages/lockfiles/__test__/fixtures/npm/`,
which records its full provenance. The `.fixture` suffix keeps GitHub's
dependency graph from reading real manager output as a manifest. Do not
reformat or hand-edit them.

| Fixture | Copied from | Provenance (from the lockfiles README) | Pins here |
| --- | --- | --- | --- |
| `v2/package-lock.json.fixture` | `npm/v2` | Real npm output, `lockfileVersion: 3`, from the original fixture set (#38, 2026-07-10). The producing npm version and command were never recorded. | A workspace lockfile decodes: `lockfileVersion`, `name`, the root `""` entry's `workspaces` globs and the `packages` map. |
| `unsupported-v1/package-lock.json.fixture` | `npm/unsupported-v1` | Real npm 11.19.0 output from `npm install --lockfile-version=1` (#432). | A `lockfileVersion: 1` tree, which has no `packages` object, fails `reason: "version"` rather than `"shape"`. |

The malformed cases (broken JSON, a non-numeric `lockfileVersion`, a missing
`packages` map) are inline strings in `PackageLockDocument.test.ts`, written by
hand: no package manager writes them.
