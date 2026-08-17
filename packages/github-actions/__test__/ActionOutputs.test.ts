import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Redacted, Schema } from "effect";
import { TestConsole } from "effect/testing";
import { ActionEnvironment, ActionOutputError, ActionOutputs, Secret } from "../src/index.js";

const FILES = {
	GITHUB_OUTPUT: "/rf/output",
	GITHUB_ENV: "/rf/env",
	GITHUB_PATH: "/rf/path",
	GITHUB_STEP_SUMMARY: "/rf/summary",
};

/**
 * A real in-memory volume for the runner files, fresh per test.
 *
 * `ActionEnvironment`'s own TSDoc tells consumers to reach for `@effected/memfs`
 * rather than a hand stub, and the append semantics are why: these writes are
 * `flag: "a"` appends, and a stub that models them by concatenating into a Map
 * is re-implementing the filesystem behavior under test. The volume performs
 * the real append, and `/rf` is seeded because a write needs its parent.
 */
const runnerFiles = () => {
	const { fileSystem, volume } = Effect.runSync(
		MemoryFileSystem.makeInspectableWith({ "/rf": MemoryFileSystem.directory() }),
	);
	return { written: volume, layer: Layer.succeed(FileSystem.FileSystem, fileSystem) };
};

const live = <A, E>(program: Effect.Effect<A, E, ActionOutputs>, files: ReturnType<typeof runnerFiles>) =>
	program.pipe(
		Effect.provide(
			ActionOutputs.layer.pipe(Layer.provide(Layer.mergeAll(ActionEnvironment.layerTest(FILES), files.layer))),
		),
	);

