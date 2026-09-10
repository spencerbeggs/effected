---
"@effected/git": minor
---

## Bug Fixes

Closes #670 (completing the environment-pinning work started in #647/#655): `git` invocations that touch `ssh` remotes — over an unknown host or a passphrase-protected key — no longer hang indefinitely.

- Appends `-o BatchMode=yes` to the ssh command git would otherwise have used, the only lever that stops `ssh` reading a passphrase prompt or a host-key confirmation from `/dev/tty` directly (neither `GIT_TERMINAL_PROMPT` nor any askpass pin reaches that path). Before a network-touching member spawns, the service resolves that command in git's own precedence order — `GIT_SSH_COMMAND` from the environment, else `core.sshCommand` at the call's `cwd`, else `GIT_SSH`, else plain `ssh` — and appends to it, so a custom identity file, jump host or port survives. The pin is skipped entirely, leaving the caller's ssh setup untouched, in four cases: when `GIT_SSH` is the deciding rung (it names a program and takes no arguments, so pinning anything would displace it); when the program is not OpenSSH (`plink` has no `-o KEY=VALUE` form); when `ssh.variant` or `GIT_SSH_VARIANT` tells git the command is not OpenSSH regardless of its name; and when the caller already sets `BatchMode` themselves (OpenSSH honors the first value given for a repeated option, so the caller's choice stands regardless). The other non-interactive pins still apply in all four.
- Adds `GIT_ASKPASS=""`, which `GIT_TERMINAL_PROMPT=0` does not cover — an empty value is a hard stop that also suppresses a configured `core.askPass` and `SSH_ASKPASS`.
- Adds `SSH_ASKPASS_REQUIRE="never"` as defense in depth on the ssh credential path.

## Refactoring

- Every environment pin (`LC_ALL`, `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`, `SSH_ASKPASS_REQUIRE`, `GIT_SSH_COMMAND`) moved off the pure `GitCommand` constructors and onto the `Git` service, applied once per call at its single spawn choke point the same way `cwd` already was. A `GitCommand` value now carries only argv and its redaction mask — no `cwd`, no `env`. `extendEnv: true` stays on the constructor; it is not one of the pins, it only declares that git inherits the parent environment at all.
- `Git.layer` now reads the ambient `GIT_SSH_COMMAND` once, through `ConfigProvider` rather than `process.env`, so a test swaps a provider instead of mutating the environment and the package keeps its zero-`node:`-imports boundary. `core.sshCommand` is resolved per call instead, since it is repository-local while one `Git` instance serves every `cwd`; the seven network-touching members pay one extra local `git config` read, and no other member pays anything.

## Breaking Changes

A caller who takes a raw `GitCommand` value from `GitCommand.*` and runs it directly — the documented escape hatch from #655 — no longer inherits `LC_ALL=C` or the non-interactive prompt pins. Such a command now runs with a plain inherited environment; callers relying on the pins for classifiable stderr must apply their own.

There is still no way to opt out of the pins through the `Git` service itself — #655's decision stands.
