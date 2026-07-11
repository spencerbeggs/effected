import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Cache } from "@effected/store";
import { Duration, Effect, Layer, Option, Path, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { PackageFetcherShape, RegistryEvent } from "../src/index.js";
import {
	BatchLoadError,
	FetchError,
	PackageFetcher,
	PackageManifest,
	PackageNotFoundError,
	PackageSpec,
	RegistryObserver,
	TypeCache,
	TypeRegistry,
	VersionNotFoundError,
} from "../src/index.js";

const zodManifest = Schema.decodeUnknownSync(PackageManifest)({
	name: "zod",
	version: "3.23.8",
	types: "./index.d.ts",
	exports: { ".": { types: "./index.d.ts" } },
});

/** A canned fetcher: `known` packages succeed; everything else 404s. */
const mockFetcher = (known: ReadonlySet<string>): PackageFetcherShape => {
	const notFound = (pkg: PackageSpec) =>
		Effect.fail(new PackageNotFoundError({ name: pkg.name, version: pkg.version }));
	return {
		getVersions: (name) =>
			name === "zod"
				? Effect.succeed({ versions: ["3.23.8", "3.22.4", "3.0.0-beta.1"], tags: { latest: "3.23.8" } })
				: Effect.fail(
						new FetchError({
							url: `https://data.jsdelivr.com/v1/package/npm/${name}`,
							status: 404,
							kind: "status",
							cause: "nope",
						}),
					),
		getFileTree: (pkg) => (known.has(pkg.name) ? Effect.succeed(["package.json", "index.d.ts"]) : notFound(pkg)),
		downloadFile: (pkg, path) => (known.has(pkg.name) ? Effect.succeed(`content:${path}`) : notFound(pkg)),
		getPackageJson: (pkg) =>
			known.has(pkg.name)
				? Effect.succeed(Schema.decodeUnknownSync(PackageManifest)({ name: pkg.name, types: "./index.d.ts" }))
				: notFound(pkg),
		getTypeFiles: (pkg) =>
			known.has(pkg.name)
				? Effect.succeed(new Map([["index.d.ts", `declare const ${pkg.name.replace(/[^a-z]/g, "_")}: unknown;`]]))
				: notFound(pkg),
	};
};

const registryLayer = (known: ReadonlySet<string>) =>
	TypeRegistry.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				TypeCache.layer({ cacheDir: mkdtempSync(join(tmpdir(), "ts-vfs-registry-")) }),
				Layer.succeed(PackageFetcher, mockFetcher(known)),
			),
		),
		Layer.provide(Layer.mergeAll(Cache.layerTest(), NodeFileSystem.layer, Path.layer)),
	);

const recording = (events: Array<RegistryEvent>): Layer.Layer<RegistryObserver> =>
	RegistryObserver.layerCallback((event) => events.push(event));

const tags = (events: ReadonlyArray<RegistryEvent>): ReadonlyArray<string> => events.map((event) => event._tag);

