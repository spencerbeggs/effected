import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { ActionOutputs, Secret } from "../src/index.js";

/** Records what was masked, so ordering can be asserted. */
const recordingOutputs = () => {
	const masked: Array<string> = [];
	const layer = ActionOutputs.layerTest({
		setSecret: (value) =>
			// `Effect.suspend` so the record happens when the effect RUNS, not when
			// it is described — an eager recorder logs calls that never happened.
			Effect.suspend(() => {
				masked.push(value);
				return Effect.void;
			}),
	});
	return { masked, layer };
};

/**
 * A `ConfigProvider` over a fixed record. `ConfigProvider.ConfigProvider` is a
 * `Context.Reference` in v4, so it is overridden with `provideService` — there
 * is no `Effect.withConfigProvider`.
 */
const withConfig = <A, E, R>(values: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(
		effect,
		ConfigProvider.ConfigProvider,
		ConfigProvider.make((path) => {
			const value = values[path.join("_")];
			return Effect.succeed(value === undefined ? undefined : ConfigProvider.makeValue(value));
		}),
	);

describe("Secret", () => {
	describe("forChildEnv", () => {
		it.effect("returns plaintext for a child process", () => {
			const outputs = recordingOutputs();
			return Effect.gen(function* () {
				const env = yield* Secret.forChildEnv({ TOKEN: Redacted.make("s3cr3t") });
				assert.deepStrictEqual(env, { TOKEN: "s3cr3t" });
			}).pipe(Effect.provide(outputs.layer));
		});

		it.effect("masks every value it declassifies", () => {
			const outputs = recordingOutputs();
			return Effect.gen(function* () {
				const env = yield* Secret.forChildEnv({ A: Redacted.make("aaa"), B: Redacted.make("bbb") });
				assert.deepStrictEqual(outputs.masked, ["aaa", "bbb"]);
				assert.deepStrictEqual(env, { A: "aaa", B: "bbb" });
			}).pipe(Effect.provide(outputs.layer));
		});

		it.effect("masks a value before that value is in the returned record", () => {
			// The ordering is the invariant: a mask that ran after the caller
			// already held plaintext would be a mask the caller could skip.
			const seen: Array<string> = [];
			const layer = ActionOutputs.layerTest({
				setSecret: (value) =>
					Effect.suspend(() => {
						seen.push(`mask:${value}`);
						return Effect.void;
					}),
			});
			return Effect.gen(function* () {
				const env = yield* Secret.forChildEnv({ A: Redacted.make("aaa") });
				seen.push(`returned:${env.A}`);
				assert.deepStrictEqual(seen, ["mask:aaa", "returned:aaa"]);
			}).pipe(Effect.provide(layer));
		});

		it.effect("returns an empty record for no entries, masking nothing", () => {
			const outputs = recordingOutputs();
			return Effect.gen(function* () {
				assert.deepStrictEqual(yield* Secret.forChildEnv({}), {});
				assert.lengthOf(outputs.masked, 0);
			}).pipe(Effect.provide(outputs.layer));
		});
	});

	describe("forRunnerFile", () => {
		it.effect("masks then returns the plaintext", () => {
			const outputs = recordingOutputs();
			return Effect.gen(function* () {
				assert.strictEqual(yield* Secret.forRunnerFile(Redacted.make("ghs_abc")), "ghs_abc");
				assert.deepStrictEqual(outputs.masked, ["ghs_abc"]);
			}).pipe(Effect.provide(outputs.layer));
		});
	});

	describe("adopt", () => {
		it.effect("re-wraps a plaintext handoff as Redacted", () =>
			withConfig(
				{ HANDOFF_TOKEN: "from-parent" },
				Effect.gen(function* () {
					const adopted = yield* Secret.adopt("HANDOFF_TOKEN");
					assert.strictEqual(Redacted.value(adopted), "from-parent");
					assert.notInclude(String(adopted), "from-parent", "a Redacted must not leak through coercion");
				}),
			),
		);

		it.effect("fails when the handoff variable is absent, rather than yielding an empty secret", () =>
			withConfig(
				{},
				Effect.gen(function* () {
					const exit = yield* Effect.exit(Secret.adopt("ABSENT_TOKEN"));
					assert.strictEqual(exit._tag, "Failure");
				}),
			),
		);
	});

	describe("the declassification invariant", () => {
		const srcRoot = new URL("../src/", import.meta.url).pathname;

		/**
		 * Strip comments before scanning.
		 *
		 * @remarks
		 * A raw text scan reads TSDoc as code: a module whose comment *explains*
		 * that it does not unwrap a secret gets reported as unwrapping one. That
		 * happened — `OidcTokenIssuer` documents the invariant it obeys and failed
		 * this test for saying so. It is the same phantom-edge problem the bundle
		 * reachability walkers hit with `@example` imports, and it has the same fix.
		 */
		const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

		const unwrappingModules = (): ReadonlyArray<string> => {
			const found: Array<string> = [];
			const walk = (dir: string) => {
				for (const entry of readdirSync(dir, { withFileTypes: true })) {
					const path = join(dir, entry.name);
					if (entry.isDirectory()) {
						walk(path);
					} else if (
						entry.name.endsWith(".ts") &&
						stripComments(readFileSync(path, "utf8")).includes("Redacted.value")
					) {
						found.push(entry.name);
					}
				}
			};
			walk(srcRoot);
			return found.sort();
		};

		it("only Secret.ts unwraps a Redacted", () => {
			// The structural half of the invariant: declassification is coupled to
			// masking, and stays coupled only because nothing else may unwrap.
			// A reintroduction elsewhere fails here rather than in review.
			assert.deepStrictEqual(unwrappingModules(), ["Secret.ts"]);
		});

		it("the guard can fail — it is asserting on a non-empty set", () => {
			// Without this control, the assertion above would pass just as well if
			// the package had stopped using Redacted entirely — or if the comment
			// stripper had blinded the scan.
			assert.isAbove(unwrappingModules().length, 0);
		});

		it("the comment stripper removes comments and only comments", () => {
			// The stripper is now load-bearing for the invariant above, so it gets its
			// own discriminating test rather than being trusted.
			assert.notInclude(stripComments("/** mentions Redacted.value in TSDoc */\nconst a = 1;"), "Redacted.value");
			assert.include(stripComments("// a note\nconst t = Redacted.value(s);"), "Redacted.value");
		});
	});
});
