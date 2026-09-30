---
"@effected/claude-code-plugin": minor
---

## Features

* Added an `effect-v4-testing` memfs reference covering memfs forms, ports and fault injection
* Reviewer agents flag hand-rolled filesystem doubles
* One rule across the skills and agents: use memfs, never `layerNoop`, for a filesystem double
* CLI, actions and package references teach the memfs-based test layers

## Maintenance

* Regenerated the construct index for the new memfs surface
