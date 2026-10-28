// The upward forms that arrived with the marker stop and the sync twins:
// `ascendToMarker`, `findUpwardAll`, and every `*Sync` upward form.
//
// The sync forms run the same machine as the `Effect` forms, and this suite is
// what proves that claim — a parity matrix over ONE memfs volume: the `Effect`
// side reads it through `handle.layer`, the sync side through the handle's
// node-shaped sync port, with the same faults mirrored on both. The behaviours
// themselves (marker stop, ambiguity, probes stopping at the hit) are pinned on
// both sides directly.

import { posix, win32 } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, Effect, Exit, Layer, Option, Path, PlatformError } from "effect";
import type { WalkerSyncFileSystem, WalkerSyncOps } from "../src/DescendSync.js";
import { Walker } from "../src/Walker.js";

const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	// A repository with a `.git` directory, a nested worktree whose `.git` is a FILE.
	"/real/repo/.git/HEAD": "ref",
	"/real/repo/packages/app/src/index.ts": "",
	"/real/repo/packages/app/tool.config.ts": "",
	"/real/repo/packages/app/tool.config.js": "",
	"/real/repo/packages/lib/tool.config.js": "",
	"/real/repo/tool.config.ts": "",
	"/real/repo/wt/.git": "gitdir: /real/repo/.git/worktrees/wt",
	"/real/repo/wt/deep/file.ts": "",
	// A start reached through a symlink: `/link` -> `/real`.
	"/link": MemoryFileSystem.symlink("/real"),
	// A marker present but denied: the probe fails, the marker above must still win.
	"/real/denied/.git": "gitdir: x",
	"/real/denied/inner/x.ts": "",
	// An ancestor whose realPath is denied, for `ascendWithin`'s absorption.
	"/real/locked/a/b/x.ts": "",
};

const DENIED_PROBE = "/real/denied/.git";
const LOCKED = "/link/locked/a";

const fault = (method: "exists" | "realPath", path: string) =>
	Effect.fail(
		PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path }),
	);

/** Every path the `Effect` walk probed for existence, in order — reset before each assertion. */
const effectProbes: Array<string> = [];

const handle = MemoryFileSystem.makeSync(TREE, {
	spies: { exists: (path: string) => void effectProbes.push(path) },
	faults: {
		exists: (path: string) => (path === DENIED_PROBE ? fault("exists", path) : undefined),
		realPath: (path: string) => (path === LOCKED ? fault("realPath", path) : undefined),
	},
});

const syncFs: WalkerSyncFileSystem = handle.withFaults({
	sync: {
		stat: (path: string) => {
			if (path === DENIED_PROBE) throw MemoryFileSystem.errno("EACCES", "stat", path);
			return undefined;
		},
		realPath: (path: string) => {
			if (path === LOCKED) throw MemoryFileSystem.errno("EACCES", "realpath", path);
			return undefined;
		},
	},
}).sync;

/** Every path the sync walk probed for existence, in order — reset before each assertion. */
const syncProbes: Array<string> = [];
const ops: WalkerSyncOps = {
	fileSystem: {
		...syncFs,
		stat: (path: string) => {
			syncProbes.push(path);
			return syncFs.stat(path);
		},
	},
	path: posix,
};

const platform = Layer.mergeAll(handle.layer, Path.layer);

/** Runs an `Effect` upward form, resolving its answer or the defect's message. */
const viaEffect = <A>(effect: Effect.Effect<A, never, never>): { readonly ok: A } | { readonly defect: string } => {
	const exit = Effect.runSyncExit(effect);
	if (Exit.isSuccess(exit)) return { ok: exit.value };
	const squashed = Cause.squash(exit.cause);
	return { defect: squashed instanceof Error ? squashed.message : String(squashed) };
};

/** Runs a sync upward form, resolving its answer or the thrown message. */
const viaSync = <A>(run: () => A): { readonly ok: A } | { readonly defect: string } => {
	try {
		return { ok: run() };
	} catch (error) {
		return { defect: error instanceof Error ? error.message : String(error) };
	}
};

