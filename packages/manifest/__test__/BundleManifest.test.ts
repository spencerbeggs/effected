// Ported from tsdoctor packages/manifest/__test__/manifest.test.ts (@tsdoctor/manifest 0.4.0) by way of @effected/bundler, 2026-11-08, every case intact.
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
	BUNDLE_MANIFEST_FILENAME,
	BundleManifestError,
	KNOWN_REGISTRY_TYPES,
	MANIFEST_SPEC,
	decodeBundleManifest,
	decodeManifestSource,
	encodeBundleManifest,
	isKnownRegistryType,
} from "../src/index.js";

const full = {
	spec: 1,
	name: "Kitchen Sink",
	tagline: "Every API Extractor shape",
	description: "A fixture.",
	project: { name: "tsdoctor", tagline: "API docs from api.json" },
	openGraph: {
		images: [{ path: "og/kitchensink.png", type: "image/png", width: 1200, height: 630, alt: "Kitchen Sink" }],
		themeColor: "#0f172a",
	},
	sbom: { path: "kitchensink.sbom.json", format: "spdx-json" },
	registries: [{ type: "npm", name: "npm", url: "https://www.npmjs.com/package/@modules/kitchensink" }],
} as const;

describe("BundleManifest", () => {
	it.effect("encodes what it decodes, byte for byte", () =>
		Effect.gen(function* () {
			const decoded = yield* decodeBundleManifest(full);
			const encoded = yield* encodeBundleManifest(decoded);
			assert.deepStrictEqual(encoded, full);
		}),
	);

	it("pins the spec version", () => {
		assert.strictEqual(MANIFEST_SPEC, 1);
	});

	it.effect("rejects an image with both path and url", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(
				decodeBundleManifest({ spec: 1, openGraph: { images: [{ path: "a.png", url: "https://x/a.png" }] } }),
			);
			assert.strictEqual(result._tag, "Failure");
		}),
	);
});

describe("ManifestSource", () => {
	it.effect("decodes a leaf file and drops spec and project", () =>
		Effect.gen(function* () {
			const source = yield* decodeManifestSource({ spec: 1, project: { name: "x" }, name: "Leaf", tagline: "t" });
			assert.deepStrictEqual(source, { name: "Leaf", tagline: "t" });
		}),
	);

	it.effect("carries a path into the error", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(decodeManifestSource({ name: 42 }, "/pkg/bundle.json"));
			assert.strictEqual(result._tag === "Failure" && result.failure.path, "/pkg/bundle.json");
		}),
	);
});

describe("BundleManifest reader tolerance", () => {
	it.effect("decodes the minimal manifest, spec alone", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* decodeBundleManifest({ spec: 1 }), { spec: 1 });
		}),
	);

	it.effect("rejects any spec but 1", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(decodeBundleManifest({ spec: 2 }));
			assert.strictEqual(result._tag, "Failure");
			const control = yield* Effect.result(decodeBundleManifest({ spec: 1 }));
			assert.strictEqual(control._tag, "Success");
		}),
	);

	it.effect("ignores an unknown top-level field, so an old reader consumes a new bundle", () =>
		Effect.gen(function* () {
			const decoded = yield* decodeBundleManifest({ spec: 1, name: "N", futureField: { x: 1 } });
			assert.deepStrictEqual(decoded, { spec: 1, name: "N" });
		}),
	);

	it.effect("accepts an unknown registry type and sbom format", () =>
		Effect.gen(function* () {
			const decoded = yield* decodeBundleManifest({
				spec: 1,
				sbom: { path: "x.sbom.json", format: "cyclonedx-xml" },
				registries: [{ type: "future-registry", name: "Future", url: "https://example.com/pkg" }],
			});
			assert.strictEqual(decoded.registries?.[0]?.type, "future-registry");
			assert.isFalse(isKnownRegistryType("future-registry"));
		}),
	);

	it.effect("rejects an image with neither path nor url, and accepts each alone", () =>
		Effect.gen(function* () {
			const neither = yield* Effect.result(decodeBundleManifest({ spec: 1, openGraph: { images: [{ alt: "x" }] } }));
			assert.strictEqual(neither._tag, "Failure");
			const path = yield* Effect.result(decodeBundleManifest({ spec: 1, openGraph: { images: [{ path: "og.png" }] } }));
			assert.strictEqual(path._tag, "Success");
			const url = yield* Effect.result(
				decodeBundleManifest({ spec: 1, openGraph: { images: [{ url: "https://example.com/og.png" }] } }),
			);
			assert.strictEqual(url._tag, "Success");
		}),
	);

	it("names the known registry families", () => {
		assert.deepStrictEqual([...KNOWN_REGISTRY_TYPES], ["npm", "jsr"]);
		assert.isTrue(isKnownRegistryType("npm"));
		assert.isTrue(isKnownRegistryType("jsr"));
		assert.isFalse(isKnownRegistryType("NPM"));
	});

	it("pins the sidecar file name", () => {
		assert.strictEqual(BUNDLE_MANIFEST_FILENAME, "bundle.json");
	});
});

describe("BundleManifestError", () => {
	it.effect("names the file when decode was given a path, and omits the key when it was not", () =>
		Effect.gen(function* () {
			const withPath = yield* Effect.flip(decodeBundleManifest({ spec: 9 }, "/pkg/meta/bundle.json"));
			assert.instanceOf(withPath, BundleManifestError);
			assert.strictEqual(withPath.message, "Invalid bundle.json manifest at /pkg/meta/bundle.json");
			const without = yield* Effect.flip(decodeBundleManifest({ spec: 9 }));
			assert.strictEqual(without.message, "Invalid bundle.json manifest");
			assert.notProperty(without, "path");
		}),
	);

	it.effect("fails encode on a value outside the schema", () =>
		Effect.gen(function* () {
			const invalid = { spec: 1, openGraph: { images: [{ path: "a.png", url: "https://x/a.png" }] } } as const;
			const error = yield* Effect.flip(encodeBundleManifest(invalid));
			assert.strictEqual(error._tag, "BundleManifestError");
		}),
	);
});
