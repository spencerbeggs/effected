---
id: "0003"
title: "ManagedSection.make, layer and layerWith now require Path as well as FileSystem"
kind: breaking
shows: typed
applies:
  "@effected/templates": ">=0.18.0"
detect: ["ManagedSection\\.(make|layer|layerWith)"]
changesets: ["sections-write-atomically"]
---

`ManagedSection.make`, `ManagedSection.layer` and `ManagedSection.layerWith` now carry `Path` in their requirement channel next to `FileSystem`. A program that provided only a file system fails to typecheck where the layer is built or provided.

1. **Provide `Path`.** At the edge, merge a path layer with the file-system layer (`Layer.mergeAll(<fs layer>, <path layer>)`). In tests, `@effected/memfs` supplies both.
2. **Do not widen the service.** `Path` is discharged at the edge, as `FileSystem` already was; no library code should take it on.

Check the installed `.d.ts` for the exact `R` of each member.
