# bun.lock fixtures

`v2/bun.lock.fixture` is a byte-for-byte copy of
`packages/lockfiles/__test__/fixtures/bun/v2/bun.lock.fixture`, which records its
provenance: real bun output, `lockfileVersion: 1`, from the original fixture set
(#38, 2026-07-10), with the producing bun version and command never recorded.
The `.fixture` suffix keeps GitHub's dependency graph from reading it as a
manifest. Do not reformat or hand-edit it.

It pins that a workspace `bun.lock` decodes: `lockfileVersion`, the
`workspaces` map (root `""` and `packages/core`), `packages`, `catalog` and
`catalogs`.

The malformed cases (broken JSONC, a non-numeric `lockfileVersion`) are inline
strings in `BunLockDocument.test.ts`, written by hand: no package manager
writes them.
