import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Logger, Option } from "effect";
import { Audience } from "../src/Audience.js";
import { EnvOverride } from "../src/EnvOverride.js";

const withEnv = (env: Record<string, string>) =>
	Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env));

const capture = (lines: Array<string>) =>
	Logger.layer([
		Logger.make(({ message }) => {
			lines.push(Array.isArray(message) ? message.join(" ") : String(message));
		}),
	]);

// vitest-agent's console-mode literal sets, the fixture the brief names.
const accepts = {
	human: ["passthrough", "silent", "stream", "agent"],
	agent: ["passthrough", "silent", "agent"],
	ci: ["passthrough", "silent", "ci-annotations"],
} as const;

const read = (env: Record<string, string>, kind: "human" | "agent" | "ci", lines: Array<string> = []) =>
	EnvOverride.read({ envVar: "VITEST_AGENT_CONSOLE", accepts }).pipe(
		Effect.provide(Audience.layerTest(kind)),
		Effect.provide(capture(lines)),
		withEnv(env),
	);

describe("EnvOverride.read", () => {
	it.effect("a value the audience accepts is Some", () =>
		Effect.map(read({ VITEST_AGENT_CONSOLE: "stream" }, "human"), (value) =>
			assert.deepStrictEqual(value, Option.some("stream")),
		),
	);

	it.effect("a value the audience does not accept is None, with one warning naming the accepted values", () => {
		const lines: Array<string> = [];
		return Effect.map(read({ VITEST_AGENT_CONSOLE: "stream" }, "agent", lines), (value) => {
			assert.deepStrictEqual(value, Option.none());
			assert.lengthOf(lines, 1);
			assert.include(lines[0] ?? "", "VITEST_AGENT_CONSOLE=stream");
			assert.include(lines[0] ?? "", "passthrough|silent|agent");
		});
	});

	it.effect("unset is None with no warning", () => {
		const lines: Array<string> = [];
		return Effect.map(read({}, "human", lines), (value) => {
			assert.deepStrictEqual(value, Option.none());
			assert.lengthOf(lines, 0);
		});
	});

	it.effect("an empty value is None with no warning, even when the provider preserves empty strings", () => {
		const lines: Array<string> = [];
		return EnvOverride.read({ envVar: "VITEST_AGENT_CONSOLE", accepts }).pipe(
			Effect.provide(Audience.layerTest("human")),
			Effect.provide(capture(lines)),
			Effect.provideService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown({ VITEST_AGENT_CONSOLE: "" }, { preserveEmptyStrings: true }),
			),
			Effect.tap((value) =>
				Effect.sync(() => {
					assert.deepStrictEqual(value, Option.none());
					assert.lengthOf(lines, 0);
				}),
			),
		);
	});

	it.effect("matching is case-insensitive and returns the accepted literal", () =>
		Effect.map(read({ VITEST_AGENT_CONSOLE: "CI-Annotations" }, "ci"), (value) =>
			assert.deepStrictEqual(value, Option.some("ci-annotations")),
		),
	);

	it("the result type narrows to the union of the accepted literals (type-level)", () => {
		const program = EnvOverride.read({ envVar: "X", accepts });
		type Accepted = "passthrough" | "silent" | "stream" | "agent" | "ci-annotations";
		// Assignable to exactly the five literals: a `string` result would not compile here.
		const ok: Effect.Effect<Option.Option<Accepted>, never, Audience> = program;
		// And not narrower than the union: one literal is too small.
		// @ts-expect-error the union is wider than "stream" alone
		const tooNarrow: Effect.Effect<Option.Option<"stream">, never, Audience> = program;
		assert.isDefined(ok);
		assert.isDefined(tooNarrow);
	});
});
