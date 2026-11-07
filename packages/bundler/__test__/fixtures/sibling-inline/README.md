# sibling-inline fixture

A two-package pnpm workspace, hand-written on 2026-11-06 for `__test__/e2e/sibling-inline.e2e.test.ts`. It is the shape of vitest-agent's `ui` and `@vitest-agent/sdk`: `@fixture/b` re-exports a type from `@fixture/a` and sets `bundledPackages = ["@fixture/a", "@fixture/a/deep/thing"]`, while `@fixture/a` has a nested subpath export whose emitted file name is flattened.

Nothing is installed: the test copies it to a temporary directory and links `packages/b/node_modules/@fixture/a` by hand. It proves the declaration pass inlines a workspace sibling from the sibling's built declarations.
