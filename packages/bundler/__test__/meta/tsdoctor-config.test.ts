import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { TsdoctorConfig } from "../../src/config/BuildConfig.js";
import { decodeBundleManifest, encodeBundleManifest } from "../../src/meta/BundleManifest.js";
import { tsdoctorMetaOptionsOf } from "../../src/meta/tsdoctor-config.js";
import { composeTsdoctorManifest } from "../../src/meta/tsdoctor-manifest.js";

const decode = Schema.decodeUnknownSync(TsdoctorConfig);

const composed = (config: TsdoctorConfig) =>
	composeTsdoctorManifest({
		config: tsdoctorMetaOptionsOf(config),
		leaf: undefined,
		project: undefined,
		packageName: "@scope/pkg",
		isPrivate: false,
		targets: [],
		generatedImage: undefined,
		repository: undefined,
	});

describe("tsdoctorMetaOptionsOf", () => {
	it("maps an empty table to no options", () => {
		assert.deepStrictEqual(tsdoctorMetaOptionsOf(decode({})), {});
	});

	it("carries the identity, and registries false, as written", () => {
		assert.deepStrictEqual(
			tsdoctorMetaOptionsOf(decode({ name: "N", tagline: "T", description: "D", registries: false })),
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
		assert.deepStrictEqual(tsdoctorMetaOptionsOf(table), { openGraph: { themeColor: "#000", cacheSalt: false } });
		const generate = Object.assign(async () => new Uint8Array(), {});
		assert.strictEqual(tsdoctorMetaOptionsOf(table, generate).openGraph?.generate, generate);
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
