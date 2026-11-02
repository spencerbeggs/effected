---
id: "0040"
title: Adopt effect/Glob for matching a path against a pattern
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["picomatch", "minimatch", "micromatch"]
---

Core `effect/Glob` is a compiled pattern (`Glob.make`, `Glob.match`, `Glob.escape`), the matcher behind `FileSystem.glob`.

Where to look: `picomatch`, `minimatch` or `micromatch` used only to test a path. Its dialect is not theirs (no extglobs, `/` separators, backslash escapes, and the case rule in entry 0017), so compare behaviour on your real patterns before switching. `@effected/glob` remains the kit's matcher for its own surface. Check the installed `effect/dist/Glob.d.ts`.
