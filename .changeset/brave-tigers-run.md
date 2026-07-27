---
"@effected/commands": minor
---

## Breaking Changes

`ExecContext` gains a required `scriptPrefix: ReadonlyArray<string>` field —
the argv prefix that runs a `package.json` script (`["npm", "run", "--"]`,
`["pnpm", "run"]`, `["yarn", "run"]`, `["bun", "run"]`). Any code constructing
`ExecContext.make(...)` directly must now supply it; code going through
`LocalExec.layer(launcher)` gets it automatically.

```ts
// Before
ExecContext.make({ label: "pnpm", prefix, dlxPrefix, directory });

// After
ExecContext.make({ label: "pnpm", prefix, dlxPrefix, scriptPrefix, directory });
```

## Features

- `LocalExec.scriptPrefix(launcher)` returns just the script-runner prefix for
  a launcher.
- `LauncherPrefixes` is now exported, so a consumer can hold or pass the whole
  `{ prefix, dlxPrefix, scriptPrefix }` record without re-deriving its shape.
- `ExecContext.applyScript(command)` runs a `package.json` script by name,
  mirroring `apply` and `applyDlx`.

npm's script prefix is `["npm", "run", "--"]`, not `["npm", "run"]` — a bare
`npm run <script> --flag` silently claims `--flag` for npm itself instead of
forwarding it to the script; the other three launchers forward post-script
arguments without the extra `--`.

## Documentation

`Run`'s class remarks now document that `Run.text` and `Run.lines` trim
whitespace (not just a trailing newline), alongside the existing exit-code
split between `Run.collect`/`exitCode`/`succeeds` (result-based) and
`Run.text`/`Run.lines` (typed-failure-based). Output where leading whitespace
is data — `git status --porcelain`'s status column — should be read from
`Run.collect`'s untrimmed `stdout` instead.
