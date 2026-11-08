---
"@effected/npm": minor
---

## Features

* `parseNpmrc`, `npmrcValue`, `npmrcValues` and `NpmrcEntry` read an `.npmrc` as ordered entries and look values up by key

## Bug Fixes

* `NpmConfig` fails with the `missing-env` reason for an unset `${VAR}` in a key, as it already did for a value
