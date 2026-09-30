import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option, Schema } from "effect";
import { CurrentRuntimeEnv, RuntimeEnv } from "../src/RuntimeEnv.js";

const withEnv = (env: Record<string, string>) =>
	Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env));

describe("RuntimeEnv", () => {
	it.effect("layer reads agent, CI and terminal through Config", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.agent, Option.some("claude"));
			assert.deepStrictEqual(env.ci, Option.some("github-actions"));
			// The name comes from the ported std-osc8 table, where iTerm's entry is named "iTerm.app".
			const terminal = Option.getOrThrow(env.terminal);
			assert.strictEqual(terminal.name, "iTerm.app");
			assert.deepStrictEqual(terminal.version, Option.some("3.5.0"));
		}).pipe(
			Effect.provide(CurrentRuntimeEnv.layer),
			withEnv({ CLAUDECODE: "1", GITHUB_ACTIONS: "true", TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" }),
		),
	);

	it.effect("empty environment → all none", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.isTrue(Option.isNone(env.agent) && Option.isNone(env.ci) && Option.isNone(env.terminal));
		}).pipe(Effect.provide(CurrentRuntimeEnv.layer), withEnv({})),
	);

	it.effect("a terminal identified without a version has a None version", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.terminal, Option.some({ name: "kitty", version: Option.none() }));
		}).pipe(Effect.provide(CurrentRuntimeEnv.layer), withEnv({ TERM: "xterm-kitty" })),
	);

	it.effect("layerTest overrides without touching Config", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.agent, Option.some("codex"));
			assert.deepStrictEqual(env.ci, Option.none());
			assert.deepStrictEqual(env.terminal, Option.none());
		}).pipe(Effect.provide(CurrentRuntimeEnv.layerTest({ agent: Option.some("codex") })), withEnv({ CI: "true" })),
	);

	it.effect("a ConfigProvider whose reads fail yields an all-none snapshot", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.agent, Option.none());
			assert.deepStrictEqual(env.ci, Option.none());
			assert.deepStrictEqual(env.terminal, Option.none());
		}).pipe(
			Effect.provide(CurrentRuntimeEnv.layer),
			Effect.provideService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: "boom" }))),
			),
		),
	);

	it("round-trips through JSON text (persistable snapshot)", () => {
		const codec = Schema.fromJsonString(RuntimeEnv);
		const value = RuntimeEnv.make({
			agent: Option.some("claude"),
			ci: Option.none(),
			terminal: Option.some({ name: "iTerm.app", version: Option.some("3.5.0") }),
		});
		const json = Schema.encodeSync(codec)(value);
		assert.strictEqual(json, '{"agent":"claude","ci":null,"terminal":{"name":"iTerm.app","version":"3.5.0"}}');
		assert.deepStrictEqual(Schema.decodeSync(codec)(json), value);
	});

	// The frozen 0.1.0 wire form, exactly as that version's encoder emits it. A snapshot persisted then must keep
	// decoding: fields added later have to decode when absent. This literal is the oracle; never regenerate it.
	const FROZEN_0_1_0 = '{"agent":"claude","ci":null,"terminal":{"name":"iTerm.app","version":"3.5.0"}}';

	it("decodes the frozen 0.1.0 wire literal", () => {
		const decoded = Schema.decodeSync(Schema.fromJsonString(RuntimeEnv))(FROZEN_0_1_0);
		assert.deepStrictEqual(decoded.agent, Option.some("claude"));
		assert.deepStrictEqual(decoded.ci, Option.none());
		assert.deepStrictEqual(decoded.terminal, Option.some({ name: "iTerm.app", version: Option.some("3.5.0") }));
		assert.strictEqual(Schema.encodeSync(Schema.fromJsonString(RuntimeEnv))(decoded), FROZEN_0_1_0);
	});

	it("every field decodes when its key is absent, so an older or sparser snapshot keeps decoding", () => {
		const codec = Schema.fromJsonString(RuntimeEnv);
		const empty = Schema.decodeSync(codec)("{}");
		assert.deepStrictEqual([empty.agent, empty.ci, empty.terminal], [Option.none(), Option.none(), Option.none()]);
		const partial = Schema.decodeSync(codec)('{"agent":"claude"}');
		assert.deepStrictEqual(partial.agent, Option.some("claude"));
		assert.deepStrictEqual(partial.ci, Option.none());
		assert.deepStrictEqual(partial.terminal, Option.none());
		const noVersion = Schema.decodeSync(codec)('{"terminal":{"name":"kitty"}}');
		assert.deepStrictEqual(noVersion.terminal, Option.some({ name: "kitty", version: Option.none() }));
	});

	it("round-trips the all-none snapshot", () => {
		const codec = Schema.fromJsonString(RuntimeEnv);
		const value = RuntimeEnv.make({ agent: Option.none(), ci: Option.none(), terminal: Option.none() });
		assert.strictEqual(Schema.encodeSync(codec)(value), '{"agent":null,"ci":null,"terminal":null}');
		assert.deepStrictEqual(Schema.decodeSync(codec)('{"agent":null,"ci":null,"terminal":null}'), value);
	});
});
