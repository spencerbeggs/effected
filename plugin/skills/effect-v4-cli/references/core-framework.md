# Core CLI framework: Command, Flag, Argument

Loaded from `effect-v4-cli`. Covers the module inventory, PascalCase constructors, `Flag.Boolean`'s missing default, `Command.Environment`, and the two different `Command`s.

**Do not install `@effect/cli`.** Its latest release is on the `0.77.x` line, it declares
`peerDependencies: { effect: "^3.22.x", "@effect/platform": "^0.97.x",
"@effect/printer": "^0.51.x", "@effect/printer-ansi": "^0.51.x" }`, and its
only dist-tags are `latest` and `snapshot` — **no `beta` tag, so there is no v4
line**. It keeps shipping releases, so "it was updated recently" is not evidence
of v4 support; check the `effect` peer range, which has never crossed to `^4`.
Installing it drags an `effect@3` and the `@effect/platform` / `@effect/printer`
peer chain into a v4 package.

The CLI framework lives **in core**:

| you might reach for | what actually exists |
| --- | --- |
| `@effect/cli` | **`effect/cli`** |
| `@effect/platform` `HttpClient` | **`effect/http`** |

`effect/cli` exports twelve modules: `Argument`, `CliConfig`,
`CliError`, `CliOutput`, `Command`, `Completions`, `Flag`, `GlobalFlag`,
`HelpDoc`, `Param`, `Primitive`, `Prompt`. Note the vocabulary: an
option is a **`Flag`**, not an `Option` (the name `Option` belongs to the data
type).

## Constructors are PascalCase

Every `Flag`, `Argument`, `Prompt` and `GlobalFlag` constructor is a
PascalCase name (`cli/Flag.ts:60-449`, `Argument.ts:62-308`,
`Prompt.ts:871-1425`, `GlobalFlag.ts:112,131`). The lowercase spellings are
**`undefined`** on the namespace — a call type-errors, and a lookup probe
that prints `typeof Flag.string` and concludes "no string flag" is the
expensive misread. The roster:

| kind | constructors |
| --- | --- |
| `Flag` / `Argument` | `String`, `Int`, `Finite`, `Literals(["a", "b"])`, `ChoiceWithValue`, `Never`, `Boolean`\*, `Date`, `Path`, `File`, `Directory`, `Redacted`, `FileText`, `FileParse`, `FileSchema`, `KeyValuePair`\* (\* `Flag` only) |
| `Prompt` | `String`, `Int`, `Number`, `Confirm`, `Date`, `File`, `Hidden`, `List`, `Password`, `Select`, `MultiSelect`, `AutoComplete`, `Toggle` |
| `GlobalFlag` | `Action`, `Setting` |
| `Primitive` | `Choice`, `Never`, `isTrueLiteral`, `isFalseLiteral` |

Combinators stay lowercase (`Flag.optional`, `Flag.withHidden`,
`Argument.optional`, `Prompt.succeed`, `Prompt.makeTheme`). The same
convention applies to `Config` (`Config.String`/`Int`/`Boolean`/`Redacted`/
`Array`/`Record`…, `Config.mapEffect`) — the `effect-v4-idioms` and
`actions-inputs-outputs` skills show it.

`effect/http` carries `HttpClient` and `FetchHttpClient`.
**`FetchHttpClient.layer` is `Layer<HttpClient>` with no error channel and no
requirements** — it needs no platform package at all, so an HTTP-calling CLI does
not become integrated tier on the HTTP client's account.

## `Flag.Boolean` has no implicit `false` — omission is `MissingOption`

