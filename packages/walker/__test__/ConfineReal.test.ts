// Physical containment. Every case runs through BOTH forms over one memfs
// volume — `confineReal` through `handle.layer`, `confineRealSync` through the
// handle's node-shaped sync port, faults mirrored — and asserts the same
// answer, so the parity claim and the behaviour are pinned together.

import { posix, win32 } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, Effect, Exit, Layer, Path, PlatformError, Result } from "effect";
import { PathEscapeError } from "../src/Confine.js";
import { confineReal, confineRealSync } from "../src/ConfineReal.js";
import type { WalkerSyncFileSystem, WalkerSyncOps } from "../src/DescendSync.js";

const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	"/srv/site/index.html": "",
	"/srv/site/og/card.png": "",
	"/srv/site/file.txt": "",
	"/srv/site-evil/x": "",
	"/etc/passwd": "",
	"/etc/sub/y": "",
	// A link inside the base pointing out of it, one pointing within it, and a loop.
	"/srv/site/out": MemoryFileSystem.symlink("/etc/sub"),
	"/srv/site/alias": MemoryFileSystem.symlink("/srv/site/og"),
	"/srv/site/loop": MemoryFileSystem.symlink("/srv/site/loop"),
	// A base reached through a link.
	"/link": MemoryFileSystem.symlink("/srv"),
	"/srv/site/locked/secret": "",
	// Dangling links: a write through one creates its target, wherever that is.
	"/srv/site/dangling": MemoryFileSystem.symlink("/etc/pwned.txt"),
	"/srv/site/dangdir": MemoryFileSystem.symlink("/etc/newdir"),
	"/srv/site/inner-dangling": MemoryFileSystem.symlink("/srv/site/later"),
	"/srv/site/chain": MemoryFileSystem.symlink("/srv/site/dangling"),
	"/dangling-base": MemoryFileSystem.symlink("/nowhere"),
};

const LOCKED = "/srv/site/locked/secret";
/** Absent, but its presence probe is denied: absence that cannot be proved. */
const GHOST = "/srv/site/ghost";
/** A NUL character, spelled so no editor or tool can collapse it. */
const NUL = String.fromCodePoint(0);

const handle = MemoryFileSystem.makeSync(TREE, {
	faults: {
		realPath: (path: string) =>
			path === LOCKED
				? Effect.fail(
						PlatformError.systemError({
							_tag: "PermissionDenied",
							module: "FileSystem",
							method: "realPath",
							pathOrDescriptor: path,
						}),
					)
				: undefined,
		lstat: (path: string) =>
			path === GHOST
				? Effect.fail(
						PlatformError.systemError({
							_tag: "PermissionDenied",
							module: "FileSystem",
							method: "lstat",
							pathOrDescriptor: path,
						}),
					)
				: undefined,
	},
});
const syncFs: WalkerSyncFileSystem = handle.withFaults({
	sync: {
		realPath: (path: string) => {
			if (path === LOCKED) throw MemoryFileSystem.errno("EACCES", "realpath", path);
			return undefined;
		},
		lstat: (path: string) => {
			if (path === GHOST) throw MemoryFileSystem.errno("EACCES", "lstat", path);
			return undefined;
		},
	},
}).sync;
const ops: WalkerSyncOps = { fileSystem: syncFs, path: posix };
const platform = Layer.mergeAll(handle.layer, Path.layer);

type Outcome = { readonly ok: string } | { readonly refused: string } | { readonly defect: string };

const viaEffect = (base: string, candidate: string): Outcome => {
	const exit = Effect.runSyncExit(confineReal(base, candidate).pipe(Effect.provide(platform)));
	if (Exit.isSuccess(exit)) return { ok: exit.value };
	const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
	if (failure?._tag === "Fail" && failure.error instanceof PathEscapeError) return { refused: failure.error.reason };
	const squashed = Cause.squash(exit.cause);
	return { defect: squashed instanceof Error ? squashed.message.replace(/^Walker\.\w+: /, "") : String(squashed) };
};

const viaSync = (base: string, candidate: string, syncOps: WalkerSyncOps = ops): Outcome => {
	try {
		const result = confineRealSync(base, candidate, syncOps);
		return Result.isSuccess(result) ? { ok: result.success } : { refused: result.failure.reason };
	} catch (error) {
		return { defect: error instanceof Error ? error.message.replace(/^Walker\.\w+: /, "") : String(error) };
	}
};

/** Asserts both forms give `expected`. */
const both = (base: string, candidate: string, expected: Outcome) => {
	assert.deepStrictEqual(viaEffect(base, candidate), expected, `confineReal(${base}, ${candidate})`);
	assert.deepStrictEqual(viaSync(base, candidate), expected, `confineRealSync(${base}, ${candidate})`);
};

