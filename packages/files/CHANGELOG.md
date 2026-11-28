# @effected/files

## 0.4.0

### Features

- `AtomicFile.write` takes a `confineTo` option: a root directory the write must stay inside (#1452).

- The target must lie strictly below the root. A `..` escape, an absolute path outside the root, a sibling that shares the root's name prefix and the root itself are all refused.

- Every directory from the root down to the target's directory must be a real directory, not a symbolic link. The directory's real path must match the planned path under the root's real path.

- A symbolic link at the target is refused, unless `links: "replace"`, which replaces the link entry. `links: "follow"` combined with `confineTo` is a defect.

- The temp file is written in the target's real directory. The same checks run again immediately before the temp is opened, before the `chmod` that restores the mode, and immediately before the rename.

- A refusal is a `PlatformError` whose `SystemError` is tagged `PermissionDenied`, with `module: "AtomicFile"`. The error channel does not change.

- Some exposure remains, and the TSDoc says so. Core `FileSystem` has no directory handles, so each path call resolves its parents afresh:

- A parent swapped for a link between the last check and the temp's open makes the open create the temp, with the content, at the link's destination outside the root. The next check refuses and removes that temp.

- A link swapped in between the last check and the `rename` call can still redirect the rename.

- A parent moved aside after the temp is opened leaves the temp in the moved directory, still inside the root.

## 0.3.0

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.0

### Features

#### `AtomicFile.write` can replace a symlinked target

- `AtomicFile.write` takes a new optional `links` option, for a tool writing into a checkout nobody has reviewed, where a committed symlink could point a write outside the workspace. The default stays `"follow"`, so existing calls behave as before.

```ts
import { AtomicFile } from "@effected/files";

// The default: write the file the link points to, and keep the link.
yield* AtomicFile.write("/home/me/.zshrc", text);

// Replace the link with a regular file, leaving whatever it pointed to alone.
yield* AtomicFile.write("/repo/.config/tool.json", text, { links: "replace" });
```

- With `"replace"`, nothing is read, checked or created at the link's destination, whether the link is live or dangling, and the new file takes no mode from it
- It covers the target only: a symlink in a parent directory still resolves, so confine the path as well when the parents are not trusted
- The kit's writers built on `AtomicFile.write` (`PackageJsonFile`, `ConfigFile`, `ManagedSection`, `SchemaFile` and `effected schema build`) still follow links

### Documentation

- `AtomicDirectory.write` now documents its existing symlink behaviour: a symlinked root is replaced and the tree behind it is untouched, and a dangling-link root fails [#1250][#1250]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1250]: https://github.com/spencerbeggs/effected/pull/1250

## 0.1.0

### Features

#### `@effected/files`

- A new package for crash-safe writes over core `FileSystem` and `Path`, both required in `R` (#1234).

- `AtomicFile.write(target, content)` replaces a file through a synced temp file in the target's directory and a rename, so a crash leaves the old content or the new content and never a truncated file. A symlinked target keeps its link, an existing file keeps its permission bits, and a target the caller may not write is refused before any temp is created.

- `AtomicDirectory`, `AtomicDirectoryError` and `AtomicDirectoryFiles` live here now, moved from `@effected/store` with no shim. `AtomicDirectory.write` replaces a whole directory by staging it in a sibling and renaming it into place.

- The directory holding the target needs write permission: a read-only directory fails loudly, with no non-atomic fallback. A hard link is broken (the name gets a new inode), and ownership, ACLs and extended attributes of the old file are not kept. [#1237][#1237]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1237]: https://github.com/spencerbeggs/effected/pull/1237
