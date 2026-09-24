# Fixtures

## `server.ts`

- **Producing tool:** none. Hand-authored against `effect@4.0.0-rc.117`'s
  `effect/unstable/ai` (`Tool`, `Toolkit`, `McpServer`) and this package's
  `McpStdio.layer` and `ToolFailure`.
- **Why hand-authored:** no real server produces every wire shape the
  harness, audit and toolkit tests need in one place. Each tool exists to
  produce exactly one of them:

| Tool | Wire shape it pins |
| --- | --- |
| `echo` | a success: `structuredContent` plus the same object as JSON text; also invalid params when `text` is not a string |
| `lookup` | a declared failure: `isError` text with the remediation folded into `message`, no `structuredContent` |
| `boom` | a handler defect: the scrubbed internal message on the wire, the cause logged on stderr |
| `ping` | a zero-parameter tool called with an empty `arguments` object |
| `hang` | a call that never completes, for the stdin-closes-mid-request path |
| `garble` | a stray non-JSON-RPC line on stdout, for `strictStdout` |
| `grow` | a runtime `addTool`, which makes the server send `notifications/tools/list_changed` |
| `version` | a bare-string (non-object) success output |

- **Compositions:** `fixtureServer` provides the toolkit WITH
  `McpStdio.layer` (the okfit shape); `fixtureServerMerged` merges it
  BESIDE the layer, so the toolkit never sees the layer's outputs at
  build time. Both must keep defect logs off `console.log`.
- **Regenerating:** there is nothing to regenerate. Edit by hand, and keep
  one wire shape per tool.

## `fake-server.mjs`

- **Producing tool:** none. A hand-written plain JSON-RPC-over-stdio stand-in
  with no Effect in it, for `McpProcess.test.ts` and `McpProbe.test.ts`.
- **Why hand-authored:** it behaves like an Effect stdio server on stdin EOF
  (ends at once, dropping anything in flight) while letting each test force
  one failure shape a real server produces only by accident. It answers
  `initialize` with a `notifications/tools/list_changed` first, so a reader
  must read past an interleaved notification; it answers `server/discover`
  for the stateless revision, echoing the request's `params._meta` back as
  `echoedMeta` so a test can observe the protocol fields.

| Flag | Failure shape it pins |
| --- | --- |
| `--exit-early` | writes `fatal: config missing` to stderr and exits 3 before responding |
| `--delay-ms=N` | a slow `initialize`: the response arrives N ms after the request |
| `--noise` | a non-JSON-RPC line on stdout before anything else |
| `--count-on-end` | on stdin EOF, reports the frames it received and their methods, in order |
| `--stderr-on-start` | writes `booting` to stderr at startup, while it keeps running |

- **Regenerating:** there is nothing to regenerate. Edit by hand, and keep
  one failure shape per flag.

## `stdio-main.ts` and `ts-resolve.mjs`

- **Producing tool:** none. `stdio-main.ts` is the one-line `main.ts`
  (`NodeRuntime.runMain(McpStdio.launch(...), { teardown: McpStdio.teardown })`)
  over `fixtureServer()` and the real `NodeStdio.layer`, for tests that need
  a real process's stdin and stdout.
- **How it runs:** `node --import ./ts-resolve.mjs stdio-main.ts`. Node
  strips the types itself; `ts-resolve.mjs` maps a relative `./x.js` import
  to `./x.ts` when no `.js` file exists, so the sources run unbuilt.
- **Regenerating:** there is nothing to regenerate. Edit by hand.
