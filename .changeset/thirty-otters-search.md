---
"@effected/app": minor
---

## Features

### Construct index for the `effected-packages` skill

`plugin/skills/effected-packages/` now ships a generated construct index — one
reference file per kit package under `references/constructs/`, listing every
exported construct with its kind, a TSDoc-derived purpose, and intent
keywords for grep-based discovery. The skill's `SKILL.md` documents how to
search it:

```bash
grep -ri "table" plugin/skills/effected-packages/references/constructs/
```

This complements the existing per-package `references/*.md` files: the
package table routes when you know *which* package to reach for, the
construct index routes when you know *what* you want done but not what it's
called.
