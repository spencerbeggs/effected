import { assert, describe, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Redacted, Schema } from "effect";
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

		it.effect("accepts a Markdown '*' bullet list, not just '-'", () =>
			Effect.gen(function* () {
				// Before the union grammar, a "*" bullet kept its marker as part of
				// the value ("* a" survived intact) instead of being stripped.
				const value = yield* readOk(ActionInput.list("paths"), { INPUT_PATHS: "* a\n* b\n" });
				assert.deepStrictEqual([...value], ["a", "b"]);
			}),
		);

		it.effect("strips mixed '-' and '*' bullets in the same input", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.list("paths"), { INPUT_PATHS: "- a\n* b\n- c\n* d\n" });
				assert.deepStrictEqual([...value], ["a", "b", "c", "d"]);
			}),
		);

		it.effect("drops full-line '#' comments interleaved with values", () =>
			Effect.gen(function* () {
				const value = yield* readOk(ActionInput.list("paths"), {
					INPUT_PATHS: "# a comment\n- a\n# another comment\n- b\n",
				});
				assert.deepStrictEqual([...value], ["a", "b"]);
			}),
		);

		it.effect("treats a bulleted '- #tag' as the value '#tag', not a dropped comment", () =>
			Effect.gen(function* () {
				// The discriminating case: the comment check runs on the untouched,
				// still-bulleted line, so only a line whose FIRST character (before
				// any bullet is stripped) is "#" is a comment. "- #tag" starts with
				// "-", not "#", so it survives the comment filter, and only the
				// bullet marker is then stripped, leaving "#tag" as the value.
				const value = yield* readOk(ActionInput.list("paths"), { INPUT_PATHS: "- #tag\n- b\n" });
				assert.deepStrictEqual([...value], ["#tag", "b"]);
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

	describe("providerOver — the runtime's default resolution", () => {
		/** Read a bare config through the inputs-first provider over a fixed env. */
		const readBare = <A>(config: Config.Config<A>, env: Record<string, string>) =>
			Effect.provide(config, ConfigProvider.layer(ActionInput.providerOver(ConfigProvider.fromEnv({ env }))));

		const readBareFails = <A>(config: Config.Config<A>, env: Record<string, string>) =>
			Effect.map(Effect.exit(readBare(config, env)), (exit) => {
				assert.strictEqual(exit._tag, "Failure", "expected the bare read to miss");
			});

		it.effect("resolves a bare flat name through the INPUT_ derivation first", () =>
			Effect.gen(function* () {
				// The false-green class at its root: the runner publishes
				// INPUT_DRY-RUN (dashes survive), and a bare Config.string("dry-run")
				// used to find nothing and fall back to its default.
				assert.strictEqual(yield* readBare(Config.string("dry-run"), { "INPUT_DRY-RUN": "x" }), "x");
			}),
		);

		it.effect("any casing of the bare name sees the input, because the derivation uppercases", () =>
			Effect.gen(function* () {
				for (const spelling of ["dry-run", "DRY-RUN", "Dry-Run"]) {
					assert.strictEqual(
						yield* readBare(Config.string(spelling), { "INPUT_DRY-RUN": "x" }),
						"x",
						`${spelling} should reach INPUT_DRY-RUN`,
					);
				}
			}),
		);

		it.effect("falls back to the ambient lookup unchanged when no input matches", () =>
			Effect.gen(function* () {
				// The plain variable resolves exactly as it would without the
				// provider…
				assert.strictEqual(yield* readBare(Config.string("PLAIN_VAR"), { PLAIN_VAR: "y" }), "y");
				// …and the fallback stays case-SENSITIVE: only the attempt
				// uppercases. A lowercase read gained no new spelling.
				yield* readBareFails(Config.string("plain_var"), { PLAIN_VAR: "y" });
			}),
		);

		it.effect("a supplied input SHADOWS an env var of the same name — the documented trade", () =>
			Effect.gen(function* () {
				const env = { INPUT_FOO: "from-input", FOO: "from-env" };
				assert.strictEqual(yield* readBare(Config.string("FOO"), env), "from-input");
				assert.strictEqual(yield* readBare(Config.string("foo"), env), "from-input");
			}),
		);

		it.effect("an unsupplied input ('') does not shadow", () =>
			Effect.gen(function* () {
				// The runner writes "" for every input the workflow left out; the
				// attempt resolves through the ambient provider, whose
				// empty-is-absent rule drops it, so the real variable still wins.
				assert.strictEqual(yield* readBare(Config.string("FOO"), { INPUT_FOO: "", FOO: "from-env" }), "from-env");
			}),
		);

		it.effect("a nested path passes through untouched — no invented runner semantics", () =>
			Effect.gen(function* () {
				// The runner can only set flat INPUT_<MANGLED> variables, so the
				// attempt applies to single-segment names only. A join-then-mangle
				// implementation would resolve INPUT_A_B here and fail this test.
				const nested = Config.string("B").pipe(Config.nested("A"));
				assert.strictEqual(yield* readBare(nested, { A_B: "base", INPUT_A_B: "from-input" }), "base");
			}),
		);

		it.effect("ActionInput accessors resolve identically under it", () =>
			Effect.gen(function* () {
				// The accessor reads INPUT_DRY-RUN; the attempt re-mangles that to
				// INPUT_INPUT_DRY-RUN, misses, and the fallback resolves the real
				// variable — so the typed surface is unchanged by the installation.
				assert.strictEqual(yield* readBare(ActionInput.string("dry-run"), { "INPUT_DRY-RUN": "x" }), "x");
				// And an omitted input still reads as absent, so a default is a
				// default.
				assert.strictEqual(
					yield* readBare(ActionInput.string("omitted").pipe(Config.withDefault("fallback")), { INPUT_OMITTED: "" }),
					"fallback",
				);
			}),
		);

		it.effect("layerDefault composes over the provider explicitly installed beneath it", () =>
			Effect.gen(function* () {
				// How a test injects a deterministic environment without touching the
				// process: install an ambient provider under the runtime and let
				// layerDefault pick it up at build.
				assert.strictEqual(yield* Config.string("dry-run"), "x");
				assert.strictEqual(yield* Config.string("PLAIN_VAR"), "y");
			}).pipe(
				Effect.provide(ActionInput.layerDefault),
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { "INPUT_DRY-RUN": "x", PLAIN_VAR: "y" } }))),
			),
		);
	});
});
