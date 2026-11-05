---
"@effected/templates": minor
---

## Breaking Changes

`ManagedSection.layer` and `ManagedSection.layerWith` now require `Path` beside `FileSystem` in `R` (#1234). A sync replaces the file through a temp file and a rename, so a crash leaves the old text or the new text, never a truncated file.

Provide a `Path` layer next to your platform `FileSystem`:

```ts
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Layer } from "effect";

const live = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
```

The directory holding a managed file now needs write permission, since the write goes through a temp file beside it.

## Dependencies

| Dependency     | Type       | Action | From | To      |
| :------------- | :--------- | :----- | :--- | :------ |
| @effected/files | dependency | added  | —    | ^0.1.0 |
