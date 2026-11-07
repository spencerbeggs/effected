# Fixtures

## `issues.input.json` and `issues.expected.json`

Pin the bytes of the `dist/<target>/issues.json` artifact.

- **Source of the input:** hand-authored, 2026-11-06. A fixed `BuildReport` with two target groups that carry the same ciFatal warning and the same suppressed diagnostic (to exercise de-duplication), one error, and a file/line/column on one diagnostic.
- **Producing tool:** `flattenIssues` and `serializeIssues` from the installed `@savvy-web/tsdown-plugins@2.11.7` (`node_modules/.pnpm/@savvy-web+tsdown-plugins@2.11.7*/node_modules/@savvy-web/tsdown-plugins/report/issues-artifact.js`), the previous implementation of this module (`packages/tsdown-plugins/src/report/issues-artifact.ts` in savvy-web/systems).
- **Command:** a one-off script that reads `issues.input.json` and writes `serializeIssues(flattenIssues([report], { target: "prod", generatedAt: "2026-06-21T00:00:00.000Z", buildOk: false, failure: { name: "ConfigValidationError", message: "bad config" } }))` to `issues.expected.json`.
- **Property pinned:** the port in `src/report/issues-artifact.ts` serializes the same input to the same bytes (2-space JSON, key order, trailing newline, de-duplication, the failure stamp).
- Do not reformat `issues.expected.json`; it is compared as a string.
