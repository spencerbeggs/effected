import { assert, describe, it } from "@effect/vitest";
import { decodeBundleManifest, encodeBundleManifest } from "@effected/manifest";
import { Effect, Schema } from "effect";
import { BundleConfig } from "../../src/config/BuildConfig.js";
import { bundleMetaOptionsOf } from "../../src/meta/bundle-config.js";
import { composeBundleManifest } from "../../src/meta/bundle-manifest.js";

const decode = Schema.decodeUnknownSync(BundleConfig);

const composed = (config: BundleConfig) =>
	composeBundleManifest({
		config: bundleMetaOptionsOf(config),
		leaf: undefined,
		project: undefined,
		packageName: "@scope/pkg",
		isPrivate: false,
		targets: [],
		generatedImage: undefined,
		repository: undefined,
	});

describe("bundleMetaOptionsOf", () => {
	it("maps an empty table to no options", () => {
		assert.deepStrictEqual(bundleMetaOptionsOf(decode({})), {});
	});

	it("carries the identity, and registries false, as written", () => {
		assert.deepStrictEqual(
			bundleMetaOptionsOf(decode({ name: "N", tagline: "T", description: "D", registries: false })),
			{
				name: "N",
				tagline: "T",
				description: "D",
				registries: false,
			},
		);
	});

	it("drops the renderer's name, and sets the generator only when the caller resolved one", () => {
		const table = decode({ openGraph: { generate: "satori", themeColor: "#000", cacheSalt: false } });
		assert.deepStrictEqual(bundleMetaOptionsOf(table), { openGraph: { themeColor: "#000", cacheSalt: false } });
		const generate = Object.assign(async () => new Uint8Array(), {});
		assert.strictEqual(bundleMetaOptionsOf(table, generate).openGraph?.generate, generate);
	});

	it.effect("composes a manifest the wire schema encodes and decodes back", () =>
		Effect.gen(function* () {
			const manifest = composed(
				decode({
					name: "N",
					openGraph: { images: [{ url: "https://x/og.png", width: 10 }], themeColor: "#000" },
					registries: [{ type: "npm", name: "npm", url: "https://r" }],
				}),
			);
			if (manifest === undefined) return assert.fail("expected a manifest");
			const encoded = yield* encodeBundleManifest(manifest);
			const decoded = yield* decodeBundleManifest(encoded);
			assert.deepStrictEqual(decoded.openGraph?.images, [{ url: "https://x/og.png", width: 10 }]);
			assert.deepStrictEqual(decoded.registries, [{ type: "npm", name: "npm", url: "https://r" }]);
		}),
	);
});
