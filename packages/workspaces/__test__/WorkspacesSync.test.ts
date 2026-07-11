// The synchronous escape hatch runs on real `node:fs`, so it cannot ride the
// virtual `FileSystem` layer the rest of the suite uses — these tests build a
// real temporary tree instead.
//
// `findWorkspaceRootSync` / `getWorkspacePackagesSync` are plain synchronous
// functions, not Effects, so plain `it()` is correct here.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
	WorkspaceDiscovery,
	WorkspacePatternError,
	WorkspaceRoot,
	findWorkspaceRootSync,
	getWorkspacePackagesSync,
} from "../src/index.js";

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
		const packages = getWorkspacePackagesSync(root);
		const names = packages.map((pkg) => pkg.name);
		assert.include(names, "@x/good");
	});

	it("every non-object manifest is skipped, not decoded into a member", () => {
		const names = getWorkspacePackagesSync(root).map((pkg) => pkg.name);
		// Only the root and the one good member survive; the five hostile
		// directories contribute nothing.
		assert.deepStrictEqual(names.slice().sort(), ["@x/good", "root"]);
	});

	it("the good member is still fully decoded alongside the hostile ones", () => {
		const good = getWorkspacePackagesSync(root).find((pkg) => pkg.name === "@x/good");
		assert.isDefined(good);
		assert.strictEqual(good?.version, "1.0.0");
		assert.strictEqual(good?.relativePath, "packages/good");
	});
});

describe("findWorkspaceRootSync", () => {
	it("finds the root from a nested directory", () => {
		assert.strictEqual(findWorkspaceRootSync(join(root, "packages", "good")), root);
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

			assert.strictEqual(findWorkspaceRootSync(join(hostile, "packages", "a")), hostile);
			// And enumeration over that root still works, skipping the null root manifest.
			assert.deepStrictEqual(
				getWorkspacePackagesSync(hostile).map((pkg) => pkg.name),
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
				const sync = getWorkspacePackagesSync(dir, { maxDepth: 2 }).map((pkg) => pkg.name);
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
				const sync = getWorkspacePackagesSync(dir, { maxDepth: 2 }).map((pkg) => pkg.name);
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
			assert.throws(() => getWorkspacePackagesSync(dir, { maxDepth: Number.NaN }), RangeError);
			assert.throws(() => getWorkspacePackagesSync(dir, { maxDepth: 2.5 }), RangeError);
			assert.throws(() => getWorkspacePackagesSync(dir, { maxDepth: 0 }), RangeError);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
