import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { OgGenerateError, resolveOgGenerator } from "../../src/meta/og-image.js";

const absent = (missing: string) => async (specifier: string) => {
	if (specifier === missing) throw new Error(`Cannot find module '${specifier}'`);
};

describe("resolveOgGenerator", () => {
	for (const missing of ["satori", "@resvg/resvg-js"]) {
		it.effect(`fails naming both peers when ${missing} is absent`, () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					resolveOgGenerator("satori", { packageName: "@scope/pkg", importModule: absent(missing) }),
				);
				assert.instanceOf(error, OgGenerateError);
				assert.strictEqual(error.packageName, "@scope/pkg");
				assert.include(error.message, "satori");
				assert.include(error.message, "@resvg/resvg-js");
			}),
		);
	}

	it.effect("answers a generator with a cache salt when both load, without rendering", () =>
		Effect.gen(function* () {
			const seen: string[] = [];
			const generate = yield* resolveOgGenerator("satori", {
				packageName: "@scope/pkg",
				importModule: async (specifier) => {
					seen.push(specifier);
				},
			});
			assert.deepStrictEqual(seen.sort(), ["@resvg/resvg-js", "satori"]);
			assert.isFunction(generate);
			assert.isString(generate.cacheSalt);
		}),
	);

	it.effect("loads the real peers installed here", () =>
		Effect.gen(function* () {
			const generate = yield* resolveOgGenerator("satori", { packageName: "@scope/pkg" });
			assert.isFunction(generate);
		}),
	);
});
