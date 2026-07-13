import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, PlatformError } from "effect";
import { TsconfigDiscovery } from "../src/TsconfigDiscovery.js";
import { fixtureLayer } from "./fixtures.js";

/** Build a fixture tree from `[absolutePath, contents]` pairs; contents are irrelevant to discovery. */
const tree = (...entries: ReadonlyArray<readonly [string, string]>): ReadonlyMap<string, string> => new Map(entries);

const EMPTY = "{}";

layer(fixtureLayer(tree(["/a/b/tsconfig.json", EMPTY], ["/a/tsconfig.json", EMPTY])))(
	"TsconfigDiscovery.findNearest, nearest wins",
	(it) => {
		it.effect("prefers the nearer ancestor's config", () =>
			Effect.gen(function* () {
				const found = yield* TsconfigDiscovery.findNearest("/a/b/c");
				assert.deepStrictEqual(found, Option.some("/a/b/tsconfig.json"));
			}),
		);
	},
);

layer(fixtureLayer(tree()))("TsconfigDiscovery.findNearest, none anywhere", (it) => {
	it.effect("returns Option.none() when no ancestor has a config", () =>
		Effect.gen(function* () {
			const found = yield* TsconfigDiscovery.findNearest("/a/b/c");
			assert.deepStrictEqual(found, Option.none());
		}),
	);
});

layer(fixtureLayer(tree(["/a/b/tsconfig.build.json", EMPTY], ["/a/b/tsconfig.json", EMPTY])))(
	"TsconfigDiscovery.findNearest, filename option",
	(it) => {
		it.effect("finds only the named filename, ignoring tsconfig.json in the same directory", () =>
			Effect.gen(function* () {
				const found = yield* TsconfigDiscovery.findNearest("/a/b/c", { filename: "tsconfig.build.json" });
				assert.deepStrictEqual(found, Option.some("/a/b/tsconfig.build.json"));
			}),
		);
	},
);

layer(fixtureLayer(tree(["/a/tsconfig.json", EMPTY])))(
	"TsconfigDiscovery.findNearest, stopAt bounds the walk",
	(it) => {
		it.effect("does not ascend past stopAt", () =>
			Effect.gen(function* () {
				const found = yield* TsconfigDiscovery.findNearest("/a/b/c", { stopAt: "/a/b" });
				assert.deepStrictEqual(found, Option.none());
			}),
		);
	},
);

// Pins the INCLUSIVE boundary (Walker.ascend's contract: "stop after this
// directory, inclusive"). The beyond-boundary test above passes under either
// inclusive or exclusive semantics — only a config exactly AT stopAt tells
// them apart. The decoy above stopAt proves the walk stops there: an
// implementation that ascends past the boundary would still satisfy a bare
// isSome, but not equality with the at-boundary path.
layer(fixtureLayer(tree(["/a/b/tsconfig.json", EMPTY], ["/a/tsconfig.json", EMPTY])))(
	"TsconfigDiscovery.findNearest, stopAt boundary is inclusive",
	(it) => {
		it.effect("finds a config exactly at the stopAt directory, never the decoy above it", () =>
			Effect.gen(function* () {
				const found = yield* TsconfigDiscovery.findNearest("/a/b/c", { stopAt: "/a/b" });
				assert.deepStrictEqual(found, Option.some("/a/b/tsconfig.json"));
			}),
		);
	},
);

/** A FileSystem whose `exists` denies permission on one path and consults the fixture tree for the rest. */
const FsDenying = (denied: string, tree: ReadonlyMap<string, string>) =>
	FileSystem.layerNoop({
		exists: (path: string) =>
			path === denied
				? Effect.fail(
						PlatformError.systemError({
							_tag: "PermissionDenied",
							module: "FileSystem",
							method: "exists",
							pathOrDescriptor: path,
						}),
					)
				: Effect.succeed(tree.has(path)),
	});

layer(Layer.mergeAll(FsDenying("/a/b/tsconfig.json", tree(["/a/tsconfig.json", EMPTY])), Path.layer))(
	"TsconfigDiscovery.findNearest, permission denied on a nearer candidate",
	(it) => {
		it.effect("absorbs the denied probe and keeps ascending to the further config", () =>
			Effect.gen(function* () {
				const found = yield* TsconfigDiscovery.findNearest("/a/b/c");
				assert.deepStrictEqual(found, Option.some("/a/tsconfig.json"));
			}),
		);
	},
);
