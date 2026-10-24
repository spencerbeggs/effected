---
"@effected/app": minor
---

## Breaking Changes

### `App.layerTest` runs on an in-memory filesystem

`App.layerTest` now provides a real `@effected/memfs` volume instead of a deny-by-default platform stub. `AppDirs.ensure*` creates directories rather than dying, and the output type is widened to the new `AppTestServices` alias (`Xdg | AppDirs | Store | Cache | FileSystem | Path | MemoryFileSystemVolume`), so the platform services are visible in the layer's output rather than hidden.

* `@effected/memfs` is now a required peer dependency; install it alongside `@effected/app`.
* One `layerTest(...)` call is one volume. Composing `AppStore.layer` or `AppCache.layer` over a test layer is unsupported.
* Code that annotated the old `layerTest` output type must switch to `AppTestServices`.

### `AppConfig` carries the codec's error type

`AppConfigOptions<A, I, RR, CE = ConfigCodecError>` gains a fourth type parameter, and `codec` is typed `ConfigCodec<CE>`. `AppConfig.layer<Self, A, I, RR, CE, S>` inserts `CE` before `S`, so explicit type arguments must be updated. The tag check compares `ConfigFileShape<A, CE>`: a key declared over the default error rejects a codec that decorates its errors, which now type-checks when the key is declared with the matching `CE`.

## Features

* `App.layerTest` accepts `files?: MemoryFileSystemSeed` to pre-populate the volume.
* New export `AppTestServices`.
