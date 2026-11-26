// `links` under `onUnreadable: "record"` (#1432): the symbolic links the walk
// passes over — a link to a directory it does not enter, and a link that does
// not resolve at all — reported with their own target text, through both
// drivers over ONE memfs volume.

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Result } from "effect";
import type { DescendOptions, DescendRecordOptions } from "../src/Descend.js";
import { descend, descendEntries } from "../src/Descend.js";
import type { WalkerSyncFileSystem } from "../src/DescendSync.js";
import { descendEntriesSync, descendSync } from "../src/DescendSync.js";

const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	"/proj/src/a.ts": "",
	"/proj/real/dir/b.ts": "",
	"/proj/real/file.ts": "",
	// Reported: a link to a directory the walk does not enter, and two dangling links.
	"/proj/src/dirlink": MemoryFileSystem.symlink("/proj/real/dir"),
	"/proj/src/gone.ts": MemoryFileSystem.symlink("/proj/missing.ts"),
	"/proj/src/gonedir": MemoryFileSystem.symlink("../missing/dir"),
	// Never reported: a link to a file resolves, so the walk passes over nothing.
	"/proj/src/file.ts": MemoryFileSystem.symlink("/proj/real/file.ts"),
	// Never reported: pruned by name, hidden under dot: false — not entered for a reason other than being a link.
	"/proj/src/node_modules": MemoryFileSystem.symlink("/proj/real/dir"),
	"/proj/src/.hidden": MemoryFileSystem.symlink("/proj/real/dir"),
	// Never reported: inside a pruned directory, inside a boundary.
	"/proj/node_modules/dep/gone": MemoryFileSystem.symlink("/proj/nowhere"),
	"/proj/pkg/package.json": "{}",
	"/proj/pkg/gone": MemoryFileSystem.symlink("/proj/nowhere"),
	// Never reported under a two-segment bound: a directory the pattern never reads.
	"/proj/deep/a/gone": MemoryFileSystem.symlink("/proj/nowhere"),
	// A cycle under followSymlinks: resolves to a directory the walk refuses to enter.
	"/proj/real/dir/loop": MemoryFileSystem.symlink("/proj/real/dir"),
};

const handle = MemoryFileSystem.makeSync(TREE);

// memfs's own sync port, unadapted: it carries `readLink`, so it reports links as the node binding does.
const ops = { fileSystem: handle.sync satisfies WalkerSyncFileSystem, path: posix };

const compile = (source: string, dot = false): GlobPattern =>
	Result.getOrThrow(GlobPattern.compileResult(source, GlobPatternOptions.make({ dot })));

type Options = Omit<DescendRecordOptions, "cwd" | "onUnreadable">;

/** Both drivers' `links` for one pattern, asserted equal; the Effect answer is returned. */
const links = (source: string, options: Options = {}, dot = false) =>
	Effect.gen(function* () {
		const pattern = compile(source, dot);
		const all = { cwd: "/proj", onUnreadable: "record", ...options } as const;
		const viaEffect = yield* descend(pattern, all).pipe(Effect.provide(handle.layer));
		const viaSync = Result.getOrThrow(descendSync(pattern, { ...all, ...ops }));
		assert.deepStrictEqual(viaSync.links, viaEffect.links, `${source} sync parity`);
		const entries = yield* descendEntries(pattern, all).pipe(Effect.provide(handle.layer));
		const entriesSync = Result.getOrThrow(descendEntriesSync(pattern, { ...all, ...ops }));
		assert.deepStrictEqual(entries.links, viaEffect.links, `${source} descendEntries`);
		assert.deepStrictEqual(entriesSync.links, viaEffect.links, `${source} descendEntriesSync`);
		return viaEffect.links;
	});

const DIRLINK = { path: "src/dirlink", target: "/proj/real/dir", kind: "directory" } as const;
const GONE = { path: "src/gone.ts", target: "/proj/missing.ts", kind: "dangling" } as const;
const GONEDIR = { path: "src/gonedir", target: "../missing/dir", kind: "dangling" } as const;

