---
"@effected/config-file": minor
---

## Features

### `ConfigResolver.upwardWalk` takes a per-directory candidate list

`upwardWalk` now accepts `filenames` alongside the existing `filename`: every name in the list is probed at one ancestor directory before the walk ascends, so a "config-dir" convention (`.app.toml`, then `app.toml`, then `.config/app.toml`, all at one level) can be expressed as one resolver instead of chaining several — a chain of separate `upwardWalk` calls exhausts one filename to the filesystem root before starting the next, which cannot express this ordering (#644).

```ts
ConfigResolver.upwardWalk({ filenames: [".app.toml", "app.toml", ".config/app.toml"] });
```

### `ConfigResolver.resolveMatch` and `ConfigMatch`

Every built-in resolver now optionally implements `resolveMatch`, reporting *how* a file was found rather than only the path: the anchor directory it resolved against, and the `subpath`/`filename` entry that matched. `ConfigFile.discover` threads the result onto `ConfigSource.match`, so a consumer resolving a project root, or distinguishing which candidate matched in an `upwardWalk` with several names, no longer has to string-match the discovered path's tail. Multiple `upwardWalk` calls in one chain can also each take a distinct `name` so they're distinguishable by resolver name too (#630).

## Bug Fixes

- `ConfigCodecError` gains an optional `path` field, threaded by `ConfigFile`'s read/write pipeline whenever a codec failure is re-raised for a file it resolved — so a discovery pass over several candidates still names the file that failed. `message` deliberately does not include the path: a wrapper that renders its own message almost always names the file too, and a message carrying the path would print it twice (#632).
