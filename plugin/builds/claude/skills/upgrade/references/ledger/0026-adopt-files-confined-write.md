---
id: "0026"
title: "@effected/files: AtomicFile.write takes confineTo, a root the write must stay inside"
kind: adopt
shows: none
applies:
  "@effected/files": ">=0.4.0"
detect: ["AtomicFile\\.write"]
closes: ["#1452"]
changesets: ["fix-files-confined-write-confine-to"]
---

`AtomicFile.write(path, data, { confineTo: root })` refuses a write whose target is not strictly below `root`, or whose path from `root` down crosses a symbolic link, and re-checks just before the temp is opened, before the mode is restored and just before the rename. A refusal is the same `PlatformError` the call already fails with, its `SystemError` tagged `PermissionDenied` with `module: "AtomicFile"`, so the error channel does not change.

- **Adopt it** where code checks that a path stays inside a root and then writes it: drop the hand-rolled re-check before the write and pass `confineTo`. A link at the target is refused unless `links: "replace"`; `links: "follow"` with `confineTo` is a defect.
- **What it does not close.** Core `FileSystem` has no directory handles, so a link swapped in between the last check and the rename call itself can still redirect the rename. Read the TSDoc on the installed `.d.ts` for the full list before relying on it for a security boundary.
- The forwarding writers (`PackageJsonFile`, `ConfigFile`, `ManagedSection`, `SchemaFile`) do not take `confineTo` yet; call `AtomicFile.write` directly when you need it.
