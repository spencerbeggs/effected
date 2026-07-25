import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Schema } from "effect";
import { TestConsole } from "effect/testing";
import { ActionEnvironment, ActionOutputs, ActionState } from "../src/index.js";

const Token = Schema.Struct({ value: Schema.String, expires: Schema.Number });

const runnerFiles = () => {
	const written = new Map<string, string>();
	const layer = FileSystem.layerNoop({
		writeFileString: (path, data, options) =>
			Effect.suspend(() => {
				const key = String(path);
				written.set(key, (options?.flag === "a" ? (written.get(key) ?? "") : "") + data);
				return Effect.void;
			}),
	});
	return { written, layer };
};

const live = <A, E>(
	program: Effect.Effect<A, E, ActionState>,
	env: Record<string, string> = { GITHUB_STATE: "/rf/state" },
) => {
	const files = runnerFiles();
	const base = Layer.mergeAll(ActionEnvironment.layerTest(env), files.layer);
	const outputs = ActionOutputs.layer.pipe(Layer.provide(base));
	return {
		files,
		run: program.pipe(Effect.provide(ActionState.layer.pipe(Layer.provide(Layer.mergeAll(base, outputs))))),
	};
};

describe("ActionState", () => {
	it.effect("persists a value as a delimited block on the state file", () => {
		const { files, run } = live(
			Effect.gen(function* () {
				yield* (yield* ActionState).save("token", { value: "abc", expires: 1 }, Token);
			}),
		);
		return Effect.map(run, () => {
			const body = files.written.get("/rf/state") ?? "";
			assert.isTrue(body.startsWith("token<<"));
			assert.include(body, '{"value":"abc","expires":1}');
		});
	});

	it.effect(
		"reads a value back from the STATE_ variable the runner republishes",
		() =>
			live(
				Effect.gen(function* () {
					const value = yield* (yield* ActionState).get("token", Token);
					assert.deepStrictEqual(value, { value: "abc", expires: 1 });
				}),
				{ GITHUB_STATE: "/rf/state", STATE_token: '{"value":"abc","expires":1}' },
			).run,
	);

	it.effect(
		"getOptional answers none for a key that was never saved",
		() =>
			live(
				Effect.gen(function* () {
					assert.isTrue(Option.isNone(yield* (yield* ActionState).getOptional("absent", Token)));
				}),
			).run,
	);

	it.effect(
		"get fails typed for a key that was never saved",
		() =>
			live(
				Effect.gen(function* () {
					const error = yield* Effect.flip((yield* ActionState).get("absent", Token));
					assert.strictEqual(error._tag, "ActionStateError");
					assert.strictEqual(error.reason, "missing");
					assert.strictEqual(error.key, "absent");
				}),
			).run,
	);

	it.effect(
		"fails typed when the persisted value does not satisfy its schema",
		() =>
			live(
				Effect.gen(function* () {
					const error = yield* Effect.flip((yield* ActionState).get("token", Token));
					assert.strictEqual(error.reason, "malformed");
				}),
				{ GITHUB_STATE: "/rf/state", STATE_token: '{"value":"abc"}' },
			).run,
	);

	it.effect(
		"fails typed when the persisted value is not JSON",
		() =>
			live(
				Effect.gen(function* () {
					const error = yield* Effect.flip((yield* ActionState).get("token", Token));
					assert.strictEqual(error.reason, "malformed");
				}),
				{ GITHUB_STATE: "/rf/state", STATE_token: "{ not json" },
			).run,
	);

	describe("saveSecret", () => {
		it.effect("masks the secret BEFORE persisting it", () => {
			const { files, run } = live(
				Effect.gen(function* () {
					yield* (yield* ActionState).saveSecret("gh-token", "ghs_abc123");
				}),
			);
			return Effect.gen(function* () {
				yield* run;
				const lines = JSON.stringify(yield* TestConsole.logLines);
				assert.include(lines, "::add-mask::ghs_abc123");
				// GITHUB_STATE is plaintext by GitHub's protocol; the mask is the only
				// available defense, so it must have happened.
				assert.include(files.written.get("/rf/state") ?? "", "ghs_abc123");
			});
		});
	});

	describe("test double", () => {
		it.effect("an unstubbed member dies loudly", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit((yield* ActionState).get("k", Token));
				assert.strictEqual(exit._tag, "Failure");
			}).pipe(Effect.provide(ActionState.layerTest())),
		);
	});
});
