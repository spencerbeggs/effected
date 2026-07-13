# @effected/runtime-resolver-cli

[![npm](https://img.shields.io/npm/v/@effected%2Fruntime-resolver-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/runtime-resolver-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

The `runtime-resolver` binary. Resolves semver-compatible Node.js, Bun and Deno versions through [`@effected/runtimes`](../runtime-resolver) and prints a JSON envelope, so a CI job can pipe it into `jq` and pick out a version to install. Every runtime is resolved independently and concurrently, so one failing does not suppress the others — a single invocation can report Node from the offline snapshot and Bun as rate-limited in the same response.

## Why @effected/runtime-resolver-cli

This package exists to be the tier-3 half of a two-package split, and that is the whole reason for its existence. A CLI built on `effect/unstable/cli` needs `FileSystem`, `Path`, `Terminal`, `Stdio` and a process spawner — services `effect` core declares but does not implement for Node. `@effect/platform-node` supplies them, and it is a heavyweight dependency to inflict on somebody who only wanted to ask what the newest active-LTS Node is from library code. So the binary lives here, carries `@effect/platform-node` as a regular dependency, and the library next door carries none: install `@effected/runtimes` and the platform adapter never enters your tree.

The other rule this CLI holds is that a usage error is a *failure*, not a printed complaint. No runtime selected, or an unrecognized `--node-phases` value, exits **1**. A resolution that matched nothing is data: it exits **0** with `ok: false` in the envelope, because "what Node versions match `>=999`?" got a real answer. Collapsing the two in either direction means a CI job gating on the exit status reads a typo as a pass.

## Install

```bash
npx @effected/runtime-resolver-cli --node ">=20"
```

```bash
npm install --global @effected/runtime-resolver-cli
```

```bash
pnpm add -g @effected/runtime-resolver-cli
```

Requires Node.js >=24.11.0. Everything it needs — `effect`, `@effect/platform-node` and the resolver library — is a regular dependency, as a tool's stack should be. There are no peer dependencies to satisfy.

## Quick start

```bash
runtime-resolver --node ">=20" --node-phases active-lts --pretty
# {
#   "$schema": "https://raw.githubusercontent.com/spencerbeggs/effected/main/packages/runtime-resolver-cli/runtime-resolver.schema.json",
#   "ok": true,
#   "results": {
#     "node": {
#       "ok": true,
#       "source": "api",
#       "versions": ["<newest active-LTS Node matching >=20>", "..."],
#       "latest": "<the newest of them>",
#       "lts": "<the newest LTS pick>"
#     }
#   }
# }
```

Pipe it into `jq` to pull out the one field a workflow actually wants:

```bash
runtime-resolver --node ">=20" | jq -r '.results.node.latest'
# the newest matching version, one line, ready to feed to a setup-node step
```

Several runtimes in one invocation are resolved concurrently:

```bash
runtime-resolver --node ">=22" --bun "^1.0.0" --deno "^2.0.0"
# one entry per runtime under `results`, each with its own `ok`
```

## Flags

| Flag | Type | Meaning |
| ---- | ---- | ------- |
| `--node <range>` | semver range | Resolve Node.js versions matching the range. |
| `--bun <range>` | semver range | Resolve Bun versions matching the range. |
| `--deno <range>` | semver range | Resolve Deno versions matching the range. |
| `--node-phases <list>` | comma-separated | Node lifecycle phases to accept: `current`, `active-lts`, `maintenance-lts`, `end-of-life`. Defaults to `current,active-lts`. |
| `--increments <value>` | `latest` \| `minor` \| `patch` | Granularity at which matches are grouped. Defaults to `latest`. |
| `--node-default <range>` | semver range | The range whose newest match becomes Node's `default` field. |
| `--bun-default <range>` | semver range | The same, for Bun. |
| `--deno-default <range>` | semver range | The same, for Deno. |
| `--node-date <date>` | date | Evaluate Node's lifecycle phases at this date instead of now. |
| `--offline` | boolean | Use the bundled snapshot only; perform no network IO. |
| `--pretty` | boolean | Indent the JSON output. |
| `--schema` | boolean | Print the JSON Schema of the response and exit. |
| `--token <token>` | redacted string | GitHub token; overrides `GITHUB_PERSONAL_ACCESS_TOKEN` and `GITHUB_TOKEN`. |

At least one of `--node`, `--bun` and `--deno` is required. `--increments` is validated at parse time, so an invalid value never reaches the resolver.

Node needs no credentials — its feeds are unauthenticated. Bun and Deno read GitHub's REST API, which works anonymously at a much lower rate limit; supply `--token`, or set `GITHUB_PERSONAL_ACCESS_TOKEN` or `GITHUB_TOKEN` in the environment. `--offline` skips the network entirely for all three.

## Output

The envelope is a schema, not an ad-hoc object literal, which is what lets `--schema` derive the published JSON Schema from the same source of truth the writer uses:

```bash
runtime-resolver --schema
# the JSON Schema for the response envelope, on stdout
```

Its shape:

- `$schema` — a URL naming the published schema.
- `ok` — `true` only when every requested runtime resolved.
- `results` — one entry per requested runtime, keyed `node`, `bun` or `deno`.

A successful entry carries `ok: true`, `source` (`"api"` for a live feed, `"cache"` for the bundled snapshot), `versions` (every match, newest first), `latest`, and — where they apply — `lts` and `default`. Provenance is honest: a run that fell back to the snapshot after a network failure says `"cache"`.

A failed entry carries `ok: false` and an `error` object whose `_tag` is the stable thing to branch on, with the error's own structured fields beside it — `constraint` on a `NoMatchingVersionError`, the retry information on a `RateLimitError`. There is no prose `message` to parse back apart.

## Exit codes

| Code | When |
| ---- | ---- |
| `0` | The command ran. Every runtime may have resolved (`ok: true`), or some may not have (`ok: false`) — either way the question was answered. |
| `1` | A usage error: no runtime selected, an unrecognized `--node-phases` value, or an `--increments` value outside `latest`, `minor` and `patch`. Nothing is printed on stdout. |

Gate on the exit status for "did I invoke this correctly", and on `.ok` for "did it find anything".

## Embedding

The command is exported, so it can be embedded in a larger CLI or driven with an explicit argument vector — which is how the test suite exercises it, without spawning a process:

```ts
import { command } from "@effected/runtime-resolver-cli";
import { Command } from "effect/unstable/cli";

const run = Command.runWith(command, { version: "1.0.0" });
// run(["--node", ">=20", "--pretty"]) yields the effect the binary runs.
```

The envelope schemas (`CliResponse`, `CliRuntimeResult`, `CliRuntimeSuccess`, `CliRuntimeFailure`, `CliErrorDetail`) and `serializeError` are exported too, so a consumer parsing the output can decode it with the same schema that produced it.

## License

[MIT](LICENSE)
