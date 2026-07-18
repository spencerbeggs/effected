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
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath, { dirname, join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { SyncFileSystem, WorkspacesSyncOptions } from "../src/index.js";
import {
	WorkspaceDiscovery,
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
