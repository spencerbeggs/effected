// Real-process check of okf/decisions/live-tick-is-a-scoped-schedule.md: a live view's tick is an Effect schedule forked into the run's scope, so closing the
// scope interrupts it and the process exits. A tick left running would keep drawing and keep the child alive: the child
// reports its frame count at scope close and at exit, and the test's timeout, not a wall-clock ceiling, bounds a hang.
// Runs the package sources under tsx (fixtures/register-ts.mjs).
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

describe("CliUi.live in a real process: the tick never holds it open", () => {
	it.live(
		"the process exits once the view's scope closes, and no frame is drawn after it",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
					const command = ChildProcess.make(
						process.execPath,
						["--import", join(FIXTURES, "register-ts.mjs"), join(FIXTURES, "live-exit.mts")],
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
					assert.strictEqual(Number(exitCode), 0, stderr);
					const match = /closed frames (\d+) exited frames (\d+)/.exec(stdout);
					assert.isNotNull(match, `the fixture reported: ${stdout} ${stderr}`);
					assert.isAbove(Number(match?.[1]), 2, "the tick drew several frames while the scope was open");
					assert.strictEqual(Number(match?.[2]), Number(match?.[1]), "no frame was drawn after the scope closed");
				}),
			).pipe(Effect.timeout("10 seconds"), Effect.provide(NodeServices.layer)),
		{ timeout: 30_000 },
	);
});
