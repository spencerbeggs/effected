---
"@effected/spdx": patch
"@effected/schema-org": patch
---

## Maintenance

Each package's generator now reads a committed data file instead of a vendored
git submodule: `lib/data/spdx-licenses.json` and
`lib/data/schemaorg-current-https.jsonld`.

Nothing about the generated output changes — both files regenerate
byte-identical. What changes is what a clone costs. The upstream repositories
are 1.86 GB and 254 MB; the files read from them are 332 KB and 1.5 MB. A
sparse checkout makes that bearable locally, but sparse configuration lives in
a submodule's own `.git/config` and does not travel, so every clone and every
CI checkout paid the full history to reach them — roughly tripling validation
time.

The rule, for the next package that wants an upstream dataset: submodule a
repository when the package needs to read the *repository*; commit the file
when it needs one file.
