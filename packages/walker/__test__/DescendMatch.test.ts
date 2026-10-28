// `descend`'s `match` option, its `cwd` contract (a missing `cwd` is an empty
// answer, a relative one dies) — each case through BOTH the `Effect` and the
// sync form over one memfs volume, asserting the same answer, so parity and
// behaviour are pinned together.

import { posix, win32 } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, Effect, Exit, Layer, Path, Result } from "effect";
import type { DescendOptions } from "../src/Descend.js";
import { descend, descendEntries } from "../src/Descend.js";
import type { DescendSyncOptions } from "../src/DescendSync.js";
import { descendEntriesSync, descendSync } from "../src/DescendSync.js";

const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	"/repo/package.json": "{}",
	"/repo/dist/index.js": "",
	"/repo/coverage/lcov.info": "",
	"/repo/node_modules/dep/node_modules/inner/index.js": "",
	"/repo/packages/a/package.json": "{}",
	"/repo/packages/a/dist/a.js": "",
	"/repo/packages/a/node_modules/x/index.js": "",
	"/repo/packages/b/dist": "a FILE named dist",
	"/repo/src/index.ts": "",
	// A link to a directory outside the tree, and one to a file.
	"/repo/build": MemoryFileSystem.symlink("/elsewhere/build"),
	"/elsewhere/build/out.js": "",
	"/repo/readme": MemoryFileSystem.symlink("/repo/src/index.ts"),
	"/repo/dangling": MemoryFileSystem.symlink("/repo/nowhere"),
};

const handle = MemoryFileSystem.makeSync(TREE);
const platform = Layer.mergeAll(handle.layer, Path.layer);
const ops = { fileSystem: handle.sync, path: posix };

const compile = (source: string): GlobPattern =>
	Result.getOrThrow(GlobPattern.compileResult(source, GlobPatternOptions.make({ dot: true })));

type Outcome = { readonly ok: unknown } | { readonly defect: string };

const viaEffect = (source: string, options: Partial<DescendOptions>): Outcome => {
	const exit = Effect.runSyncExit(
		descend(compile(source), { cwd: "/repo", ...options } as DescendOptions).pipe(Effect.provide(platform)),
	);
	if (Exit.isSuccess(exit)) return { ok: exit.value };
	const squashed = Cause.squash(exit.cause);
	return { defect: squashed instanceof Error ? squashed.message : String(squashed) };
};

const viaSync = (source: string, options: Partial<DescendSyncOptions>): Outcome => {
	try {
		const result = descendSync(compile(source), { cwd: "/repo", ...ops, ...options } as DescendSyncOptions);
		return Result.isSuccess(result) ? { ok: result.success } : { defect: `failed: ${result.failure.message}` };
	} catch (error) {
		return { defect: error instanceof Error ? error.message : String(error) };
	}
};

const both = (source: string, options: Partial<DescendOptions>, expected: Outcome) => {
	assert.deepStrictEqual(viaEffect(source, options), expected, `descend(${source})`);
	assert.deepStrictEqual(viaSync(source, options), expected, `descendSync(${source})`);
};

