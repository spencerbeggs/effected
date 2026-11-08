// `Walker.findUpwardWith` — the validating upward search with an effectful
// accept. The same cases as `Walker.findUpwardSyncWith` (see
// FindUpwardSyncWith.test.ts), over one memfs volume read through core's
// `FileSystem`, with chains from the Effect `ascend` forms.

import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Exit, FileSystem, Option } from "effect";
import { Walker } from "../src/Walker.js";

const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	"/repo/package.json": JSON.stringify({ name: "root" }),
	"/repo/.git/HEAD": "ref",
	// A malformed manifest between the start and the valid one: it must be climbed past.
	"/repo/packages/app/package.json": "{ not json",
	"/repo/packages/app/src/index.ts": "",
	"/repo/packages/app/src/deep/x.ts": "",
	"/repo/packages/lib/package.json": JSON.stringify({ name: "lib" }),
	"/repo/packages/lib/src/y.ts": "",
	// A directory named like the manifest: the read fails, and that too is "not valid".
	"/repo/packages/odd/package.json/keep": "",
	"/repo/packages/odd/src/z.ts": "",
	"/elsewhere/package.json": JSON.stringify({ name: "elsewhere" }),
	"/elsewhere/inner/w.ts": "",
};

const handle = MemoryFileSystem.makeSync(TREE);

/** An accept that reads and parses the candidate manifest, counting every directory it is asked about. */
const counting = () => {
	const asked: Array<string> = [];
	const accept = (dir: string) =>
		Effect.gen(function* () {
			asked.push(dir);
			const fs = yield* FileSystem.FileSystem;
			const manifest: unknown = JSON.parse(yield* fs.readFileString(`${dir}/package.json`));
			const name = typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "name") : undefined;
			return typeof name === "string" ? Option.some(name) : Option.none<string>();
		}).pipe(Effect.catchCause(() => Effect.succeed(Option.none<string>())));
	return { asked, accept };
};

