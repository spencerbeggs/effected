---
"@effected/files": minor
---

## Features

### `AtomicFile.write` can replace a symlinked target

`AtomicFile.write` takes a new optional `links` option, for a tool writing into a checkout nobody has reviewed, where a committed symlink could point a write outside the workspace. The default stays `"follow"`, so existing calls behave as before.

```ts
import { AtomicFile } from "@effected/files";

// The default: write the file the link points to, and keep the link.
yield* AtomicFile.write("/home/me/.zshrc", text);

// Replace the link with a regular file, leaving whatever it pointed to alone.
yield* AtomicFile.write("/repo/.config/tool.json", text, { links: "replace" });
```

* With `"replace"`, nothing is read, checked or created at the link's destination, whether the link is live or dangling, and the new file takes no mode from it
* It covers the target only: a symlink in a parent directory still resolves, so confine the path as well when the parents are not trusted
* The kit's writers built on `AtomicFile.write` (`PackageJsonFile`, `ConfigFile`, `ManagedSection`, `SchemaFile` and `effected schema build`) still follow links

## Documentation

* `AtomicDirectory.write` now documents its existing symlink behaviour: a symlinked root is replaced and the tree behind it is untouched, and a dangling-link root fails
