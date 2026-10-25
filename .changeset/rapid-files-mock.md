---
"@effected/memfs": minor
---

## Features

Closes #901.

### `layerWithPath`

`MemoryFileSystem.layerWithPath(seed?, options?)` is `layerWith` with core's `Path.layer` merged in, so one layer provides both `FileSystem` and `Path`. It is available on both layers.

### Spies

A new `spies` option takes the same keys as `faults`, but each handler only observes: the call always goes ahead and anything the spy returns is discarded. A spy on a core member also sees the members derived from it, so a `writeFile` spy records `writeFileString` calls too. A spy must not throw; inject failures through `faults`.

```ts
const reads: Array<string> = [];
const Volume = MemoryFileSystem.layerWith(
  { "/config.json": "{}" },
  { spies: { readFile: (path) => void reads.push(path) } },
);
```

### `wrapFile`

`MemoryFileSystem.wrapFile(file, overrides)` decorates a `File` returned by `open`, forwarding every member and letting a handler replace one, on the same terms as a fault. Return it from an `open` fault to decorate every handle the filesystem opens.

### Manual watch events

`watchEvents: "manual"` stops the volume's own mutations from publishing watch events. The handle's `emit(path, event)` then delivers exactly the events a test chooses, and `watcherCount()` reports how many watchers are subscribed.

### Sync `readDirectory` with file types

The sync port's `readDirectory(path, { withFileTypes: true })` returns dirents, matching `readdirSync`. A symlink inside the directory reports `isSymbolicLink()` rather than its target's kind.

### Windows path spellings on the ports

Both ports accept `pathStyle: "win32"`. Backslashes become slashes and a drive root `C:` maps onto the volume's `/C:` directory. Errors keep the caller's own spelling.

## Documentation

- The README explains how volume sharing follows layer builds (`Effect.provide`, `@effect/vitest`'s `layer`, and handles) and lists what to expect when migrating a suite from temp directories or hand-rolled doubles.
