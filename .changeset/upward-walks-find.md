---
"@effected/walker": minor
---

## Features

* `Walker.findUpwardWith` is the Effect form of the upward search, taking the new `FindUpwardWithOptions`

## Bug Fixes

* Under `matchBase` every match is reachable, including `*.js` and `x/../*.js`
* The literal fast path stats the compiled path and refuses dot segments that pass through a file or symlink
