# @effected/cli

The `effected` command: a front end of the `effected` tool, on `effect/cli` and
`@effected/cli-kit`. Application package, no library tier. A consumer installs
`@effected/plugin`, not this package. (The CLI presentation library is
`@effected/cli-kit`.)

## Import

```ts
import { CLI_VERSION, main, makeRootCommand, run } from "@effected/cli";
import { main } from "@effected/cli/main";
```

## Core API

- **`makeRootCommand(deps)`** — builds the `effected` command tree from its
  dependencies (`SchemaCommandDeps`); there is no `rootCommand` constant.
  `--version`, `--help` and the `schema` subcommands.
- **`main(options?)`** — runs the program on the Node services and owns the
  process. `options.distribution` names the carrier the bin was installed
  through; `--version` then ends with `via <name> <version>`.
- **`run(...)`** — the same program over a platform layer you supply, so a test
  drives it in-process (over `@effected/memfs`) without spawning.
- **`CLI_VERSION`** — this package's own version, replaced at build.

The `effected` bin is declared here and again by `@effected/plugin`, which
passes its own `distribution`. Shared logic belongs in `@effected/engine`.

## `effected schema`

```text
effected schema build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json] [--ignore-version-mismatch]
effected schema check [config] [same flags]
effected schema validate <payload.json> [config] [--schema <path|$id|url>] [--format=human|json] [--ignore-version-mismatch]
```

Run next to a `schemastore.config.{ts,mts,js,mjs}` (found by walking upward) or
pass its path; none found is exit `2`. The config default-exports
`defineSchemastore(...)` from `@effected/plugin`.

- **`build`** generates, gates (structural lint plus ajv strict mode), applies
  the drift table and writes what passes. A gate failure, or drift under
  `onDrift: "error"`, writes nothing.
- **`check`** is the same walk with no writes and the CI gate: it also exits `1`
  when a build would write anything or an orphaned output sits on disk. A
  person sees a coloured line diff of each changed document; the JSON report
  carries `diff.hunks` and `diff.unified`.
- **`validate`** checks a payload against the document it names. Each finding
  has `location: { file, line, column }`, one-based, from the payload text.
- **`--format`** defaults to JSON under `--agent` and to human text otherwise;
  JSON writes one document to stdout and human text moves to stderr.
- **`--force`** is `--drift=allow` for one run and is refused beside any other
  `--drift`.
- **Version mismatch.** When the config's `@effected/schemastore` is not the
  tool's, the command fails with exit `2` naming both versions. Align them
  through the catalog; `--ignore-version-mismatch` runs on with a warning.

| published | policy | no change / created | annotations | contract |
| --- | --- | --- | --- | --- |
| `false` | any | write | write | write |
| `true` | `allow` | write | write | write, loud warning |
| `true` | `semantic` | write | write | drift |
| `true` | `strict` | write | drift | drift |

Exit codes: `0` success (including drift under `onDrift: "warn"`); `1` drift
under `error`, a gate failure, a blocked catalog merge, a stale or orphaned
output under `check`, or a payload that does not conform; `2` config not found
or failed to load, a version mismatch, or an unreadable payload; `3`
infrastructure failure; `64` usage error. Failures arrive on stderr as the
`@effected/cli-kit` standard report; gate on the exit code.
