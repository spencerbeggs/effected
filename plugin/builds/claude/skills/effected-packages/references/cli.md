# @effected/cli

The `effected` command: a front end of the `effected` tool, on `effect/cli` and
`@effected/cli-kit`. Application package, no library tier. A consumer installs
`@effected/plugin`, not this package. (The CLI presentation library is
`@effected/cli-kit`.)

## Import

```ts
import { CLI_VERSION, main, rootCommand, run } from "@effected/cli";
import { main } from "@effected/cli/main";
```

## Core API

- **`rootCommand`** — the `effected` command tree. `--version` and `--help` only.
- **`main(options?)`** — runs the program on the Node services and owns the
  process. `options.distribution` names the carrier the bin was installed
  through; `--version` then ends with `via <name> <version>`.
- **`run(...)`** — the same program over a platform layer you supply, so a test
  drives it in-process (over `@effected/memfs`) without spawning.
- **`CLI_VERSION`** — this package's own version, replaced at build.

The `effected` bin is declared here and again by `@effected/plugin`, which
passes its own `distribution`. Shared logic belongs in `@effected/engine`.