describe("Walker.findUpwardWith", () => {
	it.effect("answers the nearest VALID manifest, climbing past a malformed one", () =>
		Effect.gen(function* () {
			const { asked, accept } = counting();
			const dirs = yield* Walker.ascend("/repo/packages/app/src/deep");
			const found = yield* Walker.findUpwardWith(dirs, accept);
			assert.deepStrictEqual(found, Option.some({ dir: "/repo", value: "root" }));
			assert.deepStrictEqual(asked, [
				"/repo/packages/app/src/deep",
				"/repo/packages/app/src",
				"/repo/packages/app",
				"/repo/packages",
				"/repo",
			]);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("an unreadable candidate (a directory named like the file) is rejected, not fatal", () =>
		Effect.gen(function* () {
			const { accept } = counting();
			const dirs = yield* Walker.ascend("/repo/packages/odd/src");
			assert.deepStrictEqual(yield* Walker.findUpwardWith(dirs, accept), Option.some({ dir: "/repo", value: "root" }));
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("stops at the first acceptance: the nearer valid manifest wins", () =>
		Effect.gen(function* () {
			const { asked, accept } = counting();
			const dirs = yield* Walker.ascend("/repo/packages/lib/src");
			assert.deepStrictEqual(
				yield* Walker.findUpwardWith(dirs, accept),
				Option.some({ dir: "/repo/packages/lib", value: "lib" }),
			);
			assert.deepStrictEqual(asked, ["/repo/packages/lib/src", "/repo/packages/lib"]);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("respects a ceiling: nothing above the chain is asked, and a hit above it is not found", () =>
		Effect.gen(function* () {
			const { asked, accept } = counting();
			const dirs = yield* Walker.ascend("/repo/packages/app/src", { stopAt: "/repo/packages" });
			const found = yield* Walker.findUpwardWith(dirs, accept);
			assert.isTrue(Option.isNone(found));
			assert.deepStrictEqual(asked, ["/repo/packages/app/src", "/repo/packages/app", "/repo/packages"]);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("respects a marker stop from ascendToMarker", () =>
		Effect.gen(function* () {
			const { asked, accept } = counting();
			// The nearest `package.json` ENTRY is the directory under `odd`: the chain stops there, so the
			// valid root manifest above it is never reached.
			const dirs = yield* Walker.ascendToMarker("/repo/packages/odd/src", ["package.json"]);
			assert.isTrue(Option.isNone(yield* Walker.findUpwardWith(dirs, accept)));
			assert.deepStrictEqual(asked, ["/repo/packages/odd/src", "/repo/packages/odd"]);
			// Control: without the marker stop the same search does find the root manifest.
			const all = yield* Walker.ascend("/repo/packages/odd/src");
			assert.isTrue(Option.isSome(yield* Walker.findUpwardWith(all, accept)));
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("an empty chain is none, and accept is never called", () =>
		Effect.gen(function* () {
			const { asked, accept } = counting();
			assert.isTrue(Option.isNone(yield* Walker.findUpwardWith([], accept)));
			assert.deepStrictEqual(asked, []);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("a cache memoizes every directory's answer, rejections included", () =>
		Effect.gen(function* () {
			const { asked, accept } = counting();
			const cache = new Map<string, Option.Option<string>>();
			const deep = yield* Walker.ascend("/repo/packages/app/src/deep");
			const first = yield* Walker.findUpwardWith(deep, accept, { cache });
			assert.strictEqual(asked.length, 5);
			assert.strictEqual(cache.size, 5);
			assert.isTrue(Option.isNone(cache.get("/repo/packages/app") ?? Option.some("missing")));

			// The same search again asks nothing.
			const second = yield* Walker.findUpwardWith(deep, accept, { cache });
			assert.deepStrictEqual(second, first);
			assert.strictEqual(asked.length, 5);

			// A sibling start shares every ancestor above it: nothing is new.
			const src = yield* Walker.ascend("/repo/packages/app/src");
			const sibling = yield* Walker.findUpwardWith(src, accept, { cache });
			assert.deepStrictEqual(sibling, Option.some({ dir: "/repo", value: "root" }));
			assert.strictEqual(asked.length, 5);
			const odd = yield* Walker.ascend("/repo/packages/odd/src");
			yield* Walker.findUpwardWith(odd, accept, { cache });
			assert.deepStrictEqual(asked.slice(5), ["/repo/packages/odd/src", "/repo/packages/odd"]);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("without a cache every search asks again", () =>
		Effect.gen(function* () {
			const { asked, accept } = counting();
			const dirs = yield* Walker.ascend("/repo/packages/lib/src");
			yield* Walker.findUpwardWith(dirs, accept);
			yield* Walker.findUpwardWith(dirs, accept);
			assert.strictEqual(asked.length, 4);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("a cached answer stands until the caller invalidates it", () =>
		Effect.gen(function* () {
			const { accept } = counting();
			const cache = new Map<string, Option.Option<string>>([["/repo/packages/lib", Option.some("stale")]]);
			const dirs = yield* Walker.ascend("/repo/packages/lib");
			assert.deepStrictEqual(
				yield* Walker.findUpwardWith(dirs, accept, { cache }),
				Option.some({ dir: "/repo/packages/lib", value: "stale" }),
			);
			cache.delete("/repo/packages/lib");
			assert.deepStrictEqual(
				yield* Walker.findUpwardWith(dirs, accept, { cache }),
				Option.some({ dir: "/repo/packages/lib", value: "lib" }),
			);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("a failing accept fails the search, and nothing is cached for that directory", () =>
		Effect.gen(function* () {
			const cache = new Map<string, Option.Option<string>>();
			const boom = (dir: string) =>
				dir === "/repo/packages" ? Effect.fail("accept bug" as const) : Effect.succeed(Option.none<string>());
			const dirs = yield* Walker.ascend("/repo/packages/app");
			const error = yield* Effect.flip(Walker.findUpwardWith(dirs, boom, { cache }));
			assert.strictEqual(error, "accept bug");
			assert.deepStrictEqual([...cache.keys()], ["/repo/packages/app"]);
		}).pipe(Effect.provide(handle.layer)),
	);

	it.effect("an interrupted accept caches nothing for that directory, and earlier entries stay", () =>
		Effect.gen(function* () {
			const cache = new Map<string, Option.Option<string>>();
			const interrupting = (dir: string) =>
				dir === "/repo/packages" ? Effect.interrupt : Effect.succeed(Option.none<string>());
			const dirs = yield* Walker.ascend("/repo/packages/app");
			const exit = yield* Effect.exit(Walker.findUpwardWith(dirs, interrupting, { cache }));
			assert.isTrue(Exit.isFailure(exit) && Exit.hasInterrupts(exit));
			assert.deepStrictEqual([...cache.keys()], ["/repo/packages/app"]);
		}).pipe(Effect.provide(handle.layer)),
	);
});
