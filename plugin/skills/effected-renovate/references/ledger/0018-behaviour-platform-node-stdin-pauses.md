---
id: "0018"
title: "@effect/platform-node: NodeStdio pauses stdin when its last reader stops, so a program can exit with stdin still open"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.6"
  "@effect/platform-node": ">=4.1.6"
detect: ["NodeStdio|process\\.stdin"]
---

When the last `Stdio.stdin` consumer finishes or is interrupted, `NodeStdio.layer` now pauses `process.stdin`, so the Node event loop can drain and the process exit without waiting for stdin to reach EOF. Before, a program that stopped reading stdin early sat until the other end closed the pipe (probed: a reader that stops at an `exit` line, with the pipe left open, exited 1.5 seconds later only once stdin was closed on the old version, and at once on the new one).

Search for `NodeStdio` and for `process.stdin`:

- A stdio server (LSP, MCP, or any line protocol) that ended by waiting for stdin EOF now exits as soon as its read loop stops. A test that asserted the process stays up after its loop ends will fail. That is this entry. A handle the program does not own (an interval, a socket, a raw listener) still keeps the process alive, so an explicit exit, such as `@effected/lsp`'s `LspStdio.teardown(process)`, is still needed for those.
- A raw `process.stdin.on("data", …)` listener attached after a `Stdio.stdin` consumer has finished must call `process.stdin.resume()`, or it receives nothing. A later `Stdio.stdin` consumer resumes reading by itself.

Check the gotcha on `NodeStdio.layer` in the installed `.d.ts`.
