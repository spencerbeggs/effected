---
"@effected/sbom": minor
---

## Breaking Changes

`SigstoreSigner.makeTest().sign` now dies when the returned effect runs, rather than throwing synchronously when `sign` is called. The message is unchanged. Tests that asserted a synchronous throw must run the effect and assert on the defect.
