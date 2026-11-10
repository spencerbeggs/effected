# @effected/source

## 0.5.0

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.4.0

### Features

- `LineDiff` computes a line-level diff between two texts, for rendering changes in reports and terminals. [#1233][#1233]

* `EditDistance` provides pure Levenshtein distance and "did you mean" suggestions as plain functions with no Effect and no IO (#1190). `EditDistance.suggest(input, candidates, options?)` returns the candidates within `maxDistance` edits (`2` by default, or a function of the input). [#1237][#1237]

```ts
import { EditDistance } from "@effected/source";

EditDistance.suggest("stauts", ["status", "stack", "build"]); // => ["status"]
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1233]: https://github.com/spencerbeggs/effected/pull/1233

[#1237]: https://github.com/spencerbeggs/effected/pull/1237

## 0.3.0

### Maintenance

- Upgrades core Effect library dependencies to v4.1.2 [#1229][#1229]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1229]: https://github.com/spencerbeggs/effected/pull/1229

## 0.2.0

### Breaking Changes

- Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported. [#1168][#1168]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1168]: https://github.com/spencerbeggs/effected/pull/1168

## 0.1.1

### Other

- Force release of package to validate OIDC connection

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

- First release. `@effected/source` holds source-text positions as plain values, with no runtime dependencies.

- `LineIndex` converts between offsets and LSP-style line and character positions, deriving line ends from the text. Its line-break rule is the LSP one: LF, CRLF and a bare CR each end a line.

- `SourceIndex`, a structural interface for index-shaped values, so packages can type a cross-package field without depending on the `LineIndex` class.

- The structural range and diagnostic shapes the kit's format packages (`jsonc`, `toml`, `yaml`, `markdown`) now share.

- `LineIndex.locationOf` validates the length it is given instead of trusting it. [#1151][#1151]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1151]: https://github.com/spencerbeggs/effected/pull/1151
