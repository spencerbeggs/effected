import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { MemoryFileSystem } from "../src/index.js";
import { caseInsensitiveSuite } from "./CaseInsensitiveContract.js";

// The host-proven contract (integration/case-insensitive.int.test.ts) against
// the memory engine built with `caseSensitive: false`.
caseInsensitiveSuite("memory", MemoryFileSystem.layerWith({}, { caseSensitive: false }));

describe("case-insensitive facade", () => {
	it.effect("the view and both ports fold", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(
				{ "/Repo/Docs.json": "{}" },
				{ caseSensitive: false },
			);
			assert.strictEqual(volume.text("/repo/docs.JSON"), "{}");
			assert.isTrue(volume.has("/REPO"));
			assert.isTrue(volume.isDirectory("/rEpO"));
			assert.deepStrictEqual(volume.readDirectory("/repo"), ["Docs.json"]);
			assert.deepStrictEqual(volume.paths(), ["/Repo/Docs.json"]);
			assert.deepStrictEqual(Object.keys(volume.snapshot()), ["/Repo/Docs.json"]);
			assert.strictEqual(volume.lstat("/REPO/DOCS.JSON")?.kind, "file");
			assert.strictEqual(MemoryFileSystem.syncFileSystem(volume).readFile("/repo/docs.json"), "{}");
			assert.deepStrictEqual(MemoryFileSystem.syncFileSystem(volume).readDirectory("/REPO"), ["Docs.json"]);
		}),
	);

	it.effect("seed keys differing only by case address one entry", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(
				{ "/a/X.txt": "1", "/a/x.txt": "2" },
				{ caseSensitive: false },
			);
			assert.deepStrictEqual(volume.paths(), ["/a/X.txt"]);
			assert.strictEqual(volume.text("/a/x.txt"), "2");
		}),
	);

	it.effect("the default stays case-sensitive", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({ "/Docs.json": "{}" });
			assert.isUndefined(volume.text("/docs.json"));
			assert.isFalse(volume.has("/DOCS.JSON"));
		}),
	);
});
