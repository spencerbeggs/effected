---
"@effected/glob": minor
---

## Features

* `GlobPattern.enumerationRoots` gives one `EnumerationRoot` (`prefix`, `deep`, `spellings`) per brace alternative so a walker reads only the directories a pattern can match.

## Documentation

* `GlobPattern` notes that `dot` defaults to `false`, while Vitest matches dotfiles.
