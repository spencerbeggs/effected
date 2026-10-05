# Fixtures

## `fake-lsp.mjs`

- **Producing tool:** none. A hand-written, plain Node.js Language Server
  stand-in with no Effect and no `vscode-languageserver` in it, for
  `LspProbe.test.ts`. Run as `node fake-lsp.mjs [flags]`.
- **Why hand-authored:** a real server (okfit's `okfit-lsp`, a
  `vscode-languageserver` program) produces only the happy path, and only
  by accident the failure shapes the probe must survive. This one forces
  each shape on demand. Its Content-Length reader and writer are its own
  (`Buffer.byteLength` arithmetic, no import from `src/`), so a framing bug
  in `LspFrame` cannot agree with itself in these tests.
- **Default behaviour, per the LSP specification:** answers `initialize`
  with a `window/logMessage` notification and then the result, whose
  `serverInfo.name` is multi-byte (`fake-lsp ✓ 🚀`) so a character-counted
  `Content-Length` would be wrong; the result echoes the request's
  `params`. On `initialized` it sends a `client/registerCapability`
  request the probe must record and never answer. On `shutdown` it first
  sends a `fixture/received` notification listing every method it
  received, in order, then answers `result: null` — or `-32002` when
  `initialized` never arrived. On `exit` it exits 0 after `shutdown`, 1
  without, and never on stdin EOF.

| Flag | Shape it pins |
| --- | --- |
| `--split` | every frame written three bytes at a time, so headers, bodies and multi-byte characters straddle writes |
| `--exit-early` | writes `fatal: config missing` to stderr and exits 3 on the first message, before any response |
| `--never-answer` | reads every message and answers none, for the timeout |
| `--ignore-exit` | ignores `exit` and stops only at stdin EOF, for the stays-open decision |
| `--noise` | a plain log line on stdout before the first frame |
| `--fail-initialize` | answers `initialize` with a `-32603` error, then still answers `shutdown` and exits 0 |
| `--noise-between` | a plain line on stdout right after the `initialize` response, between two frames |
| `--noise-after` | a plain line on stdout after the last frame, written on `exit` before exiting |
| `--not-jsonrpc` | answers `initialize` with a well-framed body that is no JSON-RPC message (`[1,2,3]`) |
| `--truncate` | answers `initialize` with half a frame and exits 4, so stdout ends inside it |
| `--stderr-late` | writes `late report` to stderr 200 ms after `initialized`, a later tick than any response |

- **Regenerating:** there is nothing to regenerate. Edit by hand, and keep
  one shape per flag.

## `lsp-main.ts` and `ts-resolve.mjs`

- **Producing tool:** none. `lsp-main.ts` is a hand-written `main.ts` for
  `LspStdio.test.ts`: `NodeRuntime.runMain(LspStdio.launch(program), { teardown: LspStdio.teardown(process) })`
  over the real process stdio, where `program` is the smallest hand-rolled
  message loop (answers `initialize` and `shutdown`, records `shutdown`,
  stops on `exit` or at stdin EOF) provided with `NodeStdio.layer` and a
  layer that reads the required config `LSP_FIXTURE_HOME`, as a real
  server's platform layer reads `HOME`. It logs one line once serving.
- **How it runs:** `node --import ./ts-resolve.mjs lsp-main.ts [flags]`.
  Node strips the types itself; `ts-resolve.mjs` (copied from
  `@effected/mcp`'s fixtures) maps a relative `./x.js` import to `./x.ts`
  when no `.js` file exists, so the sources run unbuilt.

| Flag or env | Shape it pins |
| --- | --- |
| no `LSP_FIXTURE_HOME` | a layer that fails to build: the report must reach stderr, never stdout |
| `--die` | a defect once serving |
| `--no-host-exit` | the control: the same teardown with a host whose `exit` does nothing, so the process sits after `exit` until stdin closes |

- **Regenerating:** there is nothing to regenerate. Edit by hand.
