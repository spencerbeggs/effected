import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Cache } from "@effected/store";
import { DateTime, Duration, Effect, Exit, FileSystem, Layer, Option, Path } from "effect";
import { TestClock } from "effect/testing";
import { PackageSpec, TypeCache, TypeCacheError, TypeCacheMetadata } from "../src/index.js";

const cacheDir = mkdtempSync(join(tmpdir(), "ts-vfs-cache-"));

const TestLayer = TypeCache.layer({ cacheDir }).pipe(
	Layer.provideMerge(Layer.mergeAll(Cache.layerTest(), NodeFileSystem.layer, Path.layer)),
);

const epoch = DateTime.makeUnsafe(0);

describe("TypeCache", () => {
	layer(TestLayer)((it) => {
		it.effect("write, exists, read, listFiles and getVfs round-trip", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "round-trip", version: "1.0.0" });
				assert.isFalse(yield* cache.exists(pkg));
				yield* cache.write(pkg, "package.json", '{"name":"round-trip"}');
				yield* cache.write(pkg, "dist/index.d.ts", "export declare const x: number;");
				assert.isTrue(yield* cache.exists(pkg));
				assert.strictEqual(yield* cache.read(pkg, "dist/index.d.ts"), "export declare const x: number;");
				const files = (yield* cache.listFiles(pkg)).toSorted();
				assert.deepStrictEqual(files, ["dist/index.d.ts", "package.json"]);
				const vfs = yield* cache.getVfs(pkg);
				assert.deepStrictEqual([...vfs.keys()].toSorted(), [
					"node_modules/round-trip/dist/index.d.ts",
					"node_modules/round-trip/package.json",
				]);
			}),
		);

		it.effect("scoped package names nest correctly in the vfs prefix", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "@scope/pkg", version: "2.0.0" });
				yield* cache.write(pkg, "index.d.ts", "export {};");
				const vfs = yield* cache.getVfs(pkg);
				assert.isTrue(vfs.has("node_modules/@scope/pkg/index.d.ts"));
			}),
		);

		it.effect("write rejects traversal and absolute paths as typed failures", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "hostile", version: "1.0.0" });
				for (const filePath of [
					"../escape.d.ts",
					"a/../../escape.d.ts",
					"/etc/passwd",
					"C:\\evil",
					"\\\\unc\\share",
					"",
				]) {
					const exit = yield* Effect.exit(cache.write(pkg, filePath, "pwned"));
					assert.isTrue(Exit.isFailure(exit), `expected "${filePath}" to be rejected`);
				}
				const readExit = yield* Effect.exit(cache.read(pkg, "../../secret"));
				assert.isTrue(Exit.isFailure(readExit));
			}),
		);

		it.effect("write failures carry the TypeCacheError tag and operation", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "hostile", version: "1.0.0" });
				const error = yield* Effect.flip(cache.write(pkg, "../escape.d.ts", "pwned"));
				assert.instanceOf(error, TypeCacheError);
				assert.strictEqual(error._tag, "TypeCacheError");
				assert.strictEqual(error.operation, "write");
			}),
		);

		it.effect("metadata round-trips through the store, including ttl", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "meta", version: "1.2.3" });
				const written = TypeCacheMetadata.make({
					version: "1.2.3",
					cachedAt: epoch,
					ttl: Duration.hours(2),
				});
				yield* cache.writeMetadata(pkg, written);
				const read = yield* cache.readMetadata(pkg);
				assert.isTrue(Option.isSome(read));
				if (Option.isSome(read)) {
					assert.strictEqual(read.value.version, "1.2.3");
					assert.isTrue(DateTime.Equivalence(read.value.cachedAt, epoch));
					assert.isTrue(read.value.ttl !== undefined && Duration.equals(read.value.ttl, Duration.hours(2)));
				}
			}),
		);

		it.effect("ttl expiry is driven by the clock: hit before, stale after", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "stale", version: "1.0.0" });
				const now = yield* DateTime.now;
				yield* cache.write(pkg, "index.d.ts", "export {};");
				yield* cache.writeMetadata(
					pkg,
					TypeCacheMetadata.make({ version: "1.0.0", cachedAt: now, ttl: Duration.minutes(30) }),
				);
				assert.isTrue(Option.isSome(yield* cache.readMetadata(pkg)));
				yield* TestClock.adjust(Duration.minutes(30));
				// Metadata expired and was evicted on read; files remain — the stale shape.
				assert.isTrue(Option.isNone(yield* cache.readMetadata(pkg)));
				assert.isTrue(yield* cache.exists(pkg));
			}),
		);

		it.effect("metadata without a ttl never expires", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "eternal", version: "1.0.0" });
				const now = yield* DateTime.now;
				yield* cache.writeMetadata(pkg, TypeCacheMetadata.make({ version: "1.0.0", cachedAt: now }));
				yield* TestClock.adjust(Duration.days(365));
				assert.isTrue(Option.isSome(yield* cache.readMetadata(pkg)));
			}),
		);

		it.effect("remove deletes metadata and files", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const pkg = PackageSpec.make({ name: "removable", version: "1.0.0" });
				const now = yield* DateTime.now;
				yield* cache.write(pkg, "index.d.ts", "export {};");
				yield* cache.writeMetadata(pkg, TypeCacheMetadata.make({ version: "1.0.0", cachedAt: now }));
				yield* cache.remove(pkg);
				assert.isFalse(yield* cache.exists(pkg));
				assert.isTrue(Option.isNone(yield* cache.readMetadata(pkg)));
				// Removing an absent package is a no-op, not an error.
				yield* cache.remove(pkg);
			}),
		);

		it.effect("prune evicts expired entries and deletes their directories", () =>
			Effect.gen(function* () {
				const cache = yield* TypeCache;
				const fs = yield* FileSystem.FileSystem;
				// The store and clock are shared across the group: flush anything an
				// earlier test left expired so the assertions below are exact.
				yield* cache.prune;
				const doomed = PackageSpec.make({ name: "doomed", version: "1.0.0" });
				const survivor = PackageSpec.make({ name: "survivor", version: "1.0.0" });
				const now = yield* DateTime.now;
				yield* cache.write(doomed, "index.d.ts", "export {};");
				yield* cache.writeMetadata(
					doomed,
					TypeCacheMetadata.make({ version: "1.0.0", cachedAt: now, ttl: Duration.minutes(5) }),
				);
				yield* cache.write(survivor, "index.d.ts", "export {};");
				yield* cache.writeMetadata(survivor, TypeCacheMetadata.make({ version: "1.0.0", cachedAt: now }));
				yield* TestClock.adjust(Duration.minutes(10));
				const result = yield* cache.prune;
				assert.strictEqual(result.count, 1);
				assert.deepStrictEqual(result.removed, [{ name: "doomed", version: "1.0.0" }]);
				assert.isFalse(yield* fs.exists(join(cacheDir, "doomed", "1.0.0")));
				assert.isTrue(yield* cache.exists(survivor));
			}),
		);
	});

	it.effect("layer dies on a relative cacheDir (wiring defect)", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.scoped(
					Layer.build(
						TypeCache.layer({ cacheDir: "relative/dir" }).pipe(
							Layer.provide(Layer.mergeAll(Cache.layerTest(), NodeFileSystem.layer, Path.layer)),
						),
					),
				),
			);
			assert.isTrue(Exit.isFailure(exit));
		}),
	);
});