describe("ActionOutputs", () => {
	describe("runner files", () => {
		it.effect("writes an output as a delimited block", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					yield* (yield* ActionOutputs).set("version", "1.2.3");
					const body = files.written.text(FILES.GITHUB_OUTPUT) ?? "";
					const [head, value, tail] = body.trimEnd().split("\n");
					assert.isTrue(head?.startsWith("version<<"), `unexpected head: ${head}`);
					assert.strictEqual(value, "1.2.3");
					assert.strictEqual(tail, head?.slice("version<<".length));
				}),
				files,
			);
		});

		it.effect("round-trips a multiline value, which is the point of the delimiter", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					yield* (yield* ActionOutputs).set("notes", "line one\nline two\n\nline four");
					const body = files.written.text(FILES.GITHUB_OUTPUT) ?? "";
					const lines = body.trimEnd().split("\n");
					const delimiter = lines[0]?.slice("notes<<".length) ?? "";
					assert.deepStrictEqual(lines.slice(1, -1), ["line one", "line two", "", "line four"]);
					assert.strictEqual(lines.at(-1), delimiter);
				}),
				files,
			);
		});

		it.effect("derives a delimiter the value cannot contain", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					// A value containing the default delimiter would, with a fixed
					// delimiter, terminate the block early and corrupt every later entry.
					yield* (yield* ActionOutputs).set("evil", "EFFECTED_EOF\nsmuggled=1");
					const body = files.written.text(FILES.GITHUB_OUTPUT) ?? "";
					const lines = body.trimEnd().split("\n");
					const delimiter = lines[0]?.slice("evil<<".length) ?? "";
					assert.notStrictEqual(delimiter, "EFFECTED_EOF");
					assert.isFalse("EFFECTED_EOF\nsmuggled=1".includes(delimiter), "delimiter must not occur in the value");
					assert.strictEqual(lines.at(-1), delimiter);
				}),
				files,
			);
		});

		it.effect("appends rather than truncating, so two outputs both survive", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					const outputs = yield* ActionOutputs;
					yield* outputs.set("a", "1");
					yield* outputs.set("b", "2");
					const body = files.written.text(FILES.GITHUB_OUTPUT) ?? "";
					assert.include(body, "a<<");
					assert.include(body, "b<<");
				}),
				files,
			);
		});

		it.effect("routes exportVariable, addPath and summary to their own files", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					const outputs = yield* ActionOutputs;
					yield* outputs.exportVariable("FOO", "bar");
					yield* outputs.addPath("/opt/bin");
					yield* outputs.summary("## Results\n");
					assert.include(files.written.text(FILES.GITHUB_ENV) ?? "", "FOO<<");
					assert.strictEqual(files.written.text(FILES.GITHUB_PATH), "/opt/bin\n");
					assert.strictEqual(files.written.text(FILES.GITHUB_STEP_SUMMARY), "## Results\n");
				}),
				files,
			);
		});

		it.effect("encodes setJson through the schema", () => {
			const files = runnerFiles();
			const Payload = Schema.Struct({ count: Schema.Number, tag: Schema.String });
			return live(
				Effect.gen(function* () {
					yield* (yield* ActionOutputs).setJson("result", { count: 2, tag: "x" }, Payload);
					const body = files.written.text(FILES.GITHUB_OUTPUT) ?? "";
					assert.include(body, '{"count":2,"tag":"x"}');
				}),
				files,
			);
		});

		it.effect("fails typed when the runner file variable is not set", () => {
			const files = runnerFiles();
			return Effect.gen(function* () {
				const error = yield* Effect.flip((yield* ActionOutputs).set("a", "1"));
				assert.strictEqual(error._tag, "ActionOutputError");
				assert.strictEqual(error.reason, "unavailable");
				assert.strictEqual(error.file, "GITHUB_OUTPUT");
			}).pipe(
				Effect.provide(
					ActionOutputs.layer.pipe(Layer.provide(Layer.mergeAll(ActionEnvironment.layerTest({}), files.layer))),
				),
			);
		});

		it.effect("refuses a name containing the delimiter syntax", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					const error = yield* Effect.flip((yield* ActionOutputs).set("bad\nname", "1"));
					assert.strictEqual(error.reason, "invalidName");
					assert.strictEqual(files.written.paths().length, 0, "nothing may be written when the name is refused");
				}),
				files,
			);
		});
	});

	describe("workflow commands", () => {
		it.effect("masks a secret", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					yield* (yield* ActionOutputs).setSecret("s3cr3t");
					const lines = yield* TestConsole.logLines;
					assert.include(JSON.stringify(lines), "::add-mask::s3cr3t");
				}),
				files,
			);
		});

		it.effect("escapes a masked value that spans lines", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					yield* (yield* ActionOutputs).setSecret("a\nb");
					const lines = yield* TestConsole.logLines;
					assert.include(JSON.stringify(lines), "::add-mask::a%0Ab");
				}),
				files,
			);
		});

		it.effect("emits setFailed as an error annotation", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					yield* (yield* ActionOutputs).setFailed("it broke");
					const lines = yield* TestConsole.logLines;
					assert.include(JSON.stringify(lines), "::error::it broke");
				}),
				files,
			);
		});
	});

	describe("layerDetached", () => {
		/** The S3-shaped secret from the incident this layer exists for. */
		const PLAINTEXT = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

		/** Everything this process wrote to its console, as one string. */
		const captured = Effect.map(Effect.zip(TestConsole.logLines, TestConsole.errorLines), ([logs, errors]) =>
			JSON.stringify([...logs, ...errors]),
		);

		it.effect("the incident, as regression: a signing secret never reaches a detached worker's log", () =>
			Effect.gen(function* () {
				// The worker-side composition that shipped wrong: an S3-style signer
				// declassifying its key via Secret.forSigning. Under layerDetached
				// the signer still gets the raw bytes for the HMAC…
				const key = yield* Secret.forSigning(Redacted.make(PLAINTEXT));
				assert.strictEqual(key, PLAINTEXT);
				// …and the secret appears NOWHERE in the captured output. Under the
				// real layer this exact assertion fails (see the control below):
				// stdout in a detached worker is a log file no runner parses, so the
				// mask both masks nothing and writes the plaintext into the log.
				assert.notInclude(yield* captured, PLAINTEXT);
			}).pipe(Effect.provide(ActionOutputs.layerDetached)),
		);

		it.effect("the control: the REAL layer writes ::add-mask::<plaintext> — the shipped inversion", () => {
			const files = runnerFiles();
			return live(
				Effect.gen(function* () {
					// The mutant the regression discriminates against: swap
					// layerDetached back to ActionOutputs.layer and the plaintext is in
					// the output, workflow-command prefix and all. In a `uses:` step the
					// runner consumes this line; in a detached worker it IS the leak.
					yield* Secret.forSigning(Redacted.make(PLAINTEXT));
					assert.include(yield* captured, `::add-mask::${PLAINTEXT}`);
				}),
				files,
			);
		});

		it.effect("setSecret is a silent no-op — the value must not be written anywhere", () =>
			Effect.gen(function* () {
				yield* (yield* ActionOutputs).setSecret("s3cr3t");
				assert.strictEqual(yield* captured, "[]", "a detached worker must write nothing for a mask");
			}).pipe(Effect.provide(ActionOutputs.layerDetached)),
		);

		it.effect("every runner-file member fails typed, naming its file", () =>
			Effect.gen(function* () {
				const outputs = yield* ActionOutputs;
				const cases: ReadonlyArray<readonly [Effect.Effect<void, unknown>, string]> = [
					[outputs.set("version", "1.2.3"), "GITHUB_OUTPUT"],
					[outputs.setJson("result", { a: 1 }, Schema.Struct({ a: Schema.Number })), "GITHUB_OUTPUT"],
					[outputs.exportVariable("FOO", "bar"), "GITHUB_ENV"],
					[outputs.addPath("/opt/bin"), "GITHUB_PATH"],
					[outputs.summary("## Results\n"), "GITHUB_STEP_SUMMARY"],
				];
				for (const [call, file] of cases) {
					const error = yield* Effect.flip(call);
					assert.instanceOf(error, ActionOutputError);
					assert.strictEqual(error.reason, "detached", file);
					assert.strictEqual(error.file, file);
					assert.include(error.message, "detached worker");
				}
				// Failing typed, not silently: nothing was logged on the way.
				assert.strictEqual(yield* captured, "[]");
			}).pipe(Effect.provide(ActionOutputs.layerDetached)),
		);

		it.effect("setFailed degrades to a plain log line, with no workflow-command syntax", () =>
			Effect.gen(function* () {
				yield* (yield* ActionOutputs).setFailed("it broke");
				const errors = yield* TestConsole.errorLines;
				assert.include(JSON.stringify(errors), "it broke");
				// The ::error:: protocol means nothing in a worker's log file —
				// emitting it would be pretending a runner is listening.
				assert.notInclude(yield* captured, "::error::");
			}).pipe(Effect.provide(ActionOutputs.layerDetached)),
		);
	});

	describe("test double", () => {
		it.effect("an unstubbed member dies loudly", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit((yield* ActionOutputs).set("a", "1"));
				assert.isTrue(exit._tag === "Failure");
			}).pipe(Effect.provide(ActionOutputs.layerTest())),
		);

		it.effect("layerTest serves a stubbed member", () =>
			Effect.gen(function* () {
				yield* (yield* ActionOutputs).setSecret("x");
			}).pipe(Effect.provide(ActionOutputs.layerTest({ setSecret: () => Effect.void }))),
		);
	});
});
