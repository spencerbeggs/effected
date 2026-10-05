import { join } from "node:path";
import { Config, Effect } from "effect";
import { ChildProcess } from "effect/process";

/** The hand-written stand-in server; its flags are listed in `__test__/fixtures/README.md`. */
const FAKE_LSP = join(import.meta.dirname, "..", "fixtures", "fake-lsp.mjs");

/**
 * The command that runs the fake server with `flags`, on the test runner's own
 * Node and with only `PATH` in its environment, read through `Config` rather
 * than from the environment directly.
 */
export const fakeLspCommand = (...flags: ReadonlyArray<string>) =>
	Effect.map(Config.String("PATH").pipe(Config.withDefault("")), (path) =>
		ChildProcess.make(process.execPath, [FAKE_LSP, ...flags], { env: { PATH: path } }),
	);
