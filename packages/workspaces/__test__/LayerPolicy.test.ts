import { assert, describe, it, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { LayerPolicy } from "../src/testing.js";

const VALID = { layers: [["app"], ["core"]], tooling: [], unconstrained: ["@e2e/*"] };

describe("LayerPolicy.decode", () => {
	it.effect("defaults fields to all four dependency maps, and honours an explicit list", () =>
		Effect.gen(function* () {
			const all = yield* LayerPolicy.decode(VALID);
			assert.deepStrictEqual(all.effectiveFields, [
				"dependencies",
				"devDependencies",
				"peerDependencies",
				"optionalDependencies",
			]);
			const runtime = yield* LayerPolicy.decode({ ...VALID, fields: ["dependencies", "peerDependencies"] });
			assert.deepStrictEqual(runtime.effectiveFields, ["dependencies", "peerDependencies"]);
		}),
	);

	it.effect("ignores keys it does not model (systems' harness)", () =>
		Effect.gen(function* () {
			const policy = yield* LayerPolicy.decode({ ...VALID, harness: ["@e2e/*"] });
			assert.deepStrictEqual(policy.layers, [["app"], ["core"]]);
		}),
	);

	it.effect("rejects a required edge not written as 'a -> b'", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(LayerPolicy.decode({ ...VALID, requiredEdges: ["app->core"] }));
			assert.strictEqual(error.reason, "decode");
		}),
	);

	it.effect("rejects an unconstrained glob that cannot compile", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(LayerPolicy.decode({ ...VALID, unconstrained: ["a".repeat(65_537)] }));
			assert.strictEqual(error.reason, "decode");
		}),
	);
});

describe("LayerPolicy.load", () => {
	layer(
		MemoryFileSystem.layerWith({
			"/repo/layers.json": JSON.stringify(VALID),
			"/repo/broken.json": "{ not json",
		}),
	)((it) => {
		it.effect("reads and decodes a committed policy", () =>
			Effect.gen(function* () {
				const policy = yield* LayerPolicy.load("/repo/layers.json");
				assert.deepStrictEqual(policy.unconstrained, ["@e2e/*"]);
			}),
		);

		it.effect("names the file and the failure kind", () =>
			Effect.gen(function* () {
				const missing = yield* Effect.flip(LayerPolicy.load("/repo/nope.json"));
				assert.deepStrictEqual([missing.reason, missing.path], ["read", "/repo/nope.json"]);
				const broken = yield* Effect.flip(LayerPolicy.load("/repo/broken.json"));
				assert.deepStrictEqual([broken.reason, broken.path], ["json", "/repo/broken.json"]);
			}),
		);
	});
});
