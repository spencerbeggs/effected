// The synchronous escape hatch takes CONSUMER-SUPPLIED operations — these
// tests exercise it three ways: over real `node:fs` (a real temporary tree,
// proving the documented one-liner wiring works), over a pure in-memory fake
// (proving no ambient Node dependency survives in `src/`), and over a
// win32-flavored `node:path.win32` (proving the path implementation is
// respected end to end).
//
// `findWorkspaceRootSync` / `getWorkspacePackagesSync` are plain synchronous
// functions, not Effects, so plain `it()` is correct here.

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath, { dirname, join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { SyncFileSystem, WorkspacePackage, WorkspacesSyncOptions } from "../src/index.js";
import {
	WorkspaceDiscovery,
	WorkspaceDiscoveryError,
	WorkspacePatternError,
	WorkspaceRoot,
	findWorkspaceRootSync,
	getWorkspacePackagesSync,
} from "../src/index.js";

// The documented consumer wiring, verbatim: every member is a one-liner over a
// Node built-in. `statSync` THROWS on a missing path — that is the contract's
// "may throw" degraded-skip case, deliberately not smoothed over here.
const nodeOps: WorkspacesSyncOptions = {
	fileSystem: {
		exists: existsSync,
		readFile: (p) => readFileSync(p, "utf8"),
		readDirectory: (p) => readdirSync(p),
		isDirectory: (p) => statSync(p).isDirectory(),
	},
	path: nodePath,
};

let root = "";

/** Write `content` to `root/relative`, creating parent directories. */
const write = (relative: string, content: string): void => {
	const file = join(root, relative);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content, "utf8");
};

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "effected-workspaces-sync-"));
	write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
	write("package.json", JSON.stringify({ name: "root", version: "0.0.0", private: true }));
	write("packages/good/package.json", JSON.stringify({ name: "@x/good", version: "1.0.0" }));

	// The hostile manifests. Each is VALID JSON that does not decode to an object,
	// which is the case a `raw === undefined` guard does not cover: `JSON.parse`
	// returns `null` / a number / a string, never `undefined`.
	write("packages/null-manifest/package.json", "null");
	write("packages/number-manifest/package.json", "42");
	write("packages/string-manifest/package.json", '"nope"');
	write("packages/array-manifest/package.json", "[1, 2, 3]");
	// And an outright syntax error, which the `undefined` guard DID cover.
	write("packages/broken-manifest/package.json", "{ not json");
});

