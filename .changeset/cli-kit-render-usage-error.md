---
"@effected/cli-kit": minor
---

## Features

### A program can render a usage error as its own document

`CliRuntime.main` takes `renderUsageError: { command, render }`. When the parser rejects an invocation, `render({ errors, commandPath, setting })` may return a document (a JSON envelope under `--format json`, say): it is printed alone on stdout, the help and errors go to stderr, and the exit code stays `usageExitCode`. Returning `undefined` keeps the default output byte for byte. It is never called for `--help`, `--version` or a bare invocation.

`setting(flag)` reads a global `Setting` flag's value as core would provide it on the failing command path, through core's own parser: `Option.none()` when the setting is not in scope for that subcommand, its value is rejected, a local flag shares its name, or its parse is asynchronous.

```ts
CliRuntime.main(program, {
  platform,
  renderUsageError: {
    command: cli,
    render: ({ errors, setting }) =>
      Option.contains(setting(Format), "json")
        ? JSON.stringify({ ok: false, usage: errors.map(String) })
        : undefined,
  },
});
```

## Documentation

* `CliUi.live` no longer lists `Stream.merge` among the streams that subscribe too late for an event published at once: `merge` starts both sides immediately, so a merged `Stream.fromPubSub` is subscribed in time; `buffer` and a concurrent `flatMap` still subscribe late
