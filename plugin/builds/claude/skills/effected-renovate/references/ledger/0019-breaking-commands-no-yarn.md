---
id: "0019"
title: "@effected/commands: LocalExec's Launcher no longer includes yarn"
kind: breaking
shows: typed
applies:
  "@effected/commands": ">=0.22.0"
detect: ["LocalExec", "Launcher", "\"yarn\""]
changesets: ["commands-no-yarn"]
---

`Launcher` is `"npm"`, `"pnpm"` or `"bun"`, and `LocalExec`'s prefix table no longer has a yarn row, so `LocalExec.parse` does not recognise `yarn exec`, `yarn dlx` or `yarn run` argv. Remove the yarn cases where a hit builds or matches a launcher; the compiler flags a `"yarn"` literal typed as `Launcher`. A yarn argv parsed from user input now reads as an ordinary command, so check any code that relied on it being split. Check against the installed `.d.ts`, then run the typecheck and tests.