describe("confineReal / confineRealSync", () => {
	it("accepts a relative path inside the base, answering its real path", () => {
		both("/srv/site", "og/card.png", { ok: "/srv/site/og/card.png" });
		both("/srv/site", "alias/card.png", { ok: "/srv/site/og/card.png" });
	});

	it("accepts an absolute path already inside the base", () => {
		both("/srv/site", "/srv/site/index.html", { ok: "/srv/site/index.html" });
	});

	// The whole point: `confineRelative` accepts `out/y` (lexically inside), but the
	// link carries it to `/etc/sub/y`.
	it("refuses a path a symlink carries outside the base", () => {
		both("/srv/site", "out/y", { refused: "outside" });
		both("/srv/site", "out", { refused: "outside" });
		both("/srv/site", "/srv/site/out/y", { refused: "outside" });
	});

	// `..` after a link climbs out of the link's TARGET, as the OS resolves it.
	// A lexical-first resolution (`path.resolve`, node's JS `fs.realpath`) collapses
	// `out/..` to the base and would accept `out/../passwd` as `/srv/site/passwd`;
	// the OS opens `/etc/passwd`.
	it("resolves a parent segment after a link physically, not lexically", () => {
		both("/srv/site", "out/../passwd", { refused: "outside" });
		both("/srv/site", "/srv/site/out/../../passwd", { refused: "outside" });
		both("/srv/site", "alias/../index.html", { ok: "/srv/site/index.html" });
	});

	it("refuses a plain absolute or traversing path outside the base", () => {
		both("/srv/site", "/etc/passwd", { refused: "outside" });
		both("/srv/site", "../site-evil/x", { refused: "outside" });
		// A sibling sharing the base as a string prefix is not inside it.
		both("/srv/site", "/srv/site-evil/x", { refused: "outside" });
	});

	it("checks a path that does not exist yet from its real existing ancestor", () => {
		both("/srv/site", "new/dir/file.txt", { ok: "/srv/site/new/dir/file.txt" });
		both("/srv/site", "out/new.txt", { refused: "outside" });
		both("/srv/site", "new/../../etc/x", { refused: "outside" });
	});

	it("refuses the base itself, however it is spelled", () => {
		both("/srv/site", "", { refused: "empty" });
		both("/srv/site", ".", { refused: "empty" });
		both("/srv/site", "/srv/site/", { refused: "empty" });
		both("/srv/site", "og/..", { refused: "empty" });
	});

	it("refuses a NUL character before any filesystem access", () => {
		both("/srv/site", `og${NUL}/x`, { refused: "nulByte" });
	});

	// Containment that cannot be verified is refused, never assumed.
	it("refuses a path whose resolution fails for a reason other than absence", () => {
		both("/srv/site", "locked/secret", { refused: "unresolvable" });
		both("/srv/site", "loop/x", { refused: "unresolvable" });
		both("/srv/site", "file.txt/x", { refused: "unresolvable" });
	});

	it.effect("carries the resolution failure as the cause", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(confineReal("/srv/site", "locked/secret"));
			assert.strictEqual(error.reason, "unresolvable");
			assert.instanceOf(error.cause, PlatformError.PlatformError);
			const sync = confineRealSync("/srv/site", "locked/secret", ops);
			assert.isTrue(Result.isFailure(sync) && (sync.failure.cause as { code?: string }).code === "EACCES");
		}).pipe(Effect.provide(platform)),
	);

	// A dangling link does not resolve, yet it is not absent: writing through it
	// creates its target. Absence is only absence when nothing — not even a link —
	// lives at the path, so every dangling link is refused, its target unverified.
	it("refuses a path through a dangling link, wherever its target points", () => {
		both("/srv/site", "dangling", { refused: "unresolvable" });
		both("/srv/site", "/srv/site/dangling", { refused: "unresolvable" });
		both("/srv/site", "dangdir/x", { refused: "unresolvable" });
		both("/srv/site", "dangling/../../etc/z", { refused: "unresolvable" });
		both("/srv/site", "chain", { refused: "unresolvable" });
		// Fail closed: a target inside the base is not proved by a link that does not resolve.
		both("/srv/site", "inner-dangling", { refused: "unresolvable" });
	});

	// Absence must be proved: a `NotFound` real path whose presence probe fails
	// is not taken as "nothing here".
	it("refuses an absent segment whose presence cannot be checked", () => {
		both("/srv/site", "ghost", { refused: "unresolvable" });
		both("/srv/site", "ghost/x", { refused: "unresolvable" });
	});

	it("refuses a base that is a dangling link", () => {
		both("/dangling-base", "a", { refused: "unresolvable" });
	});

	it.effect("carries the dangling link's resolution failure as the cause", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(confineReal("/srv/site", "dangling"));
			assert.strictEqual(error.reason, "unresolvable");
			assert.instanceOf(error.cause, PlatformError.PlatformError);
			const sync = confineRealSync("/srv/site", "dangling", ops);
			assert.isTrue(Result.isFailure(sync) && (sync.failure.cause as { code?: string }).code === "ENOENT");
		}).pipe(Effect.provide(platform)),
	);

	it("resolves a base reached through a link", () => {
		both("/link/site", "og/card.png", { ok: "/srv/site/og/card.png" });
		both("/link/site", "/srv/site/index.html", { ok: "/srv/site/index.html" });
		both("/link/site", "/link/site-evil/x", { refused: "outside" });
	});

	it("accepts paths under a base that does not exist yet, lexically", () => {
		both("/srv/new", "a/b", { ok: "/srv/new/a/b" });
		both("/srv/new", "../site/x", { refused: "outside" });
	});

	it("treats the filesystem root as a base like any other", () => {
		both("/", "etc/passwd", { ok: "/etc/passwd" });
		both("/", "/", { refused: "empty" });
	});

	// The empty-base class: a relative base would resolve against the process
	// working directory. It is wiring, so it dies (throws), never a typed refusal a
	// caller could absorb into "allowed".
	it("dies on a relative base, the empty string included", () => {
		for (const base of ["", "srv/site", ".", `srv${NUL}`]) {
			const effect = viaEffect(base, "x");
			assert.isTrue("defect" in effect, `confineReal(${JSON.stringify(base)})`);
			assert.deepStrictEqual(viaSync(base, "x"), effect);
		}
	});
});

