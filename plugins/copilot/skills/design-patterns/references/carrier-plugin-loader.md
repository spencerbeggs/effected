# Carrier plugin loader

A Claude Code (or Copilot) plugin that wants to run a project's own MCP
server or LSP server — rather than a copy bundled into the plugin — has to
solve the same bin-resolution problem the carrier pattern solves for a
consumer's `node_modules/.bin` (see
[carrier-package.md](./carrier-package.md)), one layer up: the plugin
process itself needs to find and exec the right binary.

## The manifest declares a loader script, not a direct bin

A Claude Code plugin manifest wires its MCP/LSP servers to a shell loader
rather than a bin path:

```json
{
  "mcpServers": {
    "mcp": { "command": "sh", "args": ["${CLAUDE_PLUGIN_ROOT}/bin/start-mcp.sh"] }
  },
  "lspServers": {
    "the-tool": {
      "command": "sh",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/start-lsp.sh", "--stdio"],
      "diagnostics": true,
      "extensionToLanguage": { ".md": "markdown" }
    }
  }
}
```

(<https://github.com/spencerbeggs/okfit/blob/main/plugins/claude-code/.claude-plugin/plugin.json>)

## Loader resolution order

The loader script's job, in order:

1. **`<project>/node_modules/.bin/<tool>` first, and only.** If it exists
   and is executable, `exec` it directly and stop — no package-manager
   dispatch layer, ever.
2. **Not present → print an install hint on stderr**, naming the detected
   package manager (from the `packageManager` field, then lockfile
   presence, defaulting to npm) and the exact install command for it —
   `<pm> add -D @scope/plugin`.
3. **Then fall back to `npx --yes @scope/mcp@<MAJOR>`** — a **major-pinned**
   fallback, so the fallback path cannot silently drift onto a breaking
   release the plugin was never tested against:

```sh
BIN="$ROOT/node_modules/.bin/vitest-agent-mcp"
if [ -x "$BIN" ]; then
  exec "$BIN" "$@"
fi

PM="$(detect_pm)"
{
  printf 'vitest-agent plugin: vitest-agent-mcp is not installed in this project.\n'
  # ...install hint...
  printf 'Falling back to `npx --yes @vitest-agent/mcp@4`, which will download it.\n'
} >&2

exec npx --yes @vitest-agent/mcp@4 "$@"
```

(<https://github.com/spencerbeggs/vitest-agent/blob/main/plugins/claude-code/bin/start-mcp.sh>)

**Never dispatch through `pnpm exec` / `yarn exec` / `bunx` / `npm exec`.**
Each resolves bins under a different mechanism (workspace-aware exec vs.
plain PATH lookup vs. a temp-install cache), so the loader's behavior would
depend on which package manager happened to be installed on the machine
running Claude Code — not on the project being loaded. Exec the resolved
bin directly, or fall back to `npx`, and nothing in between.

## The unpinned fallback is a real gap, not a style choice

okfit and systems both fall back to a bare `npx --yes @scope/mcp` with no
version qualifier:

```sh
exec npx --yes @okfit/mcp "$@"
```

(<https://github.com/spencerbeggs/okfit/blob/main/plugins/claude-code/bin/start-mcp.sh>)

```sh
exec npx --yes @savvy-web/mcp "$@"
```

(<https://github.com/savvy-web/systems/blob/main/plugins/silk/bin/start-mcp.sh>)

That means a consumer who never installs the front end locally gets
whatever `latest` happens to be at the moment Claude Code invokes the
loader — a plugin release can be tested against one front-end major and
have its fallback path silently start running a different one. Pin the
fallback the way vitest-agent does (`@vitest-agent/mcp@4`) whenever a
front end has shipped a breaking major; treat an unpinned fallback as
latent skew waiting to happen, not as "it hasn't broken yet."

The npx fallback also runs the bare front end with no meta-package
identity, so any report it produces carries `distribution: null` — see
[carrier-version-threading.md](./carrier-version-threading.md).

## Hook CLI resolution order

A plugin's **hooks** — as opposed to its MCP/LSP server loaders — face the
same "find the project's own CLI" problem on every invocation, and the
house answer is stricter: hooks never fall back to `npx` at all, because a
hook fires far more often than a server starts and a silent multi-second
`npx` download on every tool call is not acceptable.

okfit's `hooks/lib/okfit-cli.sh` resolves in this order:

```sh
okfit_cli() {
  local project_dir="$1"
  if [ -n "${OKFIT_CLI_CMD:-}" ]; then
    printf '%s\n' "$OKFIT_CLI_CMD"
    return 0
  fi
  if [ -x "$project_dir/node_modules/.bin/okfit" ]; then
    printf '%s\n' "$project_dir/node_modules/.bin/okfit"
    return 0
  fi
  if command -v okfit >/dev/null 2>&1; then
    printf '%s\n' "okfit"
    return 0
  fi
  return 1
}
```

(<https://github.com/spencerbeggs/okfit/blob/main/plugins/claude-code/hooks/lib/okfit-cli.sh>)

1. **An override env var** (`$OKFIT_CLI_CMD`) — word-split by the caller,
   never quoted as one token. This is deliberately also the seam every bats
   test in the plugin uses to stub the CLI, so the resolution order and the
   test seam are the same mechanism, not two things that can drift apart.
2. **`<project>/node_modules/.bin/<tool>`.**
3. **`<tool>` on `PATH`.**
4. **Fail** — return non-zero with nothing printed, rather than "resolving"
   to an empty command that silently no-ops downstream.

Never `npx`, and never a package-manager dispatch, at any step.

`systems`' hooks contradict its own loader here: its `hooks/lib/run-cli.sh`
detects the package manager and returns a dispatch prefix —
`pnpm exec` / `yarn exec` / `bunx` / `npx --no --` — for every hook call
site to prepend, which is exactly the anti-pattern its own `start-mcp.sh`
loader avoids for the server case. Name this explicitly as the anti-pattern
when reviewing a hook resolution path, not as a stylistic difference from
the MCP loader.

## What the resolved bin does with the project directory

The loader script itself stays shell — resolving the right bin and `exec`ing
it is a shell problem, not one this pattern hands to the kit. What the kit
does own is the **other** side: once the bin is running, it resolves which
directory to treat as the project with `@effected/engine`'s
`LaunchContext.projectDir`, over whatever `argv`/env var the loader passed
down. `LaunchContext.isUnsubstituted` is what makes that resolution safe
against a host that passes a literal, unexpanded `${CLAUDE_PLUGIN_ROOT}`-style
variable through rather than a real path: an empty value and an
unsubstituted placeholder are both treated as absent, falling through to the
next candidate rather than resolving to the literal template string as if it
were a directory. See `effect-v4-mcp`'s
[`server-wiring.md#project-directory`](../../effect-v4-mcp/references/server-wiring.md#project-directory)
for the runnable shape.

## Kill switches

Every hook checks a project-owned environment variable before doing
anything else, and fails open (never blocks) when it is set to `off`:

```sh
case "${OKFIT_HOOKS:-}" in off) emit_noop; exit 0 ;; esac
```

(<https://github.com/spencerbeggs/okfit/blob/main/plugins/claude-code/hooks/lib/hook-output.sh>)

Name the switch after the plugin, not the tool underneath it, and check it
as the very first line of every hook script so a user can disable the
whole plugin's hook surface with one variable regardless of which
individual hook is misbehaving.

No repo in this survey has a runtime check for plugin-vs-carrier version
skew — a plugin can be running against a front-end version the plugin
itself was never tested with, and nothing currently detects that.
