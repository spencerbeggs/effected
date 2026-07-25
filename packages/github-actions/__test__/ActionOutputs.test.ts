import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { TestConsole } from "effect/testing";
import { ActionEnvironment, ActionOutputs } from "../src/index.js";

const FILES = {
	GITHUB_OUTPUT: "/rf/output",
	GITHUB_ENV: "/rf/env",
	GITHUB_PATH: "/rf/path",
	GITHUB_STEP_SUMMARY: "/rf/summary",
};

/** An append-only in-memory filesystem, fresh per test. */
const runnerFiles = () => {
	const written = new Map<string, string>();
	const layer = FileSystem.layerNoop({
		writeFileString: (path, data, options) =>
			Effect.suspend(() => {
				const key = String(path);
				const previous = options?.flag === "a" ? (written.get(key) ?? "") : "";
				written.set(key, previous + data);
				return Effect.void;
			}),
	});
	return { written, layer };
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
					const body = files.written.get(FILES.GITHUB_OUTPUT) ?? "";
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
					const body = files.written.get(FILES.GITHUB_OUTPUT) ?? "";
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
					const body = files.written.get(FILES.GITHUB_OUTPUT) ?? "";
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
					const body = files.written.get(FILES.GITHUB_OUTPUT) ?? "";
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
					assert.include(files.written.get(FILES.GITHUB_ENV) ?? "", "FOO<<");
					assert.strictEqual(files.written.get(FILES.GITHUB_PATH), "/opt/bin\n");
					assert.strictEqual(files.written.get(FILES.GITHUB_STEP_SUMMARY), "## Results\n");
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
					const body = files.written.get(FILES.GITHUB_OUTPUT) ?? "";
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
					assert.strictEqual(files.written.size, 0, "nothing may be written when the name is refused");
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
