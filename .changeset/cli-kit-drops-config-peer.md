---
"@effected/cli-kit": minor
---

## Breaking Changes

### `@effected/config-file` is no longer a peer

`ConfigIssueRenderer.render` now takes the structural `ConfigIssueSource` (`{ readonly issue?: unknown }`) instead of `ConfigValidationError`, so the optional `@effected/config-file` peer is dropped (#1183). A `ConfigValidationError` is still assignable, so calls compile unchanged; remove the peer from your manifest if nothing else needs it.

### `CliUi.prompt` overloads

With a real `otherwise` (any value but `undefined`) the error type is `Cancelled` alone, since a non-interactive run answers and cannot fail (#1199). A `catchTag("NotInteractive")` after such a prompt is now a type error: delete it. Without `otherwise`, or with `{ otherwise: undefined }`, `NotInteractive` stays in the error type.

## Features

* `CliExit.report(code, line)` writes one stderr line, records the exit code and succeeds, for hook-style commands that must say why they exit non-zero without failing (#1178).
* `CliExit.reportCause(cause, codeOf)` reports a failure cause as one sanitized stderr line, `<code> <tag>: <message>`, and records the code you choose for it. An interrupt-only cause re-interrupts and writes nothing.
* `Fmt.suggest` delegates to `@effected/source`'s `EditDistance`, a new dependency.

## Dependencies

| Dependency        | Type               | Action  | From | To |
| :---------------- | :----------------- | :------ | :--- | :-- |
| @effected/source  | dependency         | added   | —    | workspace:^ |
| @effected/config-file | peerDependency | removed | workspace:^ | — |