/** A defect message without the `Walker.<form>:` prefix, which names each form itself. */
const normal = <A>(outcome: { readonly ok: A } | { readonly defect: string }) =>
	"defect" in outcome ? { defect: outcome.defect.replace(/^Walker\.\w+: /, "") } : outcome;

/** The chain every candidate scan below runs over. */
const dirs = ["/real/repo/packages/app/src", "/real/repo/packages/app", "/real/repo/packages", "/real/repo", "/real"];

describe("Walker upward sync parity", () => {
	const ascendCases: ReadonlyArray<readonly [string, Parameters<typeof Walker.ascend>[1]]> = [
		["/real/repo/packages/app", undefined],
		["/real/repo/packages/app", { stopAt: "/real/repo" }],
		["/real/repo/packages/app", { stopAt: "/real/repo/" }],
		["/real/repo/packages/app", { stopAt: "/real/x/../repo" }],
		["/real/repo/packages/app", { maxDepth: 2 }],
		["packages/app", undefined],
		["/real/repo/packages/app", { stopAt: "repo" }],
		["/real/repo/packages/app", { maxDepth: 0 }],
		["/real/repo/packages/app", { maxDepth: Number.NaN }],
	];
	for (const [start, options] of ascendCases) {
		it(`ascend ${start} ${JSON.stringify(options)}`, () => {
			const effect = viaEffect(Walker.ascend(start, options).pipe(Effect.provide(Path.layer)));
			const sync = viaSync(() => Walker.ascendSync(start, { ...options, path: posix }));
			assert.deepStrictEqual(normal(sync), normal(effect));
		});
	}

	const withinCases: ReadonlyArray<readonly [string, Option.Option<string>, { maxDepth?: number }]> = [
		["/link/repo/packages/app", Option.some("/real/repo"), {}],
		["/link/repo/packages/app", Option.some("/link/repo/"), {}],
		["/link/repo/packages/app", Option.some("/elsewhere"), {}],
		["/link/repo/packages/app", Option.some("/missing/ceiling"), {}],
		["/link/repo/packages/app", Option.some("/real/repo"), { maxDepth: 2 }],
		["/link/repo/packages/app", Option.none(), {}],
		["/link/locked/a/b", Option.some("/real/locked"), {}],
		["/link/repo/packages/app", Option.some("real/repo"), {}],
	];
	for (const [start, ceiling, options] of withinCases) {
		it(`ascendWithin ${start} ${String(Option.getOrUndefined(ceiling))} ${JSON.stringify(options)}`, () => {
			const effect = viaEffect(Walker.ascendWithin(start, ceiling, options).pipe(Effect.provide(platform)));
			const sync = viaSync(() => Walker.ascendWithinSync(start, ceiling, { ...options, ...ops }));
			assert.deepStrictEqual(normal(sync), normal(effect));
		});
	}

	const markerCases: ReadonlyArray<readonly [string, ReadonlyArray<string>, { maxDepth?: number }]> = [
		["/real/repo/packages/app/src", [".git"], {}],
		["/real/repo/wt/deep", [".git"], {}],
		["/real/repo", [".git"], {}],
		["/real/repo/packages/app/src", ["pnpm-workspace.yaml"], {}],
		["/real/repo/packages/app/src", ["tool.config.js", ".git"], {}],
		["/real/repo/packages/app/src", [".git"], { maxDepth: 2 }],
		["/real/denied/inner", [".git"], {}],
		["/link/repo/packages/app", [".git"], {}],
		["/real/repo/packages/app", [], {}],
		["/real/repo/packages/app", [".git", ""], {}],
		["/real/repo/packages/app", [".git"], { maxDepth: 2.5 }],
	];
	for (const [start, markers, options] of markerCases) {
		it(`ascendToMarker ${start} ${JSON.stringify(markers)} ${JSON.stringify(options)}`, () => {
			const effect = viaEffect(Walker.ascendToMarker(start, markers, options).pipe(Effect.provide(platform)));
			const sync = viaSync(() => Walker.ascendToMarkerSync(start, markers, { ...options, ...ops }));
			assert.deepStrictEqual(normal(sync), normal(effect));
		});
	}

	const candidateSets: ReadonlyArray<readonly [string, (dir: string) => ReadonlyArray<string>]> = [
		["ts then js", (dir) => [`${dir}/tool.config.ts`, `${dir}/tool.config.js`]],
		["js then ts", (dir) => [`${dir}/tool.config.js`, `${dir}/tool.config.ts`]],
		["js only", (dir) => [`${dir}/tool.config.js`]],
		["none", (dir) => [`${dir}/absent.json`]],
		["denied marker", (dir) => [`${dir}/denied/.git`]],
	];
	for (const [name, candidatesFor] of candidateSets) {
		it(`findUpward / findUpwardAll, ${name}`, () => {
			const first = viaEffect(Walker.findUpward(dirs, candidatesFor).pipe(Effect.provide(platform)));
			const all = viaEffect(Walker.findUpwardAll(dirs, candidatesFor).pipe(Effect.provide(platform)));
			assert.deepStrictEqual(
				viaSync(() => Walker.findUpwardSync(dirs, candidatesFor, ops)),
				first,
			);
			assert.deepStrictEqual(
				viaSync(() => Walker.findUpwardAllSync(dirs, candidatesFor, ops)),
				all,
			);
		});
	}
});

