# @effected/source

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
