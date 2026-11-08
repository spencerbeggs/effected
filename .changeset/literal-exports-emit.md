---
"@effected/bundler": minor
---

## Features

* A literal `./dist/foo.js` export or `bin` target, including an executable entry, points at the emitted file
* A literal export or `bin` target that names no emitted file warns `exports-pattern-unmatched`
* Every own source file in the declaration program is reported

## Bug Fixes

* A `*` pattern over build sources, a `*` key over a literal build source, and a condition object naming the executable fail with `ConfigValidationError` instead of producing a wrong manifest
