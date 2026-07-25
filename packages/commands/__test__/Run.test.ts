import { assert, describe, it } from "@effect/vitest";
import type { PlatformError } from "effect";
import { Effect, Fiber, Redacted, Schema, Sink, Stdio, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ChildProcess } from "effect/unstable/process";
import { CommandFailedError, CommandOutput, CommandOutputError, Run } from "../src/Run.js";
import type { ScriptResult } from "./fixtures.js";
import { notFound, permissionDenied, scripted } from "./fixtures.js";

const cmd = (executable = "tool", args: ReadonlyArray<string> = []) => ChildProcess.make(executable, args);

/** The common shape: provide a scripted spawner to a program that requires one. */
const withScript = <A, E>(
	program: () => Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
	script: (command: string, args: ReadonlyArray<string>) => ScriptResult,
): Effect.Effect<A, E> => Effect.provide(program(), scripted(script).layer);

describe("Run.collect", () => {
	it.effect("returns stdout, stderr and exit code", () =>
		Effect.gen(function* () {
			const output = yield* withScript(
				() => Run.collect(cmd()),
				() => ({
					stdout: "out",
					stderr: "err",
					exit: 0,
				}),
			);
			assert.instanceOf(output, CommandOutput);
			assert.strictEqual(output.stdout, "out");
			assert.strictEqual(output.stderr, "err");
			assert.strictEqual(output.exitCode, 0);
		}),
	);

	it.effect("a NON-ZERO exit is a successful result, not an error", () =>
		// This is core's contract and the package must not silently change it:
		// `collect` reports what happened; `text`/`lines`/`json` are the ones
		// that treat a non-zero exit as failure.
		Effect.gen(function* () {
			const output = yield* withScript(
				() => Run.collect(cmd()),
				() => ({ stdout: "", exit: 42 }),
			);
			assert.strictEqual(output.exitCode, 42);
		}),
	);

	it.effect("a spawn failure fails typed as CommandFailedError with kind 'spawn'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.collect(cmd("missing")),
					() => notFound("missing"),
				),
			);
			assert.instanceOf(error, CommandFailedError);
			assert.strictEqual(error._tag, "CommandFailedError");
			if (error instanceof CommandFailedError) {
				assert.strictEqual(error.kind, "spawn");
				assert.strictEqual(error.command, "missing");
				assert.isTrue(error.notFound, "a NotFound system error must set notFound");
			}
		}),
	);

	it.effect("a non-NotFound spawn failure is still kind 'spawn' but not notFound", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.collect(cmd("blocked")),
					() => permissionDenied("blocked"),
				),
			);
			if (error instanceof CommandFailedError) {
				assert.strictEqual(error.kind, "spawn");
				assert.isFalse(error.notFound);
			}
		}),
	);

	it.effect("fails typed when captured output exceeds maxOutputBytes", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.collect(cmd(), { maxOutputBytes: 8 }),
					() => ({ stdout: "0123456789", exit: 0 }),
				),
			);
			assert.instanceOf(error, CommandOutputError);
			if (error instanceof CommandOutputError) {
				assert.strictEqual(error.kind, "tooLarge");
			}
		}),
	);

	it.effect("output exactly at the cap is accepted", () =>
		Effect.gen(function* () {
			const output = yield* withScript(
				() => Run.collect(cmd(), { maxOutputBytes: 4 }),
				() => ({ stdout: "abcd", exit: 0 }),
			);
			assert.strictEqual(output.stdout, "abcd");
		}),
	);

	it.effect("with no timeout option, a hanging command does NOT fail on its own", () =>
		Effect.gen(function* () {
			// The design's "no default ceiling" decision, pinned: a forked hang is
			// still running after a large virtual-clock advance.
			const fiber = yield* Effect.forkChild(
				withScript(
					() => Run.collect(cmd()),
					() => ({ hang: true }),
				),
			);
			yield* TestClock.adjust("10 minutes");
			// `pollUnsafe` is the non-blocking check: `undefined` means the fiber
			// has not settled, which is exactly the claim — no ceiling was imposed.
			assert.strictEqual(fiber.pollUnsafe(), undefined, "expected the run to still be pending with no timeout");
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("an opted-in timeout fails typed with kind 'timeout'", () =>
		Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					withScript(
						() => Run.collect(cmd(), { timeout: "30 seconds" }),
						() => ({ hang: true }),
					),
				),
			);
			yield* TestClock.adjust("31 seconds");
			const error = yield* Fiber.join(fiber);
			assert.instanceOf(error, CommandFailedError);
			if (error instanceof CommandFailedError) {
				assert.strictEqual(error.kind, "timeout");
			}
		}),
	);
});

