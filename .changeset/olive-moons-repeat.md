---
"@effected/git": minor
---

## Bug Fixes

Every `GitCommand` invocation now pins `GIT_TERMINAL_PROMPT=0` alongside the existing `LC_ALL=C`.

A network-touching member — `lsRemote`, `fetch`, `push`, `pull`, `submoduleAdd` — run against a remote that requires credentials could previously block on git's interactive terminal prompt until the 30s `GIT_TIMEOUT` ceiling fired, and on a runner with no tty the behaviour was backend-dependent rather than deterministic. Such a command now fails fast with git's own auth error, classified as `GitCommandError` with the exit code and stderr intact.

Two consequences worth knowing before upgrading:

- The pin is **unconditional**. `extendEnv: true` merges the parent environment, but a pinned key wins over it, so `GIT_TERMINAL_PROMPT=1` in `process.env` no longer re-enables prompting, and there is no opt-out through the `Git` service. A caller that genuinely wants git to prompt must take the `GitCommand` value and override the key with `ChildProcess.setEnv` before running it.
- The pure `GitCommand` values changed shape: `command.options.env` is now `{ LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" }`. Code asserting on that object needs updating.

This gags git's own prompt only — `ssh`'s key-passphrase and host-key prompts read the terminal directly and are not covered.

## Documentation

- The pinned-env invariant is restated consistently across `README.md`, `CLAUDE.md` and `CLAUDE.surface.md`, including the `Run.collect` example that consumers copy.