// memfs's win32 port takes and answers win32 spellings, `realPath` included
// (`C:\repo\a.txt`, as node's win32 `realpath` does), so it serves as the port as is.
const win32Fs = MemoryFileSystem.syncFileSystem(
	MemoryFileSystem.makeSync({
		"/C:/repo/a.txt": "",
		"/C:/out/s.txt": "",
		"/C:/repo/link": MemoryFileSystem.symlink("/C:/out"),
	}).volume,
	{ pathStyle: "win32" },
);
const win32Ops: WalkerSyncOps = { fileSystem: win32Fs, path: win32 };

describe("confineRealSync on win32 path shapes", () => {
	const cases: ReadonlyArray<readonly [string, Outcome]> = [
		["a.txt", { ok: "C:\\repo\\a.txt" }],
		["sub/../a.txt", { ok: "C:\\repo\\a.txt" }],
		["new\\file", { ok: "C:\\repo\\new\\file" }],
		["link\\s.txt", { refused: "outside" }],
		["link\\..\\out\\s.txt", { refused: "outside" }],
		["D:\\x", { refused: "outside" }],
		["\\\\server\\share\\x", { refused: "outside" }],
		// Driveless rooted: absolute to win32, but on whichever drive the process is on.
		["\\out\\s.txt", { refused: "absolute" }],
		["\\repo\\a.txt", { refused: "absolute" }],
		["/repo/a.txt", { refused: "absolute" }],
		// Drive-relative: not absolute to win32, not relative to the base either.
		["C:x", { refused: "absolute" }],
		["C:", { refused: "absolute" }],
		["C:\\repo", { refused: "empty" }],
		["nul", { refused: "reservedName" }],
		["CON.txt", { refused: "reservedName" }],
		["a.txt::$DATA", { refused: "reservedName" }],
		// win32 trims trailing dots and spaces: `..  ` would be a `..`.
		["..  \\x", { refused: "reservedName" }],
	];
	for (const [candidate, expected] of cases) {
		it(`${JSON.stringify(candidate)}`, () => {
			assert.deepStrictEqual(viaSync("C:\\repo", candidate, win32Ops), expected);
		});
	}

	// `C:` alone is drive-relative, the empty base names no drive at all, and a
	// driveless `\\repo` names the current drive's root.
	it("dies on a drive-relative or empty base", () => {
		for (const base of ["C:", "C:repo", "", "\\repo", "/repo", "\\"]) {
			assert.isTrue("defect" in viaSync(base, "a.txt", win32Ops), base);
		}
		// The control: a UNC base names its root, so it is not a defect.
		assert.isFalse("defect" in viaSync("\\\\server\\share", "a.txt", win32Ops));
	});
});