afterAll(() => {
	if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("getWorkspacePackagesSync — hostile manifests", () => {
	it("a package.json containing exactly `null` does not crash the enumeration", () => {
		// Regression: `readJson` returned `JSON.parse`'s result typed as
		// `Record | undefined`, but `JSON.parse("null")` is `null`. The
		// `raw === undefined` guard let it through and `raw.name` threw a
		// TypeError — malformed input escaping as a DEFECT out of a function
		// documented as total. A Vitest config calling this would simply crash.
		const packages = getWorkspacePackagesSync(root, nodeOps);
		const names = packages.map((pkg) => pkg.name);
		assert.include(names, "@x/good");
	});

	it("every non-object manifest is skipped, not decoded into a member", () => {
		const names = getWorkspacePackagesSync(root, nodeOps).map((pkg) => pkg.name);
		// Only the root and the one good member survive; the five hostile
		// directories contribute nothing.
		assert.deepStrictEqual(names.slice().sort(), ["@x/good", "root"]);
	});

	it("the good member is still fully decoded alongside the hostile ones", () => {
		const good = getWorkspacePackagesSync(root, nodeOps).find((pkg) => pkg.name === "@x/good");
		assert.isDefined(good);
		assert.strictEqual(good?.version, "1.0.0");
		assert.strictEqual(good?.relativePath, "packages/good");
	});

	it("the as-read manifest record rides along on every member", () => {
		const good = getWorkspacePackagesSync(root, nodeOps).find((pkg) => pkg.name === "@x/good");
		assert.deepStrictEqual(good?.manifestRecord, { name: "@x/good", version: "1.0.0" });
	});
});

describe("findWorkspaceRootSync", () => {
	it("finds the root from a nested directory", () => {
		assert.strictEqual(findWorkspaceRootSync(join(root, "packages", "good"), nodeOps), root);
	});

	it("a root whose package.json is `null` still resolves via pnpm-workspace.yaml", () => {
		// The shared fixture's root manifest is VALID, so asserting against it here
		// would only re-test pnpm marker discovery and never create the hostile
		// state this test is named for. Build the state explicitly.
		const hostile = mkdtempSync(join(tmpdir(), "effected-workspaces-null-root-"));
		try {
			writeFileSync(join(hostile, "package.json"), "null", "utf8");
			writeFileSync(join(hostile, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf8");
			mkdirSync(join(hostile, "packages", "a"), { recursive: true });
			writeFileSync(join(hostile, "packages", "a", "package.json"), JSON.stringify({ name: "@h/a", version: "1.0.0" }));

			assert.strictEqual(findWorkspaceRootSync(join(hostile, "packages", "a"), nodeOps), hostile);
			// And enumeration over that root still works, skipping the null root manifest.
			assert.deepStrictEqual(
				getWorkspacePackagesSync(hostile, nodeOps).map((pkg) => pkg.name),
				["@h/a"],
			);
		} finally {
			rmSync(hostile, { recursive: true, force: true });
		}
	});
});

// ── the sync hatch and the Effect enumerator must not drift ────────────────
//
// Both entry points drive ONE traversal state machine (`internal/traverse.ts`).
// Before that, each hand-rolled its own worklist, and they had already diverged:
// the sync copy accepted a child BEFORE checking its depth, so it returned a
// package one level beyond the cap that the Effect enumerator rejected on the
// same tree.
//
// A test that exercises only one entry point cannot catch that class of bug, so
// this suite runs BOTH against the same real directory tree, at the depth
// boundary, and asserts they agree.

/** `packages/**` with a package at exactly `depth` levels below `packages/`. */
const treeOfDepth = (depth: number): string => {
	const dir = mkdtempSync(join(tmpdir(), "effected-workspaces-depth-"));
	writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/**'\n", "utf8");
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root", version: "0.0.0" }), "utf8");
	// depth 1 => packages/a ; depth 2 => packages/n1/a ; depth 3 => packages/n1/n2/a
	const segments = Array.from({ length: depth - 1 }, (_, i) => `n${i + 1}`);
	const leaf = join(dir, "packages", ...segments, "deep");
	mkdirSync(leaf, { recursive: true });
	writeFileSync(join(leaf, "package.json"), JSON.stringify({ name: "@d/deep", version: "1.0.0" }), "utf8");
	return dir;
};

const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** The Effect enumerator over the SAME real directory, through the public discovery service. */
const effectNames = (dir: string, maxDepth: number) =>
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		return (yield* discovery.listPackages()).map((pkg) => pkg.name);
	}).pipe(
		Effect.provide(
			WorkspaceDiscovery.layer({ cwd: dir, maxDepth }).pipe(
				Layer.provide(WorkspaceRoot.layer),
				Layer.provideMerge(Platform),
			),
		),
	);

describe("the sync hatch and the Effect enumerator agree at the depth boundary", () => {
	it.effect("AT the cap, both find the deep package", () =>
		Effect.gen(function* () {
			// The leaf sits exactly `maxDepth` levels below `packages/`.
			const dir = treeOfDepth(2);
			try {
				const sync = getWorkspacePackagesSync(dir, { ...nodeOps, maxDepth: 2 }).map((pkg) => pkg.name);
				const eff = yield* effectNames(dir, 2);
				assert.include(sync, "@d/deep");
				assert.deepStrictEqual(sync.slice().sort(), eff.slice().sort());
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}),
	);

	it.effect("BEYOND the cap, the sync hatch does NOT return a package the Effect path rejects", () =>
		Effect.gen(function* () {
			// The leaf sits one level past `maxDepth`.
			const dir = treeOfDepth(3);
			try {
				const sync = getWorkspacePackagesSync(dir, { ...nodeOps, maxDepth: 2 }).map((pkg) => pkg.name);
				// THE DRIFT: the old sync worklist accepted the child and then declined
				// to descend, so `@d/deep` came back here while the Effect enumerator
				// failed with depthExceeded on the identical tree.
				assert.notInclude(sync, "@d/deep");

				// The Effect path fails typed on the same input. That difference — fail
				// vs truncate — is the ONE deliberate divergence: the sync hatch has no
				// error channel. What must never differ is which packages are in scope.
				const error = yield* Effect.flip(effectNames(dir, 2));
				assert.instanceOf(error, WorkspacePatternError);
				assert.strictEqual(error.kind, "depthExceeded");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}),
	);

	it("a maxDepth that is not a positive integer is a caller error, not a silent empty result", () => {
		const dir = treeOfDepth(1);
		try {
			// NaN and 2.5 both slip past a bare `maxDepth < 1`, and a NaN bound then
			// enumerates nothing — indistinguishable from a legitimately empty
			// workspace. Same predicate as the enumerator's `Effect.die`.
			assert.throws(() => getWorkspacePackagesSync(dir, { ...nodeOps, maxDepth: Number.NaN }), RangeError);
			assert.throws(() => getWorkspacePackagesSync(dir, { ...nodeOps, maxDepth: 2.5 }), RangeError);
			assert.throws(() => getWorkspacePackagesSync(dir, { ...nodeOps, maxDepth: 0 }), RangeError);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── consumer-supplied ops: no ambient Node dependency ───────────────────────
//
// A pure in-memory `SyncFileSystem` over a record of files. If `src/` still
// reached for `node:fs` anywhere, these suites could not work: nothing below
// exists on disk. The separator-normalization also serves the win32 suite,
// whose `path.win32.join` produces backslashed paths over the same store.

const fakeFs = (files: Readonly<Record<string, string>>): SyncFileSystem => {
	const normalize = (p: string): string => p.replace(/\\/g, "/");
	const dirs = new Set<string>();
	for (const key of Object.keys(files)) {
		let dir = key.slice(0, key.lastIndexOf("/"));
		while (dir.length > 0 && !dirs.has(dir)) {
			dirs.add(dir);
			dir = dir.slice(0, dir.lastIndexOf("/"));
		}
	}
	return {
		exists: (p) => {
			const n = normalize(p);
			return Object.hasOwn(files, n) || dirs.has(n);
		},
		readFile: (p) => {
			const hit = files[normalize(p)];
			// A miss THROWS, per the consumer contract (readFileSync semantics);
			// the hatch must degrade it to a skip, never propagate it.
			if (hit === undefined) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
			return hit;
		},
		readDirectory: (p) => {
			const n = normalize(p);
			if (!dirs.has(n)) throw new Error(`ENOENT: no such file or directory, scandir '${p}'`);
			const prefix = `${n}/`;
			const entries = new Set<string>();
			for (const candidate of [...Object.keys(files), ...dirs]) {
				if (!candidate.startsWith(prefix)) continue;
				const rest = candidate.slice(prefix.length);
				const head = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
				if (head.length > 0) entries.add(head);
			}
			return [...entries].sort();
		},
		// `statSync(p).isDirectory()` THROWS on a missing path; the fake mirrors
		// the readable half only — a miss is `false` would be too kind, so throw.
		isDirectory: (p) => {
			const n = normalize(p);
			if (!dirs.has(n) && !Object.hasOwn(files, n)) throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
			return dirs.has(n);
		},
	};
};

describe("getWorkspacePackagesSync over pure in-memory ops (no ambient Node fs)", () => {
	const files: Record<string, string> = {
		"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
		"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
		"/repo/packages/a/package.json": JSON.stringify({
			name: "@mem/a",
			version: "2.0.0",
			scripts: { build: "tsc" },
		}),
		"/repo/packages/b/package.json": JSON.stringify({ name: "@mem/b", version: "3.0.0" }),
	};
	const ops: WorkspacesSyncOptions = { fileSystem: fakeFs(files), path: nodePath.posix };

	it("enumerates the virtual workspace", () => {
		const names = getWorkspacePackagesSync("/repo", ops).map((pkg) => pkg.name);
		assert.deepStrictEqual(names, ["root", "@mem/a", "@mem/b"]);
	});

	it("finds the root by ascending the virtual tree", () => {
		assert.strictEqual(findWorkspaceRootSync("/repo/packages/a", ops), "/repo");
	});

	it("carries fields outside the discovery slice through manifestRecord", () => {
		const a = getWorkspacePackagesSync("/repo", ops).find((pkg) => pkg.name === "@mem/a");
		assert.deepStrictEqual(a?.manifestRecord.scripts, { build: "tsc" });
	});
});

// ── exclusions: the gate is at ACCEPTANCE, never at descent ────────────────
//
// The sync hatch mirrors the async enumerator's exclusion handling, so it owes
// the same proof. `!packages/private-*` rejects `packages/private-thing` and
// nothing below it — a `*` does not cross a segment boundary — so a package
// nested under an excluded directory is still a member. Gating `traversal.push`
// on the exclusion instead would drop it silently.

describe("getWorkspacePackagesSync — exclusions", () => {
	const files: Record<string, string> = {
		"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/**'\n  - '!packages/private-*'\n",
		"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
		"/repo/packages/alpha/package.json": JSON.stringify({ name: "@mem/alpha", version: "1.0.0" }),
		"/repo/packages/private-thing/package.json": JSON.stringify({ name: "@mem/private", version: "1.0.0" }),
		"/repo/packages/private-thing/nested/package.json": JSON.stringify({ name: "@mem/nested", version: "1.0.0" }),
	};
	const ops: WorkspacesSyncOptions = { fileSystem: fakeFs(files), path: nodePath.posix };

	it("a leading-bang pattern excludes the package the includes matched", () => {
		const names = getWorkspacePackagesSync("/repo", ops).map((pkg) => pkg.name);
		assert.include(names, "@mem/alpha");
		assert.notInclude(names, "@mem/private");
	});

	it("an excluded directory is still DESCENDED — a package under it stays discovered", () => {
		const names = getWorkspacePackagesSync("/repo", ops).map((pkg) => pkg.name);
		assert.include(names, "@mem/nested");
	});
});

// ── the consumer's path implementation is respected end to end ─────────────
//
// A win32-flavored `SyncPath` (drive-letter roots, backslash output) drives the
// whole enumeration over the same in-memory store. Under the posix
// implementation these inputs cannot even ascend: `path.posix.dirname` of a
// backslashed path is `"."` immediately — pinned below so the suite cannot
// pass vacuously.

describe("WorkspacesSync with a win32 SyncPath", () => {
	const files: Record<string, string> = {
		"C:/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
		"C:/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
		"C:/repo/packages/a/package.json": JSON.stringify({ name: "@win/a", version: "1.0.0" }),
	};
	const ops: WorkspacesSyncOptions = { fileSystem: fakeFs(files), path: nodePath.win32 };

	it("finds the root by ascending a drive-letter path", () => {
		assert.strictEqual(findWorkspaceRootSync("C:\\repo\\packages\\a", ops), "C:\\repo");
	});

	it("enumerates the workspace under a drive-letter root", () => {
		const packages = getWorkspacePackagesSync("C:\\repo", ops);
		assert.deepStrictEqual(
			packages.map((pkg) => pkg.name),
			["root", "@win/a"],
		);
		const a = packages.find((pkg) => pkg.name === "@win/a");
		// Absolute paths come from the CONSUMER's implementation (backslashes);
		// the workspace-relative path stays POSIX by the `packages:` contract.
		assert.strictEqual(a?.path, "C:\\repo\\packages\\a");
		assert.strictEqual(a?.relativePath, "packages/a");
	});

	it("the two path implementations genuinely disagree about these inputs", () => {
		// The premise the suite rests on, pinned: under posix the ascent is a
		// no-op fixpoint at ".", so the win32 result above could never have come
		// from the posix implementation.
		assert.strictEqual(nodePath.posix.dirname("C:\\repo\\packages\\a"), ".");
		assert.strictEqual(nodePath.win32.dirname("C:\\repo\\packages\\a"), "C:\\repo\\packages");
		assert.isNull(findWorkspaceRootSync("C:\\repo\\packages\\a", { ...ops, path: nodePath.posix }));
	});
});

// The optional `readDirectoryWithTypes` fast path. It must be a pure syscall
// saving: identical results to the four-operation fallback on every tree,
// including one whose package directories are SYMLINKS — the case where a
// naive implementation trusting `Dirent.isDirectory()` silently drops packages,
// because a dirent describes the link and not its target.
describe("SyncFileSystem.readDirectoryWithTypes (optional fast path)", () => {
	let root: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "ws-dirent-"));
		mkdirSync(join(root, "packages/a"), { recursive: true });
		mkdirSync(join(root, "real/b"), { recursive: true });
		writeFileSync(join(root, "package.json"), `{ "name": "root", "version": "0.0.0", "private": true }`);
		writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
		writeFileSync(join(root, "packages/a/package.json"), `{ "name": "@x/a", "version": "1.0.0" }`);
		writeFileSync(join(root, "real/b/package.json"), `{ "name": "@x/b", "version": "2.0.0" }`);
		// packages/b is a SYMLINK to a directory holding a real package.
		symlinkSync(join(root, "real/b"), join(root, "packages/b"), "dir");
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	// The fallback: exactly the documented four-operation wiring, no fast path.
	const slow: SyncFileSystem = {
		exists: existsSync,
		readFile: (p) => readFileSync(p, "utf8"),
		readDirectory: (p) => readdirSync(p),
		isDirectory: (p) => statSync(p).isDirectory(),
	};

	const fast: SyncFileSystem = {
		...slow,
		readDirectoryWithTypes: (p) =>
			readdirSync(p, { withFileTypes: true }).map((entry) => ({
				name: entry.name,
				isDirectory: entry.isDirectory(),
				isSymbolicLink: entry.isSymbolicLink(),
			})),
	};

	it("agrees with the fallback, symlinked package directories included", () => {
		const viaSlow = getWorkspacePackagesSync(root, { fileSystem: slow, path: nodePath });
		const viaFast = getWorkspacePackagesSync(root, { fileSystem: fast, path: nodePath });

		// The positive control: the symlinked package must actually be found, or
		// "the two agree" would be satisfied by both finding nothing.
		assert.deepStrictEqual(
			viaSlow.map((pkg) => pkg.name).sort(),
			["@x/a", "@x/b", "root"],
			"fallback must resolve the symlinked package",
		);
		assert.deepStrictEqual(viaFast.map((pkg) => pkg.name).sort(), viaSlow.map((pkg) => pkg.name).sort());
		assert.deepStrictEqual(viaFast, viaSlow);
	});

	it("a throwing fast path skips the directory rather than propagating", () => {
		const throwing: SyncFileSystem = {
			...slow,
			readDirectoryWithTypes: () => {
				throw new Error("EACCES");
			},
		};
		// The whole wildcard base is unreadable, so no wildcard member survives —
		// but the root package still resolves and nothing escapes.
		assert.deepStrictEqual(
			getWorkspacePackagesSync(root, { fileSystem: throwing, path: nodePath }).map((pkg) => pkg.name),
			["root"],
		);
	});
});

// The port is consumer-supplied, so `@effected/memfs` is a sanctioned backend
// for it — and a backend that answered symlinks LITERALLY would silently drop a
// symlinked package, giving two different package lists for one workspace
// depending on which backend supplied the port. Caught in review of #445; this
// pins the two backends against each other on the tree that discriminates.
describe("SyncFileSystem over a memfs volume", () => {
	const seed = {
		"/repo/package.json": `{ "name": "root", "version": "0.0.0", "private": true }`,
		"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
		"/repo/packages/a/package.json": `{ "name": "@x/a", "version": "1.0.0" }`,
		"/repo/real/b/package.json": `{ "name": "@x/b", "version": "2.0.0" }`,
		// packages/b is a SYMLINK to a directory holding a real package.
		"/repo/packages/b": MemoryFileSystem.symlink("/repo/real/b"),
	};

	it.effect("enumerates a symlinked package directory, as the node binding does", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);

			const found = getWorkspacePackagesSync("/repo", { fileSystem, path: nodePath.posix })
				.map((pkg) => pkg.name)
				.sort();

			// The positive control: the symlinked package must actually be found,
			// or this would pass on an empty result.
			assert.deepStrictEqual(found, ["@x/a", "@x/b", "root"]);
		}),
	);

	it.effect("resolves the workspace root through a symlinked directory", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);
			assert.strictEqual(findWorkspaceRootSync("/repo/packages/b", { fileSystem, path: nodePath.posix }), "/repo");
		}),
	);
});

// ── version-less manifests are members; every other skip is REPORTED (#605) ──

describe("getWorkspacePackagesSync — version-less manifests and skip reporting", () => {
	const seed = {
		// The ordinary private-monorepo root: a name, no `version`.
		"/repo/package.json": `{ "name": "root", "private": true }`,
		"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
		"/repo/packages/bare/package.json": `{ "name": "@x/bare", "private": true }`,
		"/repo/packages/versioned/package.json": `{ "name": "@x/versioned", "version": "1.0.0" }`,
		// The manifests that ARE unusable, one per skip kind the read can produce.
		"/repo/packages/nameless/package.json": `{ "version": "1.0.0" }`,
		"/repo/packages/broken/package.json": `{ not json`,
		"/repo/packages/scalar/package.json": `42`,
		"/repo/packages/bad-version/package.json": `{ "name": "@x/bad-version", "version": 42 }`,
	};

	it.effect("a version-less root AND member are returned, root first, with `version` absent", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);
			const packages = getWorkspacePackagesSync("/repo", { fileSystem, path: nodePath.posix });
			assert.deepStrictEqual(
				packages.map((pkg) => pkg.name),
				["root", "@x/bare", "@x/versioned"],
			);
			assert.isTrue(packages[0].isRootWorkspace);
			// Absent — never a placeholder, never a present `undefined` key.
			assert.isFalse(Object.hasOwn(packages[0], "version"));
			assert.isFalse(Object.hasOwn(packages[1], "version"));
			assert.strictEqual(packages[2].version, "1.0.0");
		}),
	);

	it.effect("every skipped manifest is reported with its path and kind through `onSkip`", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);
			const skipped: Array<{ readonly path: string; readonly kind: string; readonly root: string }> = [];
			getWorkspacePackagesSync("/repo", {
				fileSystem,
				path: nodePath.posix,
				onSkip: (skip) => skipped.push({ path: skip.path, kind: skip.kind, root: skip.root }),
			});
			// One report per unusable manifest, no report for a usable one — and
			// the version-less members above are NOT among them.
			assert.deepStrictEqual(
				skipped.slice().sort((a, b) => a.path.localeCompare(b.path)),
				[
					{ root: "/repo", path: "/repo/packages/bad-version/package.json", kind: "invalidShape" },
					{ root: "/repo", path: "/repo/packages/broken/package.json", kind: "invalidJson" },
					{ root: "/repo", path: "/repo/packages/nameless/package.json", kind: "missingName" },
					{ root: "/repo", path: "/repo/packages/scalar/package.json", kind: "invalidShape" },
				],
			);
		}),
	);

	it.effect("a throwing `readFile` is reported as a `read` skip carrying the thrown cause", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const base = MemoryFileSystem.syncFileSystem(volume);
			const boom = new Error("EACCES");
			const fileSystem: SyncFileSystem = {
				...base,
				readFile: (p) => {
					if (p === "/repo/packages/versioned/package.json") throw boom;
					return base.readFile(p);
				},
			};
			const skipped: Array<{ readonly path: string; readonly kind: string; readonly cause: unknown }> = [];
			const names = getWorkspacePackagesSync("/repo", {
				fileSystem,
				path: nodePath.posix,
				onSkip: (skip) => skipped.push({ path: skip.path, kind: skip.kind, cause: skip.cause }),
			}).map((pkg) => pkg.name);
			// The unreadable member is gone from the result AND accounted for.
			assert.notInclude(names, "@x/versioned");
			const read = skipped.find((skip) => skip.path === "/repo/packages/versioned/package.json");
			assert.deepStrictEqual(read, { path: "/repo/packages/versioned/package.json", kind: "read", cause: boom });
		}),
	);

	it.effect("a skipped ROOT manifest is reported too, not silently dropped", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				...seed,
				"/repo/package.json": "null",
			});
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);
			const skipped: Array<string> = [];
			const names = getWorkspacePackagesSync("/repo", {
				fileSystem,
				path: nodePath.posix,
				onSkip: (skip) => skipped.push(`${skip.kind}:${skip.path}`),
			}).map((pkg) => pkg.name);
			assert.notInclude(names, "root");
			assert.include(skipped, "invalidShape:/repo/package.json");
		}),
	);

	it.effect("a version that is PRESENT but EMPTY is skipped as invalidShape, never admitted", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				...seed,
				"/repo/packages/empty/package.json": `{ "name": "@x/empty", "version": "" }`,
			});
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);
			const skipped: Array<{ readonly path: string; readonly kind: string }> = [];
			const names = getWorkspacePackagesSync("/repo", {
				fileSystem,
				path: nodePath.posix,
				onSkip: (skip) => skipped.push({ path: skip.path, kind: skip.kind }),
			}).map((pkg) => pkg.name);
			// `""` was never a legitimate pnpm shape: admitted, it resolves
			// `workspace:^` to a bare `"^"`. Absence is tolerated; an empty string
			// is the manifest's shape being wrong, as on the Effect surface.
			assert.notInclude(names, "@x/empty");
			// Positive control: the version-less member IS still admitted.
			assert.include(names, "@x/bare");
			assert.deepStrictEqual(
				skipped.filter((skip) => skip.path === "/repo/packages/empty/package.json"),
				[{ path: "/repo/packages/empty/package.json", kind: "invalidShape" }],
			);
		}),
	);

	it.effect("every skip carries the cause the Effect surface fails with; only missingName has none", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				...seed,
				"/repo/packages/empty/package.json": `{ "name": "@x/empty", "version": "" }`,
			});
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);
			const causes = new Map<string, unknown>();
			getWorkspacePackagesSync("/repo", {
				fileSystem,
				path: nodePath.posix,
				onSkip: (skip) => causes.set(skip.path, skip.cause),
			});
			const messageAt = (path: string): unknown => {
				const cause = causes.get(path);
				return cause instanceof Error ? cause.message : cause;
			};
			// The same sentences `WorkspaceDiscovery` attaches, so a consumer reading
			// a skip and a consumer reading a failure read one vocabulary.
			assert.strictEqual(messageAt("/repo/packages/bad-version/package.json"), "version must be a string, got number");
			assert.strictEqual(messageAt("/repo/packages/empty/package.json"), "version must be a non-empty string");
			assert.strictEqual(messageAt("/repo/packages/scalar/package.json"), "package.json is not a JSON object");
			// `missingName` is the one kind with nothing to attach — the field is
			// simply absent, and there is no originating throwable.
			assert.strictEqual(causes.get("/repo/packages/nameless/package.json"), undefined);
			// Discriminating control: `invalidJson` carries the thrown SyntaxError.
			assert.instanceOf(causes.get("/repo/packages/broken/package.json"), SyntaxError);
		}),
	);

	it.effect("without `onSkip` the call stays total and returns the same members", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const fileSystem = MemoryFileSystem.syncFileSystem(volume);
			const names = getWorkspacePackagesSync("/repo", { fileSystem, path: nodePath.posix }).map((pkg) => pkg.name);
			assert.deepStrictEqual(names, ["root", "@x/bare", "@x/versioned"]);
		}),
	);
});

