# The CI gate

`schemastore check` is the identical walk to `build` with no writes: it
reports what a build would do under the same flags and exits under the same
conditions — plus one more: it exits `1` whenever a build would write
anything, because a committed document that differs from what the config
generates (or is missing) is stale. That makes it the CI gate — a repository
with three broken documents learns all three in one run — and it replaces
the drift test every generator script used to carry.

## Scripts and turbo

```json
{
  "scripts": {
    "schema:build": "schemastore build",
    "schema:check": "schemastore check"
  }
}
```

Pass the config path as the positional argument when it does not sit where
upward discovery finds it (`schemastore build lib/scripts/schemastore.config.ts`).
In a turbo pipeline, make `build` depend on `schema:build` so the committed
documents are regenerated before anything bundles against them, and declare
the generated files as `schema:build`'s outputs:

```json
{
  "tasks": {
    "schema:build": { "outputs": ["schemas/**"] },
    "build": { "dependsOn": ["schema:build", "^build"] }
  }
}
```

Locally, `schema:build` regenerates and you commit the result; in CI,
`schema:check` proves the committed documents match the schemas. A `check`
that reports `would write` means someone changed a schema and did not run
the build; it fails with ``N document(s) are stale; run `schemastore build` and commit the result.`` at exit `1`.

## Commands and flags

```text
schemastore build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore check [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
```

- `--drift` and `--on-drift` override the config's `drift` block for one
  run; the report names the effective policy and its source (`config` or
  `flag`).
- `--force` is sugar for `--drift=allow`.
- `--format=json` emits one JSON document on stdout and moves human text to
  stderr, so stdout stays parseable.
- A bare `schemastore` or `--help` prints help and exits `0`.

## Exit codes

| code | meaning |
| --- | --- |
| `0` | success, including drift under `--on-drift=warn` |
| `1` | drift under `--on-drift=error`, a gate failure (lint warning, ajv strict finding), or — for `check` — any document `build` would write |
| `2` | config not found, failed to load, or failed `defineConfig` validation |
| `3` | infrastructure failure |
| `64` | usage error (an unknown flag, a bad literal) |

A gate failure exits `1` under either `--on-drift` value and is not
overridable by `--force`. When both a gate failure and drift occur, the gate
failure is what the run reports as its error.

## The JSON report

`--format=json` writes one object with stable key order:

```json
{
  "mode": "check",
  "configPath": "/abs/path/schemastore.config.ts",
  "drift": { "policy": "semantic", "onDrift": "error", "source": "config" },
  "schemas": [
    {
      "$id": "https://…/my-tool-1.2.json",
      "path": "/abs/path/schemas/my-tool-1.2.json",
      "name": "my-tool",
      "version": "1.2",
      "published": true,
      "change": "contract",
      "verdict": "drift",
      "outcome": "drift",
      "nextVersion": "1.3",
      "findings": []
    }
  ],
  "catalog": [{ "name": "my-tool", "path": "/abs/path/schemas/catalog-entry.json", "outcome": "held" }],
  "drifted": true,
  "gateFailed": false,
  "wrote": false
}
```

- `change` — `none` | `created` | `annotations` | `contract`.
- `verdict` — `write` | `drift`; a schema written under `--on-drift=warn`
  keeps `drift`.
- `outcome` — `written` | `unchanged` | `would-write` | `drift` | `held` |
  `gate-failed`. `outcome` is the authoritative "was/would the file be
  touched" answer; never infer it from `change`.
- `nextVersion` — present only for a contract change on a versioned schema.
- `findings` — every finding, blocking or not: `source`, `severity`,
  optional `check`, `path`, `message`.
- Catalog outcomes are `written` | `unchanged` | `would-write` | `held`.

## The GitHub step summary

When `GITHUB_STEP_SUMMARY` is set, both commands append a markdown table
(schema · version · published · change · outcome) and the drift verdict. It is
read through Effect `Config`, so an empty value counts as unset. A failure to
write the summary is logged and never fatal. Nothing in the consumer has to
opt in; a `schema:check` step on a GitHub runner gets the table for free.

## The dependency-bump posture

An automated dependency-bump workflow (an `effect` advance that changes what
`toJsonSchemaDocument` emits, say) should run `schemastore build
--on-drift=warn`: the bump lands, the drifting schema is rewritten, exit code
is `0`, and the step summary and stderr shout one warning per drifting
schema. A human then reads the warning and decides whether the change
warrants a version bump. Under the default `--on-drift=error` the same
workflow would fail with nothing written, which is right for a hand-run build
and wrong for a bot.

## Local versus CI

- Locally: `pnpm schema:build`, read the lines, commit what changed. A
  `DRIFT` line means bump the version in the config and build again.
- In CI: `pnpm schema:check`; a non-zero exit fails the job. Read the
  human output in the job log or the step summary; parse `--format=json`
  from stdout only when a later step needs the data.
- Both run on the consumer's own `effect` and `@effected/schemastore`
  instances through `jiti`, so a config that type-checks in the editor loads
  the same way in the CLI.
