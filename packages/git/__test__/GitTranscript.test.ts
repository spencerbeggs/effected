import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Logger, PlatformError, References } from "effect";
import { Git } from "../src/Git.js";
import type { ScriptResult } from "./fixtures.js";
import { scripted } from "./fixtures.js";

const cwd = "/repo";

interface Entry {
	readonly level: string;
	readonly text: string;
	readonly annotations: Record<string, unknown>;
}

/** Runs `program` with a capturing logger; `level` undefined keeps the default minimum level. */
const capture = <A, E>(
	program: Effect.Effect<A, E, Git>,
	script: (args: ReadonlyArray<string>) => ScriptResult,
	level?: "Debug",
) => {
	const entries: Array<Entry> = [];
	const logger = Logger.make((options) => {
		const message = Array.isArray(options.message) ? options.message : [options.message];
		entries.push({
			level: options.logLevel,
			text: message.map(String).join("\n"),
			annotations: options.fiber.getRef(References.CurrentLogAnnotations),
		});
	});
	const layer = Layer.mergeAll(Git.layer.pipe(Layer.provide(scripted(script))), Logger.layer([logger]));
	const withLevel = level === undefined ? program : Effect.provideService(program, References.MinimumLogLevel, level);
	return withLevel.pipe(
		Effect.provide(layer),
		Effect.exit,
		Effect.map((exit) => ({ exit, entries })),
	);
};

describe("Git transcript", () => {
	it.effect("each invocation logs its redacted argv at Debug", () =>
		Effect.gen(function* () {
			const { entries } = yield* capture(
				Effect.flatMap(Git, (git) => git.remoteAdd(cwd, "origin", "https://u:tok@h/o/r")),
				() => ({}),
				"Debug",
			);
			const debug = entries.filter((e) => e.level === "Debug");
			assert.strictEqual(debug.length, 1);
			assert.include(debug[0]?.text, "<redacted>");
			assert.notInclude(debug[0]?.text, "tok");
			assert.isTrue(debug[0]?.text.startsWith("git ") ?? false);
			assert.strictEqual(debug[0]?.annotations["git.cwd"], cwd);
			assert.strictEqual(debug[0]?.annotations["git.exitCode"], 0);
			assert.isNumber(debug[0]?.annotations["git.durationMs"]);
		}),
	);

	it.effect("stderr in the transcript is scrubbed", () =>
		Effect.gen(function* () {
			const { entries } = yield* capture(
				Effect.flatMap(Git, (git) => git.remoteAdd(cwd, "origin", "https://u:tok@h/o/r")),
				() => ({ exit: 128, stderr: "fatal: https://u:tok@h/o/r not found" }),
				"Debug",
			);
			assert.strictEqual(entries.length, 1);
			assert.include(entries[0]?.text, "stderr:");
			assert.notInclude(entries[0]?.text, "tok");
			assert.strictEqual(entries[0]?.annotations["git.exitCode"], 128);
		}),
	);

	it.effect("config reads log a byte count, not stdout", () =>
		Effect.gen(function* () {
			const stdout = "AUTHORIZATION: basic c2VjcmV0\n";
			const key = "http.https://github.com/.extraheader";
			const reads: ReadonlyArray<Effect.Effect<unknown, unknown, Git>> = [
				Effect.flatMap(Git, (git) => git.configGet(cwd, key)),
				Effect.flatMap(Git, (git) => git.configGetAll(cwd, key)),
				Effect.flatMap(Git, (git) => git.configList(cwd)),
			];
			for (const read of reads) {
				const { entries } = yield* capture(read, () => ({ stdout }), "Debug");
				assert.strictEqual(entries.length, 1);
				assert.include(entries[0]?.text, `stdout: <${new TextEncoder().encode(stdout).length} bytes>`);
				assert.notInclude(entries[0]?.text, "c2VjcmV0");
			}
		}),
	);

	it.effect("a config invocation outside the read flags still logs a byte count", () =>
		Effect.gen(function* () {
			// A write shape carries none of --get/--get-all/--list; fail-closed means its stdout is withheld too.
			const stdout = "AUTHORIZATION: basic c2VjcmV0\n";
			const { entries } = yield* capture(
				Effect.flatMap(Git, (git) => git.configSet(cwd, "http.extraheader", "x")),
				() => ({ stdout }),
				"Debug",
			);
			assert.strictEqual(entries.length, 1);
			assert.include(entries[0]?.text, `stdout: <${new TextEncoder().encode(stdout).length} bytes>`);
			assert.notInclude(entries[0]?.text, "c2VjcmV0");
		}),
	);

	it.effect("ordinary stdout is logged scrubbed", () =>
		Effect.gen(function* () {
			const { entries } = yield* capture(
				Effect.flatMap(Git, (git) => git.remoteAdd(cwd, "origin", "https://u:tok@h/o/r")),
				() => ({ stdout: "added https://u:tok@h/o/r\n" }),
				"Debug",
			);
			assert.strictEqual(entries.length, 1);
			assert.include(entries[0]?.text, "stdout:");
			assert.include(entries[0]?.text, "<redacted>");
			assert.notInclude(entries[0]?.text, "tok");
		}),
	);

	it.effect("long output is truncated", () =>
		Effect.gen(function* () {
			const { entries } = yield* capture(
				Effect.flatMap(Git, (git) => git.revParse(cwd, "HEAD")),
				() => ({ stdout: "x".repeat(10_000) }),
				"Debug",
			);
			assert.strictEqual(entries.length, 1);
			assert.isTrue(entries[0]?.text.endsWith("… (6000 more characters)"));
		}),
	);

	it.effect("a spawn failure is logged as spawn-failed", () =>
		Effect.gen(function* () {
			const { entries } = yield* capture(
				Effect.flatMap(Git, (git) => git.revParse(cwd, "HEAD")),
				() =>
					PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn", description: "x" }),
				"Debug",
			);
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0]?.annotations["git.exitCode"], "spawn-failed");
		}),
	);

	it.effect("nothing is logged at the default level", () =>
		Effect.gen(function* () {
			const { entries } = yield* capture(
				Effect.flatMap(Git, (git) => git.revParse(cwd, "HEAD")),
				() => ({ stdout: "abc\n" }),
			);
			assert.strictEqual(entries.length, 0);
		}),
	);
});
