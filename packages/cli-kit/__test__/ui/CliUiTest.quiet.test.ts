// #983: a CliUiTest run that mounts Ink on the production path (a live view) writes no byte to the process's own
// stdout or stderr, through to the process's exit. Ink's frame writer hides the cursor on the harness's fake TTY, which
// arms restore-cursor's exit hook; that hook writes the cursor-show escape to the REAL stderr after the program is
// done, so only a real process read to its end can see it. Runs the package sources through Node's type stripping
// (fixtures/register-ts.mjs); see CliStdin.test.ts for the preconditions.
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

/** Run the fixture to its exit and return its exit code and every byte of its real stdout and stderr. */
const runFixture = (args: ReadonlyArray<string>) =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const command = ChildProcess.make(
				process.execPath,
				["--import", join(FIXTURES, "register-ts.mjs"), join(FIXTURES, "cliuitest-quiet.mts"), ...args],
				{ env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" } },
			);
			const handle = yield* spawner.spawn(command);
			const text = (stream: Stream.Stream<Uint8Array, unknown>) => Stream.mkString(Stream.decodeText(stream));
			const [stdout, stderr, exitCode] = yield* Effect.all(
				[text(handle.stdout), text(handle.stderr), handle.exitCode],
				{
					concurrency: "unbounded",
				},
			);
			return { exitCode: Number(exitCode), stdout, stderr };
		}),
	).pipe(Effect.timeout("20 seconds"), Effect.provide(NodeServices.layer));

describe("CliUiTest: no byte reaches the real streams (#983)", () => {
	it.live(
		"a live view on the production path leaves the process's stdout and stderr empty through its exit",
		() =>
			Effect.gen(function* () {
				const run = yield* runFixture([]);
				// 0, not 2: the view's own bytes carried Ink's hide-cursor escape, so the run took the arming path.
				assert.strictEqual(run.exitCode, 0, run.stderr);
				assert.strictEqual(JSON.stringify(run.stdout), JSON.stringify(""), "real stdout");
				assert.strictEqual(JSON.stringify(run.stderr), JSON.stringify(""), "real stderr");
			}),
		{ timeout: 30_000 },
	);

	it.live(
		"control: a byte the fixture writes to the real stdout on purpose is seen",
		() =>
			Effect.gen(function* () {
				const run = yield* runFixture(["control"]);
				assert.strictEqual(run.exitCode, 0, run.stderr);
				assert.strictEqual(run.stdout, "x");
			}),
		{ timeout: 30_000 },
	);
});