describe("TypeRegistry", () => {
	describe("single-package ladder", () => {
		layer(registryLayer(new Set(["zod"])))((it) => {
			it.effect("miss → fetch → hit, with the event sequence per path", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const zod = PackageSpec.make({ name: "zod", version: "3.23.8" });

					const missEvents: Array<RegistryEvent> = [];
					const vfs = yield* registry
						.getPackageVfs(zod, { ttl: Duration.hours(1) })
						.pipe(Effect.provide(recording(missEvents)));
					assert.isTrue(vfs.has("node_modules/zod/index.d.ts"));
					assert.isTrue(vfs.has("node_modules/zod/package.json"));
					assert.deepStrictEqual(tags(missEvents), ["CacheMiss", "FetchStart", "PackageLoaded"]);
					const loaded = missEvents[2];
					if (loaded?._tag === "PackageLoaded") assert.strictEqual(loaded.source, "network");

					const hitEvents: Array<RegistryEvent> = [];
					yield* registry.getPackageVfs(zod).pipe(Effect.provide(recording(hitEvents)));
					assert.deepStrictEqual(tags(hitEvents), ["CacheHit", "PackageLoaded"]);
					const hit = hitEvents[0];
					if (hit?._tag === "CacheHit") assert.isTrue(Duration.equals(hit.age, Duration.zero));
					const reloaded = hitEvents[1];
					if (reloaded?._tag === "PackageLoaded") assert.strictEqual(reloaded.source, "cache");

					// Past the ttl the metadata expires: files remain → stale → refetch.
					yield* TestClock.adjust(Duration.hours(1));
					const staleEvents: Array<RegistryEvent> = [];
					yield* registry.getPackageVfs(zod).pipe(Effect.provide(recording(staleEvents)));
					assert.deepStrictEqual(tags(staleEvents), ["CacheStale", "FetchStart", "PackageLoaded"]);
					const refetched = staleEvents[2];
					if (refetched?._tag === "PackageLoaded") assert.strictEqual(refetched.source, "network");
				}),
			);

			it.effect("autoFetch: false serves a stale entry from disk without refetching", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const pkg = PackageSpec.make({ name: "zod", version: "3.22.4" });
					yield* registry.fetchAndCache(pkg, { ttl: Duration.minutes(1) });
					yield* TestClock.adjust(Duration.minutes(2));
					const events: Array<RegistryEvent> = [];
					const vfs = yield* registry.getPackageVfs(pkg, { autoFetch: false }).pipe(Effect.provide(recording(events)));
					assert.isTrue(vfs.has("node_modules/zod/index.d.ts"));
					assert.deepStrictEqual(tags(events), ["CacheStale", "PackageLoaded"]);
					const served = events[1];
					if (served?._tag === "PackageLoaded") assert.strictEqual(served.source, "cache");
				}),
			);

			it.effect("autoFetch: false on a miss fails typed with PackageNotFoundError", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const error = yield* Effect.flip(
						registry.getPackageVfs(PackageSpec.make({ name: "zod", version: "9.9.9" }), { autoFetch: false }),
					);
					assert.instanceOf(error, PackageNotFoundError);
				}),
			);

			it.effect("hasCached and clearCache round-trip", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const pkg = PackageSpec.make({ name: "zod", version: "3.0.0" });
					assert.isFalse(yield* registry.hasCached(pkg));
					yield* registry.fetchAndCache(pkg);
					assert.isTrue(yield* registry.hasCached(pkg));
					yield* registry.clearCache(pkg);
					assert.isFalse(yield* registry.hasCached(pkg));
				}),
			);

			it.effect("resolveImport and getTypeEntries read the cached manifest", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const cache = yield* TypeCache;
					const pkg = PackageSpec.make({ name: "zod", version: "3.23.8" });
					yield* cache.write(pkg, "package.json", JSON.stringify(zodManifest));
					const resolvedImport = yield* registry.resolveImport(pkg, "zod");
					assert.isTrue(Option.isSome(resolvedImport));
					if (Option.isSome(resolvedImport)) {
						assert.strictEqual(resolvedImport.value.filePath, "index.d.ts");
					}
					assert.isTrue(Option.isNone(yield* registry.resolveImport(pkg, "zod/nowhere")));
					const entries = yield* registry.getTypeEntries(pkg);
					assert.deepStrictEqual(
						entries.map((entry) => entry.filePath),
						["index.d.ts"],
					);
				}),
			);

			it.effect("pruneCache reports evicted packages", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const pkg = PackageSpec.make({ name: "zod", version: "2.0.0" });
					yield* registry.fetchAndCache(pkg, { ttl: Duration.minutes(1) });
					yield* TestClock.adjust(Duration.minutes(5));
					const result = yield* registry.pruneCache;
					assert.strictEqual(result.count, 1);
					assert.deepStrictEqual(result.removed, [{ name: "zod", version: "2.0.0" }]);
					assert.isFalse(yield* registry.hasCached(pkg));
				}),
			);
		});
	});

	describe("batch semantics", () => {
		layer(registryLayer(new Set(["zod", "ts-pattern"])))((it) => {
			it.effect("partial failure merges the successes and emits PackageLoadFailed", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const events: Array<RegistryEvent> = [];
					const vfs = yield* registry
						.getVfs([
							PackageSpec.make({ name: "zod", version: "3.23.8" }),
							PackageSpec.make({ name: "ts-pattern", version: "5.0.6" }),
							PackageSpec.make({ name: "missing", version: "1.0.0" }),
						])
						.pipe(Effect.provide(recording(events)));
					assert.isTrue(vfs.has("node_modules/zod/index.d.ts"));
					assert.isTrue(vfs.has("node_modules/ts-pattern/index.d.ts"));
					const failedEvents = events.filter((event) => event._tag === "PackageLoadFailed");
					assert.lengthOf(failedEvents, 1);
					const failed = failedEvents[0];
					if (failed?._tag === "PackageLoadFailed") {
						assert.strictEqual(failed.package, "missing");
						assert.strictEqual(failed.kind, "not-found");
					}
					const complete = events.at(-1);
					if (complete?._tag === "BatchComplete") {
						assert.strictEqual(complete.loaded, 2);
						assert.strictEqual(complete.failed, 1);
						assert.strictEqual(complete.total, 3);
					} else {
						assert.fail("expected BatchComplete last");
					}
				}),
			);

			it.effect("all-failed raises BatchLoadError with structured failures", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const error = yield* Effect.flip(
						registry.getVfs([
							PackageSpec.make({ name: "missing-a", version: "1.0.0" }),
							PackageSpec.make({ name: "missing-b", version: "2.0.0" }),
						]),
					);
					assert.instanceOf(error, BatchLoadError);
					if (error instanceof BatchLoadError) {
						assert.deepStrictEqual(
							error.failures.map((failure) => `${failure.name}@${failure.version}`),
							["missing-a@1.0.0", "missing-b@2.0.0"],
						);
						assert.isTrue(error.failures.every((failure) => failure.error instanceof PackageNotFoundError));
					}
				}),
			);

			it.effect("an empty batch is an empty Vfs, not an error", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const vfs = yield* registry.getVfs([]);
					assert.strictEqual(vfs.size, 0);
				}),
			);
		});
	});

	describe("resolveVersion", () => {
		layer(registryLayer(new Set(["zod"])))((it) => {
			it.effect("resolves dist-tags, exact versions and ranges locally", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const events: Array<RegistryEvent> = [];
					assert.strictEqual(
						yield* registry.resolveVersion("zod", "latest").pipe(Effect.provide(recording(events))),
						"3.23.8",
					);
					assert.strictEqual(yield* registry.resolveVersion("zod", "3.22.4"), "3.22.4");
					assert.strictEqual(yield* registry.resolveVersion("zod", "^3.22.0"), "3.23.8");
					assert.strictEqual(yield* registry.resolveVersion("zod", "~3.22.1"), "3.22.4");
					const resolvedEvent = events[0];
					if (resolvedEvent?._tag === "VersionResolved") {
						assert.strictEqual(resolvedEvent.requested, "latest");
						assert.strictEqual(resolvedEvent.resolved, "3.23.8");
					} else {
						assert.fail("expected VersionResolved");
					}
				}),
			);

			it.effect("an unmatched range fails typed with bounded available context", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const events: Array<RegistryEvent> = [];
					const error = yield* Effect.flip(
						registry.resolveVersion("zod", "^99.0.0").pipe(Effect.provide(recording(events))),
					);
					assert.instanceOf(error, VersionNotFoundError);
					if (error instanceof VersionNotFoundError) {
						assert.strictEqual(error.ref, "^99.0.0");
						assert.isTrue(error.available.includes("3.23.8"));
						assert.isAtMost(error.available.length, 20);
					}
					const failedEvent = events[0];
					if (failedEvent?._tag === "VersionResolveFailed") {
						assert.strictEqual(failedEvent.kind, "no-match");
					} else {
						assert.fail("expected VersionResolveFailed");
					}
				}),
			);

			it.effect("garbage refs fail as no-match, not prose parsing", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const error = yield* Effect.flip(registry.resolveVersion("zod", "not a version at all"));
					assert.instanceOf(error, VersionNotFoundError);
				}),
			);

			it.effect("an unknown package surfaces the fetch failure with kind not-found in the event", () =>
				Effect.gen(function* () {
					const registry = yield* TypeRegistry;
					const events: Array<RegistryEvent> = [];
					const error = yield* Effect.flip(
						registry.resolveVersion("no-such-pkg", "latest").pipe(Effect.provide(recording(events))),
					);
					assert.instanceOf(error, FetchError);
					const failedEvent = events[0];
					if (failedEvent?._tag === "VersionResolveFailed") {
						assert.strictEqual(failedEvent.kind, "not-found");
					} else {
						assert.fail("expected VersionResolveFailed");
					}
				}),
			);
		});
	});
});
