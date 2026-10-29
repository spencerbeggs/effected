// `relativeWithin` over one memfs volume, through both forms, asserting the same answer.

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Option, Path } from "effect";
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

const both = (base: string, absolute: string, expected: string | undefined, options?: RelativeWithinOptions) => {
	const want = expected === undefined ? Option.none() : Option.some(expected);
	assert.deepStrictEqual(Effect.runSync(relativeWithin(base, absolute, options).pipe(Effect.provide(platform))), want);
	assert.deepStrictEqual(relativeWithinSync(base, absolute, ops, options), want);
};

describe("relativeWithin / relativeWithinSync", () => {
	it("answers a base-relative posix path for an existing path", () => {
		both("/srv/site", "/srv/site/og/card.png", "og/card.png");
	});

	it("answers the empty string for the base itself", () => {
		both("/srv/site", "/srv/site", "");
	});

	it("resolves a missing tail from its deepest existing ancestor", () => {
		both("/srv/site", "/srv/site/og/new/deep/file.md", "og/new/deep/file.md");
	});

	it("is none outside the base, including a missing path outside", () => {
		both("/srv/site", "/etc/sub/y", undefined);
		both("/srv/site", "/srv/site-evil/x", undefined);
		both("/srv/site", "/srv/other/new.md", undefined);
	});

	it("is none when a link carries the path out, even for a missing tail", () => {
		both("/srv/site", "/srv/site/out/y", undefined);
		both("/srv/site", "/srv/site/out/new.md", undefined);
		both("/srv/site", "/srv/site/out/../x", undefined);
	});

	it("is none for unverifiable resolutions and non-absolute candidates", () => {
		both("/srv/site", "/srv/site/dangling", undefined);
		both("/srv/site", "/srv/site/loop/x", undefined);
		both("/srv/site", "og/card.png", undefined);
		both("/srv/site", "", undefined);
		both("/srv/site", "/srv/site/a\0b", undefined);
	});

	it('with missing: "refuse" answers only for paths that exist', () => {
		const refuse = { missing: "refuse" } as const;
		both("/srv/site", "/srv/site/og/card.png", "og/card.png", refuse);
		both("/srv/site", "/srv/site", "", refuse);
		both("/srv/site", "/srv/site/og/new/file.md", undefined, refuse);
		both("/srv/site", "/srv/site/og/new.md", undefined, refuse);
		both("/srv/site", "/srv/site/og/new/file.md", "og/new/file.md", { missing: "ancestor" });
	});

	it("treats a relative base as a defect", () => {
		assert.throws(() => Effect.runSync(relativeWithin("srv", "/srv/x").pipe(Effect.provide(platform))));
		assert.throws(() => relativeWithinSync("srv", "/srv/x", ops));
	});
});
