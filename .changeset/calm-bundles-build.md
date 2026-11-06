---
"@effected/bundler": minor
---

## Features

* Adds `@effected/bundler`, the build behind the whole kit, replacing `@savvy-web/bundler` and `@savvy-web/github-action-builder`
* `Bundler.build` builds one package from its `effected.toml`: a JavaScript pass, a declaration pass, an API Extractor pass for the meta output, the SEA executable compile, and the build journals; the outputs land in `dist/prod`
* `ActionBuilder.build` bundles a GitHub Action from the `[action]` table of its `effected.toml` on rolldown, with `ActionValidation` and `PersistLocal` as separate steps
* Takes over the `tsdoctor.json` schema from `@tsdoctor/manifest`
* Emitted artifacts for the kit's packages are byte-identical to the previous bundler's output