describe("descend record mode: links", () => {
	it.effect("reports an unentered directory link and both dangling links, with their own target text", () =>
		Effect.gen(function* () {
			const found = yield* links("src/**");
			assert.deepStrictEqual(
				[...found].sort((a, b) => (a.path < b.path ? -1 : 1)),
				[DIRLINK, GONE, GONEDIR],
			);
		}),
	);

	it.effect("spells each link through the root's spelling, as matches are spelled", () =>
		Effect.gen(function* () {
			const found = yield* links("./src/**");
			assert.deepStrictEqual(found.map((link) => link.path).sort(), [
				"./src/dirlink",
				"./src/gone.ts",
				"./src/gonedir",
			]);
		}),
	);

	it.effect("a pattern that never descends reports a dangling link it lists but no directory link", () =>
		Effect.gen(function* () {
			const found = yield* links("src/*.ts");
			assert.deepStrictEqual(
				[...found].sort((a, b) => (a.path < b.path ? -1 : 1)),
				[GONE, GONEDIR],
			);
		}),
	);

	it.effect("a directory link the walk enters under followSymlinks is not reported; a cycle is", () =>
		Effect.gen(function* () {
			const found = yield* links("src/**", { followSymlinks: true });
			assert.deepStrictEqual(
				[...found].sort((a, b) => (a.path < b.path ? -1 : 1)),
				[{ path: "src/dirlink/loop", target: "/proj/real/dir", kind: "directory" }, GONE, GONEDIR],
			);
		}),
	);

	it.effect("a pruned directory, a boundary and a directory the pattern bound never reads report nothing", () =>
		Effect.gen(function* () {
			const everything = yield* links("**", { boundaries: ["package.json"] });
			const paths = everything.map((link) => link.path).sort();
			assert.deepStrictEqual(paths, ["deep/a/gone", "real/dir/loop", "src/dirlink", "src/gone.ts", "src/gonedir"]);
			// Without the boundary, the link inside pkg is a dangling link the walk lists.
			assert.include(
				(yield* links("**")).map((link) => link.path),
				"pkg/gone",
			);
			// A custom prune that keeps node_modules opens it, so its dangling link is listed.
			assert.include(
				(yield* links("**", { prune: [] })).map((link) => link.path),
				"node_modules/dep/gone",
			);
			// `*/*` reads cwd and its children only: deep/a is never read.
			assert.notInclude(
				(yield* links("*/*")).map((link) => link.path),
				"deep/a/gone",
			);
		}),
	);

	it.effect("a hidden directory link the pattern cannot match inside is not reported; under dot: true it is", () =>
		Effect.gen(function* () {
			assert.notInclude(
				(yield* links("src/**")).map((link) => link.path),
				"src/.hidden",
			);
			assert.include(
				(yield* links("src/**", {}, true)).map((link) => link.path),
				"src/.hidden",
			);
		}),
	);

	it.effect("a link pruned by name is not reported: prune, not link-ness, keeps it out", () =>
		Effect.gen(function* () {
			assert.notInclude(
				(yield* links("src/**")).map((link) => link.path),
				"src/node_modules",
			);
			assert.include(
				(yield* links("src/**", { prune: [] })).map((link) => link.path),
				"src/node_modules",
			);
		}),
	);

	it.effect("a literal pattern reads no directory, so it reports no link", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* links("src/a.ts"), []);
		}),
	);

	it.effect("the non-record forms keep their bare-array shape", () =>
		Effect.gen(function* () {
			const pattern = compile("src/**");
			const options: DescendOptions = { cwd: "/proj" };
			const bare = yield* descend(pattern, options).pipe(Effect.provide(handle.layer));
			assert.isTrue(Array.isArray(bare));
			assert.deepStrictEqual(bare, ["src/a.ts", "src/file.ts"]);
			const bareSync = Result.getOrThrow(descendSync(pattern, { ...options, ...ops }));
			assert.deepStrictEqual(bareSync, bare);
			const record = yield* descend(pattern, { cwd: "/proj", onUnreadable: "record" }).pipe(
				Effect.provide(handle.layer),
			);
			assert.deepStrictEqual(Object.keys(record).sort(), ["links", "matches", "unreadable"]);
			assert.deepStrictEqual(record.matches, bare);
		}),
	);

	it("a sync port without readLink reports no link — dangling ones included — and matches unchanged", () => {
		const { readLink: _omitted, ...withoutReadLink } = handle.sync;
		const pattern = compile("src/**");
		const withPort = (fileSystem: WalkerSyncFileSystem) =>
			Result.getOrThrow(descendSync(pattern, { cwd: "/proj", onUnreadable: "record", fileSystem, path: posix }));
		const full = withPort(handle.sync);
		assert.include(
			full.links.map((link) => link.kind),
			"dangling",
		);
		const without = withPort(withoutReadLink);
		assert.deepStrictEqual(without.links, []);
		assert.deepStrictEqual(without.matches, full.matches);
		assert.deepStrictEqual(without.unreadable, full.unreadable);
	});
});
