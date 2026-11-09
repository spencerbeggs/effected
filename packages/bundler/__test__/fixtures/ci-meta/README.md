# ci-meta fixture

A one-package pnpm workspace, hand-written on 2026-11-09 for `__test__/e2e/ci-meta.e2e.test.ts` (#1317). `@fixture/p` has one forgotten export (`reveal` returns `Hidden`, which `src/index.ts` never exports) and one missing release tag (`untagged`).

Under `ci: true` API Extractor escalates `ae-forgotten-export` to an error and the build fails. The test proves the failed build's `issues.json` still carries both diagnostics with their source locations, as a local build of the same tree does. Nothing is installed: the test copies it to a temporary directory.