describe("Walker.ascendToMarker", () => {
	it.effect("stops at the nearest directory holding the marker, inclusive", () =>
		Effect.gen(function* () {
			const chain = yield* Walker.ascendToMarker("/real/repo/packages/app/src", [".git"]);
			assert.deepStrictEqual(chain, [
				"/real/repo/packages/app/src",
				"/real/repo/packages/app",
				"/real/repo/packages",
				"/real/repo",
			]);
		}).pipe(Effect.provide(platform)),
	);

	// A worktree's or a submodule's `.git` is a FILE: a marker is an entry, any kind.
	it.effect("counts a marker that is a file", () =>
		Effect.gen(function* () {
			const chain = yield* Walker.ascendToMarker("/real/repo/wt/deep", [".git"]);
			assert.deepStrictEqual(chain, ["/real/repo/wt/deep", "/real/repo/wt"]);
		}).pipe(Effect.provide(platform)),
	);

	// The consumer's complaint: findRoot over a full ascend stats the marker to the
	// filesystem root before choosing. The hit here is the start directory itself,
	// so exactly one probe may happen.
	it.effect("probes nothing above the directory that holds the marker", () =>
		Effect.gen(function* () {
			effectProbes.length = 0;
			const chain = yield* Walker.ascendToMarker("/real/repo", [".git"]);
			assert.deepStrictEqual(chain, ["/real/repo"]);
			assert.deepStrictEqual(effectProbes, ["/real/repo/.git"]);
			syncProbes.length = 0;
			assert.deepStrictEqual(Walker.ascendToMarkerSync("/real/repo", [".git"], ops), ["/real/repo"]);
			assert.deepStrictEqual(syncProbes, ["/real/repo/.git"]);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("runs to the filesystem root, as ascend does, when no directory holds a marker", () =>
		Effect.gen(function* () {
			const chain = yield* Walker.ascendToMarker("/real/repo/packages", ["pnpm-workspace.yaml"]);
			assert.deepStrictEqual(chain, yield* Walker.ascend("/real/repo/packages"));
		}).pipe(Effect.provide(platform)),
	);

	// The denied marker is genuinely present, so only the fault stands between the
	// walk and `/real/denied`: absorbed, the walk keeps ascending to `/`.
	it.effect("absorbs a denied probe as no marker", () =>
		Effect.gen(function* () {
			const chain = yield* Walker.ascendToMarker("/real/denied/inner", [".git"]);
			assert.deepStrictEqual(chain, ["/real/denied/inner", "/real/denied", "/real", "/"]);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("dies on an empty marker list rather than walking unbounded", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Walker.ascendToMarker("/real/repo", []));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause));
		}).pipe(Effect.provide(platform)),
	);

	it.effect("dies on an empty marker name rather than matching every directory", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Walker.ascendToMarker("/real/repo/packages", [""]));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
			assert.throws(() => Walker.ascendToMarkerSync("/real/repo/packages", [""], ops), /non-empty entry name/);
		}).pipe(Effect.provide(platform)),
	);
});

