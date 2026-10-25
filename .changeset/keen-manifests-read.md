---
"@effected/github-actions": minor
---

## Features

### `ActionManifest`

`ActionManifest` decodes an `action.yml` through `read`, `decode` and `decodeResult`. The result covers inputs with their defaults, outputs, branding, and the `node`, `composite` or `docker` `runs` block. Closes #856.

- `runnerInputs` builds the input environment a real runner builds for a node or docker action. Every declared input appears under its `INPUT_` variable with the supplied value, its manifest default or `""`, and undeclared supplied names pass through as the runner passes them. Use it as the baseline for input tests.
- `diff` reports the inputs and outputs that your code and the manifest disagree on.

### `ActionInput.recording`

`ActionInput.recording(env)` records which inputs a program reads, which is the code side of the comparison `ActionManifest.diff` makes.
