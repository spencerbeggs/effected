---
"@effected/app": minor
---

## Documentation

A full staleness audit of the "effected" Claude Code plugin across all 29 skills, closing gaps left by the recent `@effected/npm` and `@effected/github-actions` breaking changes and by drift accumulated since the last audit.

* Fixed 7 falsified claims, including two code snippets that no longer compiled against the current API (a `DetachedProcessError` constructed as if it were still a single class rather than a per-reason union, and a `reason` table for an error that is now split into that union) and one confident assertion that a shipped API had been dropped on purpose — which had told readers to hand-roll `registryShortLabel`, `registryDisplayName` and `registryHost` themselves.
* Corrected 22 drifted `file:line` citations that had shifted as source files moved between Effect betas.
* Removed a citation to a module that never existed — `effect/SchemaError` is a class inside `Schema.ts`, not its own module.
* Closed 6 coverage gaps, including `@effected/github-references`, a shipped and published package that was previously absent from the entire plugin.
* Added 8 new package reference files, so every one of the kit's 30 publishable packages now has a corresponding skill reference.
* Re-verified version stamps across the plugin against the current `effect` pin, correcting all but 28 of 88 files that had carried a stale beta version (the remainder are deliberately left as-is because they attest to a runtime probe that was not re-run).
* Corrected the router's error-shape rule, which was already wrong for three error classes before this branch.
