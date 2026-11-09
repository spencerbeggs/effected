// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/strip-maps.test.ts on 2026-11-06
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { removeDeclarationMaps } from "../../src/passes/strip-maps.js";

const dir = "/ws/pkg";

const strip = (seed: MemoryFileSystemSeed, target: string = dir) => {
	const handle = MemoryFileSystem.makeSync(seed);
	return Effect.map(removeDeclarationMaps(target).pipe(Effect.provide(handle.layer)), (removed) => ({
		removed,
		has: handle.volume.has,
	}));
};

describe("removeDeclarationMaps", () => {
	it.effect("removes .d.ts.map and .d.cts.map (recursively) but keeps .d.ts/.d.cts/.js", () =>
		Effect.gen(function* () {
			const { removed, has } = yield* strip({
				[join(dir, "index.d.ts")]: "export {};",
				[join(dir, "index.d.ts.map")]: "{}",
				[join(dir, "index.d.cts")]: "export {};",
				[join(dir, "index.d.cts.map")]: "{}",
				[join(dir, "index.js")]: "",
				[join(dir, "sub", "a.d.ts.map")]: "{}",
			});
			assert.deepStrictEqual(
				[...removed].sort(),
				[join(dir, "index.d.cts.map"), join(dir, "index.d.ts.map"), join(dir, "sub", "a.d.ts.map")].sort(),
			);
			// maps gone
			assert.isFalse(has(join(dir, "index.d.ts.map")));
			assert.isFalse(has(join(dir, "index.d.cts.map")));
			assert.isFalse(has(join(dir, "sub", "a.d.ts.map")));
			// declarations + js preserved
			assert.isTrue(has(join(dir, "index.d.ts")));
			assert.isTrue(has(join(dir, "index.d.cts")));
			assert.isTrue(has(join(dir, "index.js")));
		}),
	);

	it.effect("skips node_modules and returns [] for a missing directory", () =>
		Effect.gen(function* () {
			const seed = { [join(dir, "node_modules", "dep.d.ts.map")]: "{}" };
			const { removed, has } = yield* strip(seed);
			assert.deepStrictEqual(removed, []);
			assert.isTrue(has(join(dir, "node_modules", "dep.d.ts.map"))); // untouched
			assert.deepStrictEqual((yield* strip(seed, join(dir, "does-not-exist"))).removed, []);
		}),
	);

	it.effect("accepts a directory relative to the process cwd", () =>
		Effect.gen(function* () {
			const map = join(process.cwd(), "pkg", "index.d.ts.map");
			const { removed, has } = yield* strip({ [map]: "{}" }, "pkg");
			assert.deepStrictEqual(removed, [join("pkg", "index.d.ts.map")]);
			assert.isFalse(has(map));
		}),
	);

	it.effect("strips under dot-directories but never enters a symlinked directory", () =>
		Effect.gen(function* () {
			const { removed, has } = yield* strip({
				[join(dir, ".hidden", "a.d.ts.map")]: "{}",
				"/outside/b.d.ts.map": "{}",
				[join(dir, "linked")]: MemoryFileSystem.symlink("/outside"),
			});
			assert.deepStrictEqual(removed, [join(dir, ".hidden", "a.d.ts.map")]);
			assert.isTrue(has("/outside/b.d.ts.map"));
		}),
	);
});
