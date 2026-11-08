// `relativeWithin` over one memfs volume, through both forms, asserting the same answer.

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Exit, Layer, Option, Path } from "effect";
import type { RelativeWithinOptions } from "../src/ConfineReal.js";
import { relativeWithin, relativeWithinSync } from "../src/ConfineReal.js";
import type { WalkerSyncOps } from "../src/DescendSync.js";

const handle = MemoryFileSystem.makeSync({
	"/srv/site/index.html": "",
	"/srv/site/og/card.png": "",
	"/etc/sub/y": "",
	"/srv/site/out": MemoryFileSystem.symlink("/etc/sub"),
	"/srv/site/dangling": MemoryFileSystem.symlink("/etc/pwned.txt"),
	"/srv/site/loop": MemoryFileSystem.symlink("/srv/site/loop"),
});
const ops: WalkerSyncOps = { fileSystem: handle.sync, path: posix };
const platform = Layer.mergeAll(handle.layer, Path.layer);

const both = (base: string, absolute: string, expected: string | undefined, options?: RelativeWithinOptions) =>
	Effect.gen(function* () {
		const want = expected === undefined ? Option.none() : Option.some(expected);
		assert.deepStrictEqual(yield* relativeWithin(base, absolute, options).pipe(Effect.provide(platform)), want);
		assert.deepStrictEqual(relativeWithinSync(base, absolute, ops, options), want);
	});

describe("relativeWithin / relativeWithinSync", () => {
	it.effect("answers a base-relative posix path for an existing path", () =>
		Effect.gen(function* () {
			yield* both("/srv/site", "/srv/site/og/card.png", "og/card.png");
		}),
	);

	it.effect("answers the empty string for the base itself", () =>
		Effect.gen(function* () {
			yield* both("/srv/site", "/srv/site", "");
		}),
	);

	it.effect("resolves a missing tail from its deepest existing ancestor", () =>
		Effect.gen(function* () {
			yield* both("/srv/site", "/srv/site/og/new/deep/file.md", "og/new/deep/file.md");
		}),
	);

	it.effect("is none outside the base, including a missing path outside", () =>
		Effect.gen(function* () {
			yield* both("/srv/site", "/etc/sub/y", undefined);
			yield* both("/srv/site", "/srv/site-evil/x", undefined);
			yield* both("/srv/site", "/srv/other/new.md", undefined);
		}),
	);

	it.effect("is none when a link carries the path out, even for a missing tail", () =>
		Effect.gen(function* () {
			yield* both("/srv/site", "/srv/site/out/y", undefined);
			yield* both("/srv/site", "/srv/site/out/new.md", undefined);
			yield* both("/srv/site", "/srv/site/out/../x", undefined);
		}),
	);

	it.effect("is none for unverifiable resolutions and non-absolute candidates", () =>
		Effect.gen(function* () {
			yield* both("/srv/site", "/srv/site/dangling", undefined);
			yield* both("/srv/site", "/srv/site/loop/x", undefined);
			yield* both("/srv/site", "og/card.png", undefined);
			yield* both("/srv/site", "", undefined);
			yield* both("/srv/site", "/srv/site/a\0b", undefined);
		}),
	);

	it.effect('with missing: "refuse" answers only for paths that exist', () =>
		Effect.gen(function* () {
			const refuse = { missing: "refuse" } as const;
			yield* both("/srv/site", "/srv/site/og/card.png", "og/card.png", refuse);
			yield* both("/srv/site", "/srv/site", "", refuse);
			yield* both("/srv/site", "/srv/site/og/new/file.md", undefined, refuse);
			yield* both("/srv/site", "/srv/site/og/new.md", undefined, refuse);
			yield* both("/srv/site", "/srv/site/og/new/file.md", "og/new/file.md", { missing: "ancestor" });
		}),
	);

	it.effect("treats a relative base as a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(relativeWithin("srv", "/srv/x").pipe(Effect.provide(platform)));
			assert.isTrue(Exit.isFailure(exit) && exit.cause.reasons.some((reason) => reason._tag === "Die"));
			assert.throws(() => relativeWithinSync("srv", "/srv/x", ops));
		}),
	);
});