describe("Walker.findUpwardAll", () => {
	it.effect("returns every hit of the nearest directory, in candidate order", () =>
		Effect.gen(function* () {
			const hits = yield* Walker.findUpwardAll(dirs.slice(1), (dir) => [
				`${dir}/tool.config.ts`,
				`${dir}/tool.config.mjs`,
				`${dir}/tool.config.js`,
			]);
			assert.deepStrictEqual(
				hits,
				Option.some({
					dir: "/real/repo/packages/app",
					found: ["/real/repo/packages/app/tool.config.ts", "/real/repo/packages/app/tool.config.js"],
				}),
			);
		}).pipe(Effect.provide(platform)),
	);

	// Every candidate of the hit directory is probed — a second hit is the point —
	// and nothing above it is.
	it.effect("probes the whole hit directory and nothing above it", () =>
		Effect.gen(function* () {
			effectProbes.length = 0;
			const candidatesFor = (dir: string) => [`${dir}/tool.config.ts`, `${dir}/tool.config.js`];
			yield* Walker.findUpwardAll(["/real/repo/packages/app", "/real/repo"], candidatesFor);
			assert.deepStrictEqual(effectProbes, [
				"/real/repo/packages/app/tool.config.ts",
				"/real/repo/packages/app/tool.config.js",
			]);
			syncProbes.length = 0;
			Walker.findUpwardAllSync(["/real/repo/packages/app", "/real/repo"], candidatesFor, ops);
			assert.deepStrictEqual(syncProbes, effectProbes);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("skips directories with no hit and returns none when no directory has one", () =>
		Effect.gen(function* () {
			const near = yield* Walker.findUpwardAll(["/real/repo/packages", "/real/repo"], (dir) => [
				`${dir}/tool.config.ts`,
			]);
			assert.deepStrictEqual(near, Option.some({ dir: "/real/repo", found: ["/real/repo/tool.config.ts"] }));
			const none = yield* Walker.findUpwardAll(dirs, (dir) => [`${dir}/absent.json`]);
			assert.deepStrictEqual(none, Option.none());
		}).pipe(Effect.provide(platform)),
	);
});

// A win32 ceiling rooted on the current drive (`\\repo`) is absolute to
// `win32.isAbsolute` but names a different directory per process drive: the
// relative-ceiling class, so it dies like one.
describe("a win32 ceiling rooted on the current drive", () => {
	const dies = (f: () => unknown, message = /must be an absolute path/): boolean => {
		try {
			f();
			return false;
		} catch (error) {
			return error instanceof Error && message.test(error.message);
		}
	};
	it("dies as stopAt and as ascendWithin's ceiling; a drive or UNC ceiling does not", () => {
		const start = "C:\\repo\\a";
		for (const ceiling of ["\\repo", "/repo"]) {
			assert.isTrue(
				dies(() => Walker.ascendSync(start, { stopAt: ceiling, path: win32 })),
				`stopAt ${ceiling}`,
			);
			assert.isTrue(
				dies(
					() => Walker.ascendWithinSync(start, Option.some(ceiling), { fileSystem: syncFs, path: win32 }),
					/ceiling must be an absolute path/,
				),
				`ceiling ${ceiling}`,
			);
		}
		assert.deepStrictEqual(Walker.ascendSync(start, { stopAt: "C:\\repo", path: win32 }), ["C:\\repo\\a", "C:\\repo"]);
		assert.isFalse(dies(() => Walker.ascendSync("\\\\srv\\share\\a", { stopAt: "\\\\srv\\share", path: win32 })));
	});
});