A boolean flag is **not** "false unless `--x` is passed". `Flag.Boolean(name)`
is `Param.Boolean(Param.flagKind, name)` with no fallback (`cli/Flag.ts:80`;
its own docstring at `:72` says *"Omission fails unless the flag is made
optional or given a fallback"*), and the shared flag parser fails with
`CliError.MissingOption({ option: name })` the moment the flag is absent from
the parsed args (`cli/Param.ts:2008`) — the primitive's type never
enters into it. So a bare `Flag.Boolean("force")` turns every invocation that
*omits* `--force` into a usage error, which is the opposite of what a
boolean flag is for. Spell the default:

~~~ts
import { Flag } from "effect/cli"

const force = Flag.Boolean("force").pipe(
  Flag.withDefault(false),               // or Flag.optional for Option<boolean>
  Flag.withDescription("Shorthand for --drift=allow"),
)
~~~

The trap this replaces: a plan and its first implementation both assumed the
default and shipped a CLI whose happy path — no flags at all — failed with
`MissingOption`. The test that pins it is the one that runs the command with
**no** flags and expects success.

## `Command.Environment` — the fact that decides your package tier

~~~ts
import type { Command } from "effect/cli"

// effect/cli/Command.ts:405 — the five members: FileSystem.FileSystem,
// Path.Path, Terminal.Terminal, ChildProcessSpawner, Stdio.Stdio
export type Environment = Command.Environment
~~~

Running a `Command` requires all five. **Core declares all five and implements
almost none of them for Node:**

| service | what core actually ships |
| --- | --- |
| `Path` | `Path.layer` — a real implementation (posix), `Path.ts:873` |
| `FileSystem` | only `FileSystem.layerNoop(partial)` — a deny-by-default **stub factory** (`FileSystem.ts:772`); never use it as a test double: a test's `FileSystem` is `@effected/memfs`'s `MemoryFileSystem.layer` |
| `Stdio` | `Stdio.layerTest(partial)` — **test-only**, by its name and its shape (`Stdio.ts:159`) |
| `Terminal` | **no layer at all** — `Terminal.ts` declares no `layer` export |
| `ChildProcessSpawner` | the contract and the `ChildProcess` command values, but **no layer** — see below |

So a CLI you actually intend to run needs `@effect/platform-node` for the real
`Terminal` / `FileSystem` / `Stdio` implementations. **That is what makes a CLI
package integrated tier**, not pure — and it is a structural fact about core, not
a naming detail you can design around. Budget for the dependency at design time;
do not discover it when the first `Effect.provide` fails to typecheck.

The corollary: **do not put a CLI in the same package as a pure library.** Split
the CLI into its own package so the library keeps its `effect`-only peer closure.

## Two different `Command`s — spawning lives in `effect/process`

`effect/cli`'s `Command` is the **CLI command declaration**. It is not
the process-spawning `Command`, and the shared name is the whole trap.

Spawning is **in core**, at `effect/process`, which exports exactly two
modules (`process/index.ts`):

| you want | v4 |
| --- | --- |
| `@effect/platform/Command` (build a command value) | **`effect/process` `ChildProcess`** — `ChildProcess.make("git", ["status"])`, plus `pipeTo` / `prefix` / `setCwd` / `setEnv` (`ChildProcess.ts:632,723,758,824,864`). **Warning:** `setEnv` never sets `extendEnv` — it merges into `options.env` and leaves `extendEnv` untouched, so the child's env is ONLY what you pass; it loses `PATH`/`HOME` and can't find its own binaries. To add vars on top of the parent env, use `Run.extendEnv` from `@effected/commands` (or pass `{ env, extendEnv: true }` to `make`, where `extendEnv` is a real option at `ChildProcess.ts:426`) |
| `@effect/platform/CommandExecutor` (run it) | **`effect/process` `ChildProcessSpawner`** — a `Context.Service` with `spawn` / `exitCode` / `string` / `lines` / `streamString` / `streamLines` (`ChildProcessSpawner.ts:262`) |

> **Do not hand-roll a `node:child_process` layer or a parallel
> `Command`/`CommandRunner` vocabulary.** One did survive four review gates in
> this repo before a source check found `effect/process` already
> declared the entire surface; the package was deleted the same day it was built.

What core does **not** ship is a **layer** for `ChildProcessSpawner` — the
contract is declared, the Node implementation is not (it arrives with
`NodeServices.layer` from `@effect/platform-node`). That is the same structural
class of gap as `Terminal`, with the same tier consequence for a CLI that
actually shells out. Requiring `ChildProcessSpawner` in `R` is free; taking
`@effect/platform-node` as a dependency edge is not.
