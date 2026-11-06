# copy-assets fixture

The shape of vitest-agent's `sdk`, hand-written on 2026-11-06 for `__test__/e2e/copy-assets.e2e.test.ts`: `pkg/` ships JSON schemas that live outside the package, through `copy` and a `./schemas/*.json` pattern export.

The test copies it to a temporary directory, so nothing here is built in place.
