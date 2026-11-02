# @effected/cli

The `effected` command. `src/commands/root.ts` is the command tree; `src/main.ts` assembles it on `CliRuntime.main` (`run` takes the platform layer so tests drive it in-process, `main` runs it on the Node services); `src/bin.ts` calls `main()` with no distribution; `src/version.ts` holds `CLI_VERSION`, which the bundler replaces at build.

- The `effected` bin name is shared with a carrier package, which passes its own `distribution` to `main`.
- `--version` prints `effected <version>` through `env.formatter`; the "via" suffix comes from `CliRuntime.main`'s `distribution` option, never from the formatter.
- Shared logic belongs in `@effected/engine`, not here. Tests live in `__test__/` and run in-process over `@effected/memfs`.
