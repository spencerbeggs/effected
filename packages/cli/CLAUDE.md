# @effected/cli

The `effected` command. `src/commands/root.ts` is the command tree (`makeRootCommand(deps)`); `src/main.ts` assembles it on `CliRuntime.main` (`run(options, deps, platform)` so tests drive it in-process, `main` runs it on the Node services and is the one place `cwd` is read); `src/bin.ts` calls `main()` with no distribution; `src/version.ts` holds `CLI_VERSION`, which the bundler replaces at build.

- The `effected` bin name is shared with a carrier package, which passes its own `distribution` to `main`.
- `--version` prints `effected <version>` through `env.formatter`; the "via" suffix comes from `CliRuntime.main`'s `distribution` option, never from the formatter.
- Shared logic belongs in `@effected/engine`, not here. Tests live in `__test__/` and run in-process over `@effected/memfs`, except the e2e that spawns the built bin.
- `src/commands/schema/` is `effected schema build|check|validate` over `@effected/engine/schema`. The engine answers verdicts as data; `execute.ts` owns what a front end owns: the `--force` and version-mismatch warnings, `StepSummary.append` (never the engine, so `schema_check` over MCP does not write it), and every exit code, kept as `okf/modules/schemastore-cli.md` lists them, with `VersionMismatchError` at 2.
- **`LiveProgress.ts` is the only module here that imports Ink, React or `@effected/cli-kit/ui`, and `execute.ts` reaches it by dynamic import**, only for human output on an interactive run. A static import of it costs React on every run: `__test__/e2e/schema-no-ink.e2e.test.ts` runs the built bin under a preload recording every resolved module and fails on it. `vi.mock("ink")` cannot prove this, because vitest externalizes the built `@effected/cli-kit`.
- `validate` never draws: its `Started` names the config's schemas, none of which is what is being validated.
