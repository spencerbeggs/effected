---
id: "0026"
title: "@effected/git: GitShape gained members, so a hand-built Git test double no longer typechecks"
kind: breaking
shows: typed
applies:
  "@effected/git": ">=0.33.0"
detect: ["GitShape", "Layer\\.succeed\\(Git,"]
changesets: ["checkout-service-git"]
---

`GitShape`, the interface behind the `Git` service tag, gained members: `init`, `version`, `configAdd`, `fetchRefspecs`, `sparseCheckoutDisable`, `lfsInstall`, `lfsFetch` and `remoteHead`. A full object literal typed `GitShape`, or passed to `Layer.succeed(Git, ...)`, now fails to typecheck for the members it lacks.

- Build the double with `Git.makeTest(overrides)`, which fails each unstubbed member loudly with its name and so keeps compiling when the interface grows. Pass only the members the code under test calls.
- Where a double narrows the dependency with `Pick<GitShape, "..." | "...">`, nothing changes.
- A consumer that only calls `Git` members is unaffected.

Option objects on `checkout`, `clean`, `branchDelete`, `submoduleUpdate`, `sparseCheckoutSet` and the fetch family only gained optional fields. Every spawn now emits a Debug log entry, silent at the default log level; a program that raises its log level to Debug sees the redacted transcript.

Check the installed `.d.ts` for `GitShape` before matching on its members.
