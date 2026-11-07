# Action bundle fixtures

Copied from `@savvy-web/github-action-builder`'s `__test__/integration/fixtures/` in savvy-web/systems, for the `__test__/e2e/action-*.e2e.test.ts` suites that port its integration tests.

- `default-minify`, `ignore-modules`, `string-externals`, `license-comments` and `cjs-node-interop` are verbatim.
- `idempotent-build` had no fixture of its own there: its test builds `ignore-modules`, and so does the port.
- `native-dynamic-imports` is dropped, because rolldown keeps a computed `import()` native and the option it tested does not exist here.

The suites copy a fixture to a temporary directory before building, because `dist` is ignored and nothing here is built in place.
