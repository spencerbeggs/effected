import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer, PlatformError, Ref, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { CliTest } from "../src/testing.js";

const options = { sandbox: { root: "/", home: "/", env: {} }, execPath: "node", forceKillAfter: "50 millis" } as const;

/**
 * A spawner whose child's `kill` always fails, as core's does once nothing is left to signal, and whose
 * `isRunning` answers `running`: the two states `SpawnedBin.kill` must tell apart.
 */
const failingKill = (running: boolean) =>
	Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make(() =>
			Effect.succeed(
				ChildProcessSpawner.makeHandle({
					pid: ChildProcessSpawner.ProcessId(1),
					exitCode: running ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(0)),
					isRunning: Effect.succeed(running),
					kill: () =>
						Effect.fail(
							PlatformError.systemError({
								_tag: "Unknown",
								module: "ChildProcess",
								method: "kill",
								description: "Failed to kill child process",
							}),
						),
					stdin: Sink.drain,
					stdout: Stream.empty,
					stderr: Stream.empty,
					all: Stream.empty,
					getInputFd: () => Sink.drain,
					getOutputFd: () => Stream.empty,
					unref: Effect.succeed(Effect.void),
				}),
			),
		),
	);

describe("SpawnedBin.kill", () => {
	it.live(
		"returns normally for a child that has already exited, which keeps the exit code it chose",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
				const child = yield* CliTest.spawn("-e", ["process.exitCode = 3"], { sandbox, execPath: process.execPath });
				assert.strictEqual(yield* child.exitCode, 3, "control: the child exited on its own");
				yield* child.kill();
				yield* child.kill("SIGINT");
				assert.strictEqual(yield* child.exitCode, 3);
				const result = yield* child.result;
				assert.strictEqual(result.exitCode, 3);
				assert.isNull(result.signal);
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		{ timeout: 10_000 },
	);

	it.live(
		"never fails when it races a child that exits at the same moment",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
				const failures = yield* Ref.make(0);
				yield* Effect.forEach(
					Array.from({ length: 200 }, (_, i) => i),
					(i) =>
						Effect.scoped(
							Effect.gen(function* () {
								const child = yield* CliTest.spawn("-e", [""], { sandbox, execPath: process.execPath });
								// Stagger the kill across the child's start-up and exit.
								if (i % 4 !== 0) yield* Effect.sleep(`${i % 40} millis`);
								const exit = yield* Effect.exit(child.kill());
								if (Exit.isFailure(exit)) yield* Ref.update(failures, (n) => n + 1);
								const result = yield* child.result;
								assert.isTrue(
									result.exitCode === 0 || result.signal === "SIGTERM",
									"the child either exited on its own or the kill ended it",
								);
							}),
						),
					{ concurrency: 10, discard: true },
				);
				assert.strictEqual(yield* Ref.get(failures), 0);
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		{ timeout: 60_000 },
	);

	it.effect("swallows a failed kill only when the exit is already known", () =>
		Effect.gen(function* () {
			const child = yield* CliTest.spawn("bin", [], options);
			yield* child.kill();
			assert.strictEqual(yield* child.exitCode, 0);
		}).pipe(Effect.scoped, Effect.provide(failingKill(false))),
	);

	it.effect("still fails a kill that failed on a child that is running", () =>
		Effect.gen(function* () {
			const child = yield* CliTest.spawn("bin", [], options);
			const error = yield* Effect.flip(child.kill());
			assert.strictEqual(error._tag, "PlatformError");
			assert.include(error.message, "Failed to kill child process");
		}).pipe(Effect.scoped, Effect.provide(failingKill(true))),
	);
});
