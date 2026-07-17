---
"@effected/git": minor
---

## Features

### `Git.fetchAny` — fetch a ref without knowing whether it's a tag

`Git.fetchAny(cwd, { ref, remote?, depth? })` fetches a ref that might be a tag or a branch without the caller needing to know which. It tries the tag form first (`git fetch [--depth <n>] <remote> tag <ref>`), and falls back to the plain form (`git fetch [--depth <n>] <remote> <ref>`) when the tag attempt fails with `UnknownRefError` or any `GitCommandError`. A `NotARepositoryError` from the tag attempt propagates immediately rather than retrying. When both attempts fail, the plain fetch's error is the one surfaced.

```ts
import { Git } from "@effected/git";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const git = yield* Git;
	yield* git.fetchAny("/repo", { ref: "v1.2.3" });
});
```

### `GitShape` is now exported

The `Git` service's interface is exported as `GitShape`, so a consumer can type a variable, field or test fake holding the service without re-declaring the surface: `Layer.succeed(Git, fake)` accepts any `GitShape`.

## Documentation

`NameStatusEntry.status` decodes git's one-letter diff codes using this package's own spelling — notably `"typeChanged"` and `"broken"`, not porcelain's `"typechange"` — now called out explicitly in the TSDoc for consumers mapping onto an existing enum that follows porcelain's spelling.
