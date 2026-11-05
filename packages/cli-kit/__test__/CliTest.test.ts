import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { CliTest } from "../src/testing.js";

const BIN = join(import.meta.dirname, "fixtures", "exit3.mjs");

describe("CliTest", () => {
	it.effect("a non-zero exit is data, and both streams are captured", () =>
		Effect.gen(function* () {
			const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
			const result = yield* CliTest.run(BIN, [], { sandbox, execPath: process.execPath, stdin: "" });
			assert.strictEqual(result.exitCode, 3);
			assert.strictEqual(result.stdout, `home=${sandbox.home}\n`);
			assert.strictEqual(result.stderr, "error: something failed\n");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.effect("a child ended by a signal is data too: no exit code, and the signal", () =>
		Effect.gen(function* () {
			const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
			const options = { sandbox, execPath: process.execPath };
			const result = yield* CliTest.run(
				"-e",
				["process.stdout.write('bye'); process.kill(process.pid, 'SIGTERM')"],
				options,
			);
			assert.isNull(result.exitCode);
			assert.strictEqual(result.signal, "SIGTERM");
			const exited = yield* CliTest.run(BIN, [], options);
			assert.strictEqual(exited.exitCode, 3, "control: an exit has a code");
			assert.isNull(exited.signal);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.effect("the sandbox never inherits the host HOME", () =>
		Effect.gen(function* () {
			const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
			assert.notStrictEqual(sandbox.env.HOME, process.env.HOME);
			assert.strictEqual(sandbox.env.NO_COLOR, "1");
			assert.isTrue(sandbox.env.XDG_CONFIG_HOME?.startsWith(sandbox.home));
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.effect("stdin is delivered to the child", () =>
		Effect.gen(function* () {
			const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
			const result = yield* CliTest.run(BIN, [], { sandbox, execPath: process.execPath, stdin: "hello" });
			assert.isTrue(result.stdout.includes("stdin=hello"));
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.effect(
		"omitted stdin completes rather than hanging on an open pipe",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
				const result = yield* CliTest.run(BIN, [], { sandbox, execPath: process.execPath });
				assert.strictEqual(result.exitCode, 3);
				assert.isFalse(result.stdout.includes("stdin="));
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		{ timeout: 5000 },
	);

	it.effect("expectExit passes on a match and fails naming code and stderr", () =>
		Effect.gen(function* () {
			const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
			const options = { sandbox, execPath: process.execPath };
			const ok = yield* CliTest.run(BIN, [], { ...options, expectExit: 3 });
			assert.strictEqual(ok.exitCode, 3);
			const error = yield* Effect.flip(CliTest.run(BIN, [], { ...options, expectExit: 0 }));
			assert.strictEqual(error._tag, "CliTestFailure");
			assert.include(error.message, "expected exit 0");
			assert.include(error.message, "exited with code 3");
			assert.doesNotThrow(() => {
				(error as { message: string }).message = "prefixed";
			});
			assert.include(error.message, "expected exit 0", "assigning to message is ignored");
			assert.include(error.message, "error: something failed");
			const signalled = yield* Effect.flip(
				CliTest.run("-e", ["process.kill(process.pid, 'SIGTERM')"], { ...options, expectExit: 0 }),
			);
			assert.include(signalled.message, "SIGTERM");
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});
