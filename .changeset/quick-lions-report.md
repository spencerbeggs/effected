---
"@effected/runtime-resolver-cli": minor
---

## Features

Initial release of `@effected/runtime-resolver-cli` — the `runtime-resolver` binary, split out of `@effected/runtimes` so that API consumers of the library do not inherit the CLI's runtime dependencies.

Resolves one or more runtimes and prints a JSON envelope, so a CI job can pipe it into `jq`:

```bash
runtime-resolver --node ">=20" --node-phases active-lts --bun "^1.0.0" --pretty
```

* `--node`, `--bun`, `--deno` take semver ranges; each runtime resolves independently, so one failing does not suppress the others and every outcome appears in the `results` map.
* `--increments` (`latest`, `minor`, `patch`), `--node-phases`, `--node-default` / `--bun-default` / `--deno-default`, and `--node-date` to evaluate Node lifecycle phases at a given date.
* `--offline` resolves entirely from the bundled snapshot with no network IO.
* `--token` supplies a GitHub token, overriding `GITHUB_PERSONAL_ACCESS_TOKEN` and `GITHUB_TOKEN`.
* `--schema` prints the response JSON Schema, derived from the same schema the writer uses rather than maintained by hand.

Invalid flag values are rejected at parse time instead of by hand-rolled string checks, and the error entries in the envelope carry the structured fields of the underlying error (a rate limit's `retryAfter`, a not-found's `constraint`) rather than a prose message a caller has to parse back apart.

A bad invocation exits non-zero. Running the command with no runtime selected, or with an unrecognized `--node-phases` value, prints its complaint to stderr and then fails, so a CI job gating on the exit status no longer reads a typo as a pass. A resolution that simply matches nothing is not a usage error and still exits `0` with `ok: false` in the envelope, which is what keeps the two distinguishable.

The command is exported, so it can be embedded or driven with an explicit argument vector via `Command.runWith`.

Built on `effect/unstable/cli` — the CLI framework in `effect` core — with `@effect/platform-node` supplying the Node runtime. `@effect/cli` is not used; it has no Effect v4 release.
