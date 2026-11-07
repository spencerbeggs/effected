import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { OgGenerateError, resolveOgGenerator } from "../../src/meta/og-image.js";

const notFound = (specifier: string): Error =>
	Object.assign(new Error(`Cannot find package '${specifier}' imported from /x.js`), { code: "ERR_MODULE_NOT_FOUND" });

const absent = (missing: string) => async (specifier: string) => {
	if (specifier === missing) throw notFound(specifier);
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
				assert.include(error.message, "install both");
			}),
		);
	}

	it.effect("carries the real error when an installed peer fails to load", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				resolveOgGenerator("satori", {
					packageName: "@scope/pkg",
					importModule: async (specifier) => {
						if (specifier === "@resvg/resvg-js") throw new Error("Cannot find native binding for darwin-arm64");
					},
				}),
			);
			assert.include(error.message, "@resvg/resvg-js");
			assert.include(error.message, "Cannot find native binding for darwin-arm64");
			assert.notInclude(error.message, "install both");
		}),
	);

	it.effect("does not mistake a module the peer loads in turn for the peer being absent", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				resolveOgGenerator("satori", {
					packageName: "@scope/pkg",
					importModule: async (specifier) => {
						if (specifier === "@resvg/resvg-js") throw notFound("@resvg/resvg-js-darwin-arm64");
					},
				}),
			);
			assert.include(error.message, "@resvg/resvg-js-darwin-arm64");
			assert.notInclude(error.message, "install both");
		}),
	);

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