describe("Run.text", () => {
	it.effect("returns trimmed stdout", () =>
		Effect.gen(function* () {
			const text = yield* withScript(
				() => Run.text(cmd()),
				() => ({ stdout: "  value\n", exit: 0 }),
			);
			assert.strictEqual(text, "value");
		}),
	);

	it.effect("a non-zero exit fails with kind 'nonZero', carrying exitCode and stderr", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.text(cmd("tool", ["build"])),
					() => ({ stderr: "boom", exit: 2 }),
				),
			);
			assert.instanceOf(error, CommandFailedError);
			if (error instanceof CommandFailedError) {
				assert.strictEqual(error.kind, "nonZero");
				assert.strictEqual(error.exitCode, 2);
				assert.strictEqual(error.stderr, "boom");
				assert.deepStrictEqual([...error.args], ["build"]);
			}
		}),
	);

	it.effect("the message surfaces stderr, falling back to stdout when stderr is empty", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.text(cmd()),
					() => ({ stdout: "npm error here", exit: 1 }),
				),
			);
			assert.include(error.message, "npm error here");
		}),
	);
});

describe("Run.lines", () => {
	it.effect("splits, trims and drops blank lines", () =>
		Effect.gen(function* () {
			const lines = yield* withScript(
				() => Run.lines(cmd()),
				() => ({
					stdout: "a\n  b  \n\n c\n",
					exit: 0,
				}),
			);
			assert.deepStrictEqual([...lines], ["a", "b", "c"]);
		}),
	);

	it.effect("handles CRLF output", () =>
		Effect.gen(function* () {
			const lines = yield* withScript(
				() => Run.lines(cmd()),
				() => ({ stdout: "a\r\nb\r\n", exit: 0 }),
			);
			assert.deepStrictEqual([...lines], ["a", "b"]);
		}),
	);
});

describe("Run.json", () => {
	const Info = Schema.Struct({ version: Schema.String });

	it.effect("parses and DECODES stdout through the schema", () =>
		Effect.gen(function* () {
			const info = yield* withScript(
				() => Run.json(cmd(), Info),
				() => ({
					stdout: '{"version":"1.2.3"}',
					exit: 0,
				}),
			);
			assert.deepStrictEqual(info, { version: "1.2.3" });
		}),
	);

	it.effect("unparseable stdout fails with kind 'notJson'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.json(cmd(), Info),
					() => ({ stdout: "not json", exit: 0 }),
				),
			);
			assert.instanceOf(error, CommandOutputError);
			if (error instanceof CommandOutputError) {
				assert.strictEqual(error.kind, "notJson");
			}
		}),
	);

	it.effect("a schema mismatch fails with kind 'schema' — distinguishable from notJson", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.json(cmd(), Info),
					() => ({ stdout: '{"version":7}', exit: 0 }),
				),
			);
			assert.instanceOf(error, CommandOutputError);
			if (error instanceof CommandOutputError) {
				assert.strictEqual(error.kind, "schema");
			}
		}),
	);

	it.effect("a non-zero exit fails as a command failure, never as an output failure", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.json(cmd(), Info),
					() => ({ stderr: "no", exit: 1 }),
				),
			);
			assert.instanceOf(error, CommandFailedError);
		}),
	);
});

describe("Run.exitCode", () => {
	it.effect("returns a non-zero code without failing", () =>
		Effect.gen(function* () {
			const code = yield* withScript(
				() => Run.exitCode(cmd()),
				() => ({ exit: 3 }),
			);
			assert.strictEqual(code, 3);
		}),
	);

	it.effect("still fails typed when the spawn itself fails", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.exitCode(cmd("x")),
					() => notFound("x"),
				),
			);
			assert.instanceOf(error, CommandFailedError);
		}),
	);
});

describe("Run.succeeds", () => {
	it.effect("true for a zero exit", () =>
		Effect.gen(function* () {
			assert.isTrue(
				yield* withScript(
					() => Run.succeeds(cmd()),
					() => ({ exit: 0 }),
				),
			);
		}),
	);

	it.effect("false for a non-zero exit", () =>
		Effect.gen(function* () {
			assert.isFalse(
				yield* withScript(
					() => Run.succeeds(cmd()),
					() => ({ exit: 1 }),
				),
			);
		}),
	);

	it.effect("false — never a failure — when the executable is absent", () =>
		Effect.gen(function* () {
			assert.isFalse(
				yield* withScript(
					() => Run.succeeds(cmd("missing")),
					() => notFound("missing"),
				),
			);
		}),
	);
});

