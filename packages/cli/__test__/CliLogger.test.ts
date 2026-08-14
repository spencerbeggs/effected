import { describe, expect, it } from "@effect/vitest";
import { Console, Effect, References } from "effect";
import { CliLogger } from "../src/CliLogger.js";

/**
 * A `Console` that keeps the two streams apart.
 *
 * @remarks
 * The whole point of reading the `Console` off the fiber is that this is
 * possible at all: a `process.stdout` write is untestable without stubbing a
 * global inside a runner that is itself writing to those streams, which is
 * exactly why nobody notices when the split regresses.
 *
 * `Object.create(console)` inherits the members neither the logger nor these
 * assertions touch, so the double stays a `Console` without restating one.
 */
const capturing = (): { readonly console: Console.Console; readonly out: string[]; readonly err: string[] } => {
	const out: string[] = [];
	const err: string[] = [];
	const console_: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { console: console_, out, err };
};

const capture = (
	program: Effect.Effect<void>,
	options: Parameters<typeof CliLogger.layer>[0] = {},
): Effect.Effect<{ out: string[]; err: string[] }> =>
	Effect.gen(function* () {
		const { console: double, out, err } = capturing();
		yield* program.pipe(Effect.provide(CliLogger.layer(options)), Effect.provideService(Console.Console, double));
		return { out, err };
	});

describe("CliLogger", () => {
	it.effect("writes info to stdout and errors to stderr", () =>
		Effect.gen(function* () {
			const { out, err } = yield* capture(
				Effect.gen(function* () {
					yield* Effect.log("progress");
					yield* Effect.logError("broke");
				}),
			);

			expect(out).toEqual(["progress"]);
			expect(err).toEqual(["broke"]);
		}),
	);

	it.effect("routes every level at or above Error to stderr, and nothing below", () =>
		Effect.gen(function* () {
			const { out, err } = yield* capture(
				Effect.gen(function* () {
					yield* Effect.logDebug("debug");
					yield* Effect.logInfo("info");
					yield* Effect.logWarning("warn");
					yield* Effect.logError("error");
					yield* Effect.logFatal("fatal");
				}).pipe(Effect.provideService(References.MinimumLogLevel, "Debug")),
			);

			// The discriminating mutant for this logger is "route everything to
			// stdout". Warn is the boundary that catches it: it must NOT be stderr.
			expect(err).toEqual(["error", "fatal"]);
			expect(out).toEqual(["debug", "info", "warn"]);
		}),
	);

	it.effect("renders plainly, with no timestamp, level or fiber id", () =>
		Effect.gen(function* () {
			const { out } = yield* capture(Effect.log("a plain line"));

			expect(out).toEqual(["a plain line"]);
			expect(out[0]).not.toMatch(/^\[|INFO|\(#\d+\)/);
		}),
	);

	it.effect("joins a variadic message with spaces", () =>
		Effect.gen(function* () {
			const { out } = yield* capture(Effect.log("synced", 3, "repos"));

			expect(out).toEqual(["synced 3 repos"]);
		}),
	);

	it.effect("honours LogToStderr by forcing everything to stderr", () =>
		Effect.gen(function* () {
			const { out, err } = yield* capture(
				Effect.gen(function* () {
					yield* Effect.log("progress");
					yield* Effect.logError("broke");
				}).pipe(Effect.provideService(References.LogToStderr, true)),
			);

			expect(err).toEqual(["progress", "broke"]);
			// It forces one direction only: it must never move an error onto stdout.
			expect(out).toEqual([]);
		}),
	);

	it.effect("takes a custom renderer and a custom stderr threshold", () =>
		Effect.gen(function* () {
			const { out, err } = yield* capture(
				Effect.gen(function* () {
					yield* Effect.logInfo("info");
					yield* Effect.logWarning("warn");
				}).pipe(Effect.provideService(References.MinimumLogLevel, "Debug")),
				{ render: (message) => `> ${String(message)}`, stderrFrom: "Warn" },
			);

			expect(out).toEqual(["> info"]);
			expect(err).toEqual(["> warn"]);
		}),
	);
});
