---
"@effected/lockfiles": minor
---

## Features

`Lockfile.parse` takes a new `configOnly` option for pnpm lockfiles. Pass `configOnly: true` when the workspace root has no `package.json`, and a stream holding only the env preamble and an empty main document reads as an empty lockfile, with `lockfileVersion` taken from the preamble. pnpm 11 and 12 write that stream for a workspace that declares only `configDependencies`. Closes #845.

```ts
const lockfile = yield* Lockfile.parse(content, { format: "pnpm", configOnly: true });
```

Without the option, that stream still fails with `LockfileFramingError` and reason `"noLockfileDocument"`. pnpm writes the same bytes when a first install fails after its config dependencies are installed, so only the caller can tell the two apart. The option changes nothing else, and non-pnpm formats ignore it.

## Breaking Changes

`Lockfile.parse` now fails a pnpm YAML stream of more than two documents with `LockfileFramingError` and reason `"unexpectedDocuments"`, where it previously read the last document regardless of how many preceded it. This is the same framing rule `PnpmEnvLockfile` already enforced — both readers now share one document splitter, so a malformed or unexpectedly multi-document pnpm lockfile is rejected consistently everywhere it's parsed.
