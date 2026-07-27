---
"@effected/workspaces": patch
---

## Bug Fixes

`WorkspaceSnapshots`' internal cache key now separates the workspace root and
ref with a `\0` escape instead of a literal NUL byte. The literal byte made
`file` classify the source as binary, so `grep`/`ripgrep` silently skipped it.

## Documentation

Corrects two defects in the changelog published with `0.9.0`:

- **The `PublishabilityDetector` requirement claim was wrong.** `Workspaces.layer`,
  `layerWithGit` and `layerWithConfigDependencies` neither provide nor require a
  `PublishabilityDetector` — nothing inside any of them asks a publishability
  question, so their `R` stays `FileSystem | Path`. The requirement surfaces in
  the `R` of the consuming *operation* that asks (`VersioningStrategy.detect`,
  for example), which can be well past the layer-wiring site.
- **The recommended wiring was backwards.** The published note suggested
  `Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm))`.
  Since the composite doesn't require a detector, `Layer.provide` discards it —
  it never reaches the program's `R`. Wire it with `Layer.mergeAll` instead:

```ts
// Wrong — discards the detector, since the composite doesn't require one
const layer = Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm));

// Correct
const layer = Layer.mergeAll(Workspaces.layer(), PublishabilityDetector.layerNpm);
```

Also: `Workspaces.layer`'s internal `localExecLayer` now passes `scriptPrefix`
through when building an `ExecContext`, keeping pace with `@effected/commands`'
new script-runner prefixes.
