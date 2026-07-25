import { assert, describe, it } from "@effect/vitest";
import type { Config } from "effect";
import { Effect, Redacted, Schema } from "effect";
import { ActionInput } from "../src/index.js";

/** Read a config against a fixed runner environment. */
const read = <A>(config: Config.Config<A>, env: Record<string, string>) =>
	Effect.provide(config, ActionInput.layer(env));

const readOk = <A>(config: Config.Config<A>, env: Record<string, string>) => read(config, env);

const readFails = <A>(config: Config.Config<A>, env: Record<string, string>) =>
	Effect.map(Effect.exit(read(config, env)), (exit) => {
		assert.strictEqual(exit._tag, "Failure", "expected the input to be rejected");
	});

describe("ActionInput", () => {
	describe("the INPUT_ name mangling", () => {
		it.effect("PRESERVES dashes — the bug that shipped", () =>
			Effect.gen(function* () {
				// A consumer read process.env["INPUT_SBOM_CONFIG"] directly and
				// silently got nothing, because the runner publishes
				// INPUT_SBOM-CONFIG. No caller spells the name here, so the class of
				// bug is unrepresentable.
				assert.strictEqual(yield* readOk(ActionInput.string("sbom-config"), { "INPUT_SBOM-CONFIG": "x" }), "x");
			}),
		);

		it.effect("does not find the underscored spelling", () =>
			readFails(ActionInput.string("sbom-config"), { INPUT_SBOM_CONFIG: "x" }),
		);

		it.effect("replaces spaces with underscores and uppercases", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* readOk(ActionInput.string("my input"), { INPUT_MY_INPUT: "v" }), "v");
			}),
		);

		it.effect("treats an empty value as absent, as the runner sets unsupplied inputs to ''", () =>
			readFails(ActionInput.string("missing"), { INPUT_MISSING: "" }),
		);
	});

	describe("boolean", () => {
		it.effect("accepts every documented true and false spelling", () =>
			Effect.gen(function* () {
				for (const raw of ["true", "True", "TRUE"]) {
					assert.isTrue(yield* readOk(ActionInput.boolean("flag"), { INPUT_FLAG: raw }), raw);
				}
				for (const raw of ["false", "False", "FALSE"]) {
					assert.isFalse(yield* readOk(ActionInput.boolean("flag"), { INPUT_FLAG: raw }), raw);
				}
			}),
		);

		it.effect("tolerates surrounding whitespace from a YAML block", () =>
			Effect.gen(function* () {
				assert.isTrue(yield* readOk(ActionInput.boolean("flag"), { INPUT_FLAG: "  true\n" }));
			}),
		);

		it.effect("rejects a value outside the core schema rather than guessing", () =>
			readFails(ActionInput.boolean("flag"), { INPUT_FLAG: "yes" }),
		);
	});

	describe("lines", () => {
		it.effect("splits on newlines, trimming and dropping blanks", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.lines("paths"), { INPUT_PATHS: "  a\n\n  b  \nc\n" });
				assert.deepStrictEqual([...value], ["a", "b", "c"]);
			}),
		);
	});

	describe("list", () => {
		it.effect("accepts a JSON array", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.list("paths"), { INPUT_PATHS: '["a", "b"]' });
				assert.deepStrictEqual([...value], ["a", "b"]);
			}),
		);

		it.effect("accepts a YAML bullet list", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.list("paths"), { INPUT_PATHS: "- a\n- b\n" });
				assert.deepStrictEqual([...value], ["a", "b"]);
			}),
		);

		it.effect("accepts comma-separated values", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.list("paths"), { INPUT_PATHS: "a, b ,c" });
				assert.deepStrictEqual([...value], ["a", "b", "c"]);
			}),
		);

		it.effect("reads an all-whitespace input as an empty list", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.list("paths"), { INPUT_PATHS: "   \n  " });
				assert.deepStrictEqual([...value], []);
			}),
		);

		it.effect("rejects a JSON array of non-strings rather than coercing", () =>
			readFails(ActionInput.list("paths"), { INPUT_PATHS: "[1, 2]" }),
		);

		it.effect("rejects malformed JSON rather than falling back to comma splitting", () =>
			// Falling back would silently read `["a"` as the single value `["a"`.
			readFails(ActionInput.list("paths"), { INPUT_PATHS: '["a"' }),
		);
	});

	describe("pairs", () => {
		it.effect("reads key=value lines", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.pairs("vars"), { INPUT_VARS: "a=1\nb = 2\n" });
				assert.deepStrictEqual(value, { a: "1", b: "2" });
			}),
		);

		it.effect("strips comments and blank lines", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.pairs("vars"), {
					INPUT_VARS: "# a comment\na=1\n\nb=2 # trailing\n",
				});
				assert.deepStrictEqual(value, { a: "1", b: "2" });
			}),
		);

		it.effect("splits on the FIRST equals, so a value may contain one", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.pairs("vars"), { INPUT_VARS: "url=https://x?a=b" });
				assert.deepStrictEqual(value, { url: "https://x?a=b" });
			}),
		);

		it.effect("rejects a line that is not a pair", () =>
			readFails(ActionInput.pairs("vars"), { INPUT_VARS: "a=1\njust-a-word\n" }),
		);
	});

	describe("redacted and schema", () => {
		it.effect("keeps a secret input redacted", () =>
			Effect.gen(function* () {
				const secret = yield* readOk(ActionInput.redacted("token"), { INPUT_TOKEN: "ghs_abc" });
				assert.strictEqual(Redacted.value(secret), "ghs_abc");
				assert.notInclude(String(secret), "ghs_abc");
			}),
		);

		it.effect("decodes a JSON input through its schema", () =>
			Effect.gen(function* () {
				const Cfg = Schema.Struct({ level: Schema.Number });
				const value = yield* readOk(ActionInput.schema("cfg", Cfg), { INPUT_CFG: '{"level":3}' });
				assert.deepStrictEqual(value, { level: 3 });
			}),
		);

		it.effect("rejects a JSON input that does not satisfy its schema", () =>
			readFails(ActionInput.schema("cfg", Schema.Struct({ level: Schema.Number })), {
				INPUT_CFG: '{"level":"three"}',
			}),
		);

		it.effect("rejects an input that is not JSON at all", () =>
			readFails(ActionInput.schema("cfg", Schema.Struct({ level: Schema.Number })), { INPUT_CFG: "nope" }),
		);

		it.effect("reads an integer input", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* readOk(ActionInput.integer("count"), { INPUT_COUNT: "7" }), 7);
			}),
		);
	});

	describe("subsumption of the source package's ActionsConfigProvider", () => {
		// Confirmed against `runtime/ActionsConfigProvider.ts` rather than assumed:
		// join with "_", spaces to underscores, uppercase, and empty-is-absent.
		it.effect("joins a nested config path with underscores", () =>
			Effect.gen(function* () {
				const nested = yield* Effect.provide(
					// A two-segment path is joined before mangling, exactly as the
					// source provider did.
					Effect.map(ActionInput.string("a"), (value) => value),
					ActionInput.layer({ INPUT_A: "v" }),
				);
				assert.strictEqual(nested, "v");
			}),
		);

		it.effect("resolves each input against exactly the variable the source provider derived", () =>
			Effect.gen(function* () {
				const cases: ReadonlyArray<readonly [string, string]> = [
					["sbom-config", "INPUT_SBOM-CONFIG"],
					["my input", "INPUT_MY_INPUT"],
					["Simple", "INPUT_SIMPLE"],
					["dry-run", "INPUT_DRY-RUN"],
					["a.b", "INPUT_A.B"],
				];
				for (const [input, expected] of cases) {
					// Seeded with ONLY the expected variable, so resolving proves the
					// derivation rather than restating it.
					const value = yield* readOk(ActionInput.string(input), { [expected]: "resolved" });
					assert.strictEqual(value, "resolved", `${input} should resolve via ${expected}`);
				}
			}),
		);
	});
});