describe("descend match", () => {
	it("matches files only by default, as it always has", () => {
		both("*", {}, { ok: ["package.json", "readme"] });
		both("*", { match: "file" }, { ok: ["package.json", "readme"] });
	});

	it("matches directories only under match: directory", () => {
		both("*", { match: "directory" }, { ok: ["build", "coverage", "dist", "node_modules", "packages", "src"] });
	});

	it("matches both under match: any", () => {
		both("{dist,dist/*}", { match: "any" }, { ok: ["dist", "dist/index.js"] });
	});

	// The `savvy clean` shape: every `dist` and `node_modules` DIRECTORY, found
	// without reading inside one — prune and boundaries withhold only what lies
	// below a directory. `packages/b/dist` is a FILE and does not match.
	it("finds pruned directories without descending into them", () => {
		both(
			"**/{dist,node_modules}",
			{ match: "directory" },
			{ ok: ["dist", "node_modules", "packages/a/dist", "packages/a/node_modules"] },
		);
	});

	it("answers a boundary directory itself, but nothing below it", () => {
		both(
			"**",
			{ match: "directory", boundaries: ["package.json"] },
			{
				ok: ["build", "coverage", "dist", "node_modules", "packages", "packages/a", "packages/b", "src"],
			},
		);
	});

	// The kind is the RESOLVED one: the link to an outside directory matches as a
	// directory (and is never entered without followSymlinks); a dangling link is
	// nothing. The pattern decides the spelling: `b*/**` matches `build/`, never
	// the bare `build`, because a globstar after a slash needs the slash.
	it("matches a link by its resolved kind without entering it", () => {
		both("b*", { match: "directory" }, { ok: ["build"] });
		both("b*/**", { match: "any" }, { ok: ["build/"] });
		both("b*/**", { match: "any", followSymlinks: true }, { ok: ["build/", "build/out.js"] });
		both("dangling", { match: "any" }, { ok: [] });
	});

	it("matches a literal directory pattern with a single stat", () => {
		both("dist", { match: "directory" }, { ok: ["dist"] });
		both("dist", {}, { ok: [] });
		both("packages/b/dist", { match: "directory" }, { ok: [] });
		both("packages/b/dist", { match: "any" }, { ok: ["packages/b/dist"] });
	});

	it("honours the directory-only trailing slash, answered as spelled", () => {
		both(
			"*/",
			{ match: "directory" },
			{
				ok: ["build/", "coverage/", "dist/", "node_modules/", "packages/", "src/"],
			},
		);
		both("dist/", { match: "directory" }, { ok: ["dist/"] });
	});

	it("never answers cwd itself", () => {
		both("**", { match: "directory", cwd: "/repo/src" }, { ok: [] });
		both(".", { match: "directory" }, { ok: [] });
	});

	it("answers each directory once across brace alternatives", () => {
		both("{src,./src,src/}", { match: "directory" }, { ok: ["src"] });
	});

	it.effect("carries each directory's stat in descendEntries, in both forms", () =>
		Effect.gen(function* () {
			const pattern = compile("*");
			const entries = yield* descendEntries(pattern, { cwd: "/repo", match: "directory" });
			assert.isTrue(entries.every((entry) => entry.info.type === "Directory"));
			const sync = Result.getOrThrow(descendEntriesSync(pattern, { cwd: "/repo", match: "directory", ...ops }));
			assert.deepStrictEqual(
				sync.map((entry) => [entry.path, entry.info.isDirectory()]),
				entries.map((entry) => [entry.path, true]),
			);
		}).pipe(Effect.provide(platform)),
	);

	it("dies on an unknown match value", () => {
		const expected = { defect: 'Walker.descend: match must be "file", "directory" or "any", received "dir"' };
		both("*", { match: "dir" as never }, expected);
	});
});

describe("descend cwd contract", () => {
	// A missing cwd is a normal zero-match answer in every shape — absent, a
	// file, a dangling link — for literal and magic patterns, in every mode.
	it("answers nothing for a cwd that is absent, a file, or a dangling link", () => {
		for (const cwd of ["/repo/absent", "/repo/package.json", "/repo/dangling"]) {
			for (const source of ["**", "*.ts", "src/index.ts", "{a,b}/c"]) {
				both(source, { cwd }, { ok: [] });
				both(source, { cwd, match: "any" }, { ok: [] });
				both(source, { cwd, onUnreadable: "record" } as never, { ok: { matches: [], unreadable: [] } });
			}
		}
	});

	it("answers nothing for a literal base below cwd that is missing", () => {
		both("absent/**", {}, { ok: [] });
		both("package.json/*", {}, { ok: [] });
	});

	// The empty-cwd class: `join("", "C:/x")` is a win32 drive path, and any
	// relative cwd resolves against the process working directory. Wiring, so it
	// dies (throws) before any filesystem access.
	it("dies on a relative cwd, the empty string included", () => {
		for (const cwd of ["", ".", "repo", "C:/repo"]) {
			const expected = { defect: `Walker.descend: cwd must be an absolute path, received ${JSON.stringify(cwd)}` };
			both("**", { cwd }, expected);
			both("x.ts", { cwd }, expected);
		}
	});

	it("judges a win32 cwd by the win32 path implementation", () => {
		const run = (cwd: string) => {
			try {
				return descendSync(compile("C:/x"), { cwd, fileSystem: handle.sync, path: win32 });
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		};
		assert.match(String(run("")), /cwd must be an absolute path/);
		assert.match(String(run("C:")), /cwd must be an absolute path/);
		assert.match(String(run("C:repo")), /cwd must be an absolute path/);
		// Rooted on the CURRENT drive: absolute to `win32.isAbsolute`, process-dependent.
		assert.match(String(run("\\repo")), /cwd must be an absolute path/);
		assert.match(String(run("/repo")), /cwd must be an absolute path/);
		assert.match(String(run("\\")), /cwd must be an absolute path/);
		// An absolute win32 cwd is accepted; the volume has no such tree, so nothing matches.
		assert.deepStrictEqual(run("C:\\repo"), Result.succeed([]));
		// A UNC root names its server and share: no drive to depend on.
		assert.deepStrictEqual(run("\\\\server\\share"), Result.succeed([]));
	});
});