describe("Run redaction", () => {
	const token = Redacted.make("s3cr3t");

	it.effect("a declared secret never reaches the error's args", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.text(ChildProcess.make("npm", ["publish", "--token", "s3cr3t"]), { redact: [token] }),
					() => ({ stderr: "denied", exit: 1 }),
				),
			);
			if (error instanceof CommandFailedError) {
				assert.notInclude(error.args.join(" "), "s3cr3t");
				assert.notInclude(error.message, "s3cr3t");
			}
		}),
	);

	it.effect("a declared secret never reaches the error's captured output", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.text(cmd(), { redact: [token] }),
					() => ({ stderr: "auth failed for s3cr3t", exit: 1 }),
				),
			);
			if (error instanceof CommandFailedError) {
				assert.notInclude(error.stderr ?? "", "s3cr3t");
				assert.notInclude(error.message, "s3cr3t");
			}
		}),
	);

	it.effect("the flag heuristic redacts an UNDECLARED secret in the error", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.text(ChildProcess.make("npm", ["publish", "--token", "undeclared"])),
					() => ({ stderr: "denied", exit: 1 }),
				),
			);
			if (error instanceof CommandFailedError) {
				assert.notInclude(error.args.join(" "), "undeclared");
			}
		}),
	);

	it.effect("captured output on the SUCCESS path is redacted too", () =>
		Effect.gen(function* () {
			const output = yield* withScript(
				() => Run.collect(cmd(), { redact: [token] }),
				() => ({ stdout: "token is s3cr3t", exit: 0 }),
			);
			assert.notInclude(output.stdout, "s3cr3t");
		}),
	);
});

describe("Run.collectTee", () => {
	it.effect("tees stdout and stderr to Stdio while still collecting them", () =>
		Effect.gen(function* () {
			const seen: Array<string> = [];
			const capture = (): Sink.Sink<void, string | Uint8Array, never, PlatformError.PlatformError> =>
				// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach is Effect's sink constructor, not Array#forEach — its callback must return an Effect
				Sink.forEach((chunk: string | Uint8Array) =>
					Effect.sync(() => {
						seen.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
					}),
				);
			const output = yield* withScript(
				() => Run.collectTee(cmd()).pipe(Effect.provide(Stdio.layerTest({ stdout: capture, stderr: capture }))),
				() => ({ stdout: "hello", stderr: "warn", exit: 0 }),
			);

			assert.strictEqual(output.stdout, "hello");
			assert.strictEqual(output.stderr, "warn");
			assert.include(seen.join(""), "hello");
			assert.include(seen.join(""), "warn");
		}),
	);
});

describe("Run.stream", () => {
	it.effect("emits decoded lines", () =>
		Effect.gen(function* () {
			const lines = yield* withScript(
				() => Stream.runCollect(Run.stream(cmd())),
				() => ({ stdout: "one\ntwo\n", exit: 0 }),
			);
			assert.deepStrictEqual([...lines], ["one", "two"]);
		}),
	);
});

describe("Run.detach", () => {
	it.effect("unrefs the handle and returns the pid", () =>
		Effect.gen(function* () {
			const spawner = scripted(() => ({ exit: 0 }));
			const pid = yield* Effect.provide(Run.detach(cmd("server")), spawner.layer);
			assert.strictEqual(Number(pid), 4242);
			// The invariant the helper exists to encode: unref RAN. Without it the
			// scope's release kills the child and nothing outlives this process.
			assert.isTrue(spawner.spawns[0]?.unrefed, "detach must run handle.unref before the scope closes");
		}),
	);

	it.effect("a spawn failure fails typed", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				withScript(
					() => Run.detach(cmd("missing")),
					() => notFound("missing"),
				),
			);
			assert.instanceOf(error, CommandFailedError);
			if (error instanceof CommandFailedError) {
				assert.strictEqual(error.kind, "spawn");
			}
		}),
	);
});

describe("Run over core Command combinators", () => {
	it.effect("honours cwd and env applied with core's own combinators", () =>
		Effect.gen(function* () {
			// RunOptions deliberately carries no cwd/env — those live on the core
			// Command. This pins that the package consumes them rather than
			// re-declaring them.
			const command = ChildProcess.make("tool", ["x"]).pipe(
				ChildProcess.setCwd("/repo"),
				ChildProcess.setEnv({ LC_ALL: "C" }),
			);
			// A real `if` narrows; `assert.isTrue(guard(x))` would not.
			if (!ChildProcess.isStandardCommand(command)) {
				assert.fail("expected a standard command");
			}
			assert.strictEqual(command.options.cwd, "/repo");
			assert.deepStrictEqual(command.options.env, { LC_ALL: "C" });
			const output = yield* withScript(
				() => Run.collect(command),
				() => ({ stdout: "ok", exit: 0 }),
			);
			assert.strictEqual(output.stdout, "ok");
		}),
	);
});