// ── the two surfaces agree about a version-less tree (#605) ────────────────

describe("the sync hatch and the Effect enumerator agree about `version`", () => {
	// One seed, read both ways: the Effect enumerator over the volume's own
	// `FileSystem`, the sync facade over `syncFileSystem` of the same volume.
	// Anything the two disagree about here is a real divergence, not a fixture
	// difference — which is what a separate real-directory fixture could not
	// prove.
	const paritySeed = {
		"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
		// A version-less root, the ordinary private-monorepo shape.
		"/repo/package.json": `{ "name": "root", "private": true }`,
		"/repo/packages/bare/package.json": `{ "name": "@x/bare", "private": true }`,
		"/repo/packages/versioned/package.json": `{ "name": "@x/versioned", "version": "1.0.0" }`,
	};

	/** `(name, hasOwn version, version)` — the tuple both surfaces must agree on. */
	const tuplesOf = (packages: ReadonlyArray<WorkspacePackage>) =>
		packages.map((pkg) => [pkg.name, Object.hasOwn(pkg, "version"), pkg.version] as const);

	it.effect("identical (name, hasOwn version, version) tuples, and one skip vocabulary", () =>
		Effect.gen(function* () {
			const { fileSystem, volume } = yield* MemoryFileSystem.makeInspectableWith(paritySeed);
			const sync = MemoryFileSystem.syncFileSystem(volume);
			const platform = Layer.mergeAll(Layer.succeed(FileSystem.FileSystem, fileSystem), Path.layer);
			const roots = WorkspaceRoot.layer.pipe(Layer.provide(platform));
			const discovery = WorkspaceDiscovery.layer({ cwd: "/repo" }).pipe(Layer.provide(roots), Layer.provide(platform));

			const asyncPackages = yield* Effect.gen(function* () {
				const service = yield* WorkspaceDiscovery;
				return yield* service.listPackages();
			}).pipe(Effect.provide(Layer.mergeAll(discovery, roots).pipe(Layer.provideMerge(platform))));
			const syncPackages = getWorkspacePackagesSync("/repo", { fileSystem: sync, path: nodePath.posix });

			// The positive control: both actually found the tree. Comparing two
			// empty arrays would pass under any implementation.
			assert.deepStrictEqual(
				asyncPackages.map((pkg) => pkg.name),
				["root", "@x/bare", "@x/versioned"],
			);
			assert.deepStrictEqual(tuplesOf(syncPackages), tuplesOf(asyncPackages));

			// And the skip vocabulary: a nameless member fails the Effect surface
			// with the kind the sync facade reports it under.
			const { fileSystem: namelessFs, volume: namelessVolume } = yield* MemoryFileSystem.makeInspectableWith({
				...paritySeed,
				"/repo/packages/nameless/package.json": `{ "version": "1.0.0" }`,
			});
			const namelessPlatform = Layer.mergeAll(Layer.succeed(FileSystem.FileSystem, namelessFs), Path.layer);
			const namelessRoots = WorkspaceRoot.layer.pipe(Layer.provide(namelessPlatform));
			const failure = yield* Effect.flip(
				Effect.gen(function* () {
					const service = yield* WorkspaceDiscovery;
					return yield* service.listPackages();
				}).pipe(
					Effect.provide(
						Layer.mergeAll(
							WorkspaceDiscovery.layer({ cwd: "/repo" }).pipe(
								Layer.provide(namelessRoots),
								Layer.provide(namelessPlatform),
							),
							namelessRoots,
						).pipe(Layer.provideMerge(namelessPlatform)),
					),
				),
			);
			const skipped: Array<{ readonly path: string; readonly kind: string }> = [];
			getWorkspacePackagesSync("/repo", {
				fileSystem: MemoryFileSystem.syncFileSystem(namelessVolume),
				path: nodePath.posix,
				onSkip: (skip) => skipped.push({ path: skip.path, kind: skip.kind }),
			});
			assert.instanceOf(failure, WorkspaceDiscoveryError);
			assert.deepStrictEqual(skipped, [{ path: failure.path, kind: failure.kind }]);
		}),
	);
});
