import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { CliTest } from "../src/testing.js";

const FOLLOW = join(import.meta.dirname, "fixtures", "follow.mjs");

// Real time: the child is a real process, so a TestClock would never move its output along.
describe("CliTest.spawn", () => {
	it.live(
		"streams a running child's lines, signals it, and reads its exit",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
				const child = yield* CliTest.spawn(FOLLOW, [], { sandbox, execPath: process.execPath });
				const first = yield* Stream.runCollect(Stream.take(child.stdout, 2));
				assert.deepStrictEqual(first, ["following", "tick 1"], "CRLF is split off; the child is still running");
				yield* child.kill("SIGINT");
				assert.strictEqual(yield* child.exitCode, 0);
				const all = yield* Stream.runCollect(child.stdout);
				assert.deepStrictEqual(all.slice(0, 2), ["following", "tick 1"], "a later reader replays from the start");
				assert.strictEqual(all.at(-1), "stopped", "a last line with no line break comes at the end");
				const result = yield* child.result;
				assert.strictEqual(result.exitCode, 0);
				assert.isTrue(result.stdout.startsWith("following\r\ntick 1\n"));
				assert.isTrue(result.stdout.endsWith("stopped"));
				assert.strictEqual(result.stderr, "");
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		{ timeout: 10_000 },
	);

	it.live(
		"drains a stream nobody reads, so a chatty child never blocks on a full pipe",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
				const child = yield* CliTest.spawn(FOLLOW, ["chatty"], { sandbox, execPath: process.execPath });
				const first = yield* Stream.runHead(child.stdout).pipe(Effect.timeout("5 seconds"));
				assert.deepStrictEqual(first, Option.some("following"));
				yield* child.kill("SIGINT");
				const result = yield* child.result;
				assert.strictEqual(result.stderr.length, 1024 * 512);
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		{ timeout: 10_000 },
	);

	it.live(
		"the child is killed when the scope closes first",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
				let pid: Option.Option<string> = Option.none();
				yield* Effect.scoped(
					Effect.gen(function* () {
						const child = yield* CliTest.spawn("-e", ["console.log(process.pid); setInterval(() => {}, 1000)"], {
							sandbox,
							execPath: process.execPath,
						});
						pid = yield* Stream.runHead(child.stdout);
					}),
				);
				const alive = (id: number): boolean => {
					try {
						process.kill(id, 0);
						return true;
					} catch {
						return false;
					}
				};
				const id = Number(Option.getOrThrow(pid));
				assert.isAbove(id, 0);
				assert.isFalse(alive(id), "the child outlived its scope");
				assert.isTrue(alive(process.pid), "control: the liveness probe sees a live process");
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		{ timeout: 10_000 },
	);
});
