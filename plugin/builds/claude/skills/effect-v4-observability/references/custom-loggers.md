# Custom loggers: format with `Logger.make`, route with `withConsoleLog`

A `Logger<Message, Output>` is one method, `log(options): Output` (`Logger.ts:71`).
Keep **formatting** and **routing** as two loggers, because core already ships
the routing half:

```ts
const format = Logger.make((o) => `${o.logLevel}: ${String(o.message)}`)   // Logger<unknown, string>
const toStdout = Logger.withConsoleLog(format)                            // Logger<unknown, void>
const toStderr = Logger.withConsoleError(format)
program.pipe(Effect.provide(Logger.layer([toStdout])))
```

## Routing is already written

`Logger.withConsoleLog` / `withConsoleError` (`Logger.ts:286,331`) read the
`Console` service off the fiber and call `console.log` / `console.error` with
`self.log(options)` — which is also how you **reuse a logger inside another**:
call `inner.log(options)`, never re-render.

The trap is writing that routing line by hand —
`Logger.make((o) => o.fiber.getRef(Console.Console).log(render(o)))` — which
duplicates core and drifts from it. The built-ins are the same composition:
`consoleLogFmt` / `consoleStructured` / `consoleJson` are
`withConsoleLog(formatLogFmt | formatStructured | formatJson)` (`Logger.ts:968-1018`),
and `Logger.map(logger, f)` post-processes an output.

## Tests capture it

Because the route goes through the `Console` service, `TestConsole` captures it:
`Effect.logInfo("hello")` under `Logger.layer([withConsoleLog(format)])` lands
in `TestConsole.logLines` as `["Info: hello"]`, and the `withConsoleError` twin
in `errorLines`. The `ConsoleRef` coupling `effect-v4-testing` warns about is
the same mechanism, and here it works for you.
