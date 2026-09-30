import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, Layer, Runtime, Schema } from "effect";
import { Cancelled, CliRuntime, NotInteractive } from "../src/index.js";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const run = <E>(failure: E, render?: (error: unknown) => string) =>
	Effect.gen(function* () {
		const { double, out, err } = capturing();
		const exit = yield* CliRuntime.main(Effect.fail(failure), { platform: Layer.empty, render }).pipe(
			Effect.exit,
			Effect.provideService(Console.Console, double),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : undefined;
		const reported = Exit.isFailure(exit) ? Runtime.getErrorReported(Cause.squash(exit.cause)) : undefined;
		return { code, reported, out, err };
	});

describe("Cancelled", () => {
	for (const reason of ["escape", "interrupt"] as const) {
		it.effect(`${reason}: exits 130 with one plain stderr line`, () =>
			Effect.gen(function* () {
				const { code, reported, out, err } = yield* run(new Cancelled({ reason }));
				assert.strictEqual(code, 130);
				assert.strictEqual(reported, false, "the runtime must not report it a second time");
				assert.deepStrictEqual(err, ["cancelled; nothing written"]);
				assert.deepStrictEqual(out, []);
			}),
		);
	}

	it.effect("a consumer render overrides the default line but keeps the exit code", () =>
		Effect.gen(function* () {
			const { code, err } = yield* run(new Cancelled({ reason: "escape" }), () => "custom");
			assert.strictEqual(code, 130);
			assert.deepStrictEqual(err, ["custom"]);
		}),
	);

	it("stays a tagged-error schema: the marker does not leak into encode, equality or the tag", () => {
		const a = new Cancelled({ reason: "escape" });
		assert.strictEqual(a._tag, "Cancelled");
		assert.strictEqual(a.reason, "escape");
		assert.deepStrictEqual(Schema.encodeSync(Cancelled)(a), { _tag: "Cancelled", reason: "escape" });
		assert.isTrue(a instanceof Error);
		assert.strictEqual(Runtime.getErrorExitCode(a), 130);
		assert.throws(() => Schema.decodeUnknownSync(Cancelled)({ _tag: "Cancelled", reason: "nope" }));
	});
});

describe("NotInteractive", () => {
	it.effect("exits 64 with its one line", () =>
		Effect.gen(function* () {
			const { code, reported, out, err } = yield* run(new NotInteractive());
			assert.strictEqual(code, 64);
			assert.strictEqual(reported, false);
			assert.deepStrictEqual(err, ["not interactive: run in a terminal or pass the flag"]);
			assert.deepStrictEqual(out, []);
		}),
	);

	it("is a tagged error with no fields", () => {
		const e = new NotInteractive();
		assert.strictEqual(e._tag, "NotInteractive");
		assert.deepStrictEqual(Schema.encodeSync(NotInteractive)(e), { _tag: "NotInteractive" });
	});
});
