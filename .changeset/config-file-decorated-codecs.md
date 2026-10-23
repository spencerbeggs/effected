---
"@effected/config-file": minor
---

## Breaking Changes

### Codec errors flow through `ConfigFile`

The loader is now generic over the codec's error type `CE`, so a decorated codec (for example `EncryptedCodec` or `ConfigMigration`) surfaces its own errors instead of being narrowed to `ConfigCodecError`. `CE` is inferred from the codec and defaults to `ConfigCodecError`.

- `ConfigFileOptions`, `ConfigFileTestOptions`, `ConfigReadOptions` and `ConfigMigrationOptions` take `CE`.
- `ConfigFileShape<A, CE>` and the `ConfigLoadError`, `ConfigReadError`, `ConfigWriteError`, `ConfigEncodeError`, `ConfigSaveError` and `ConfigUpdateError` unions carry `CE` where they carried `ConfigCodecError`.
- `ConfigFile.Service<Self, A, CE = ConfigCodecError>`: a key declared without `CE` rejects a decorated codec at compile time.
- The type parameters of `ConfigFile.layer` are now `<Self, A, I, RR, CE, S>` and those of `testLayer` are `<Self, A, I, CE, S>`. A caller that passed `S` explicitly must update.
- `ConfigMigration.make<CE>` returns `ConfigCodec<CE | ConfigMigrationError>` instead of resetting the error to `ConfigCodecError`.
- `asConfigProvider` and `layerConfigProvider` take `CE`, and their error channel is `ConfigLoadError<CE>`.

### Behaviour changes (no compile error)

- `EncryptedCodec.parse` trims the envelope and decodes it with core `Base64`. Whitespace inside the envelope and missing padding now fail with `ConfigEncryptionError` phase `encoding`; whitespace around it, including a BOM or NBSP, is still accepted.
- A runtime without `globalThis.crypto` now fails `stringify` with a typed error (phase `encrypt`) when the IV is generated, instead of a `TypeError` defect.
- The `StringifyFailed` event now fires for every codec stringify failure, including `ConfigEncryptionError` and `ConfigMigrationError` from the decorators.

## Bug Fixes

- Security: a base64 decode failure no longer carries the decoder input. `ConfigEncryptionError.cause` is now a plain `Error` named `EncodingError` with only core's message, because core's error stores the whole input and a plaintext file handed to an encrypted codec would have leaked its contents into the typed error and the `ParseFailed` event. Code that checked the cause with `isEncodingError` or read its input no longer matches.
- Workspace-root detection uses a decode that never throws, instead of `JSON.parse`.
