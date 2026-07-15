import { assert, describe, it, layer } from "@effect/vitest";
import { Git, GitCommandError, LsTreeEntry } from "@effected/git";
import { CatalogResolver, WorkspaceResolver } from "@effected/npm";
import { Effect, Layer, Option } from "effect";
import {
	CatalogSet,
	PackageStateSnapshot,
	WorkspaceSnapshots,
	WorkspaceStateSnapshot,
	Workspaces,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform, rootManifest } from "./fixtures.js";

// ── A scripted `Git` over a per-ref, root-relative content map ──────────────
//
// No repository on disk: `show` and `lsTree` read from the map, every other
// method fails loudly as a defect so a test proves nothing else is touched.

type RefTrees = Readonly<Record<string, Readonly<Record<string, string>>>>;

const scriptGit = (
	trees: RefTrees,
	overrides: {
		readonly lsTree?: Git["Service"]["lsTree"];
	} = {},
): Layer.Layer<Git> =>
	Layer.succeed(Git, {
		show: (_cwd: string, ref: string, path: string) => {
			// The reader passes `<ref>:./<path>` to make git resolve relative to cwd;
			// with the fixture map keyed root-relative and cwd == root, that is exactly
			// the bare-path lookup — so strip a leading `./`, as real git does.
			const relative = path.startsWith("./") ? path.slice(2) : path;
			const content = trees[ref]?.[relative];
			return Effect.succeed(content === undefined ? Option.none() : Option.some(content));
		},
		lsTree:
			overrides.lsTree ??
			((_cwd: string, ref: string) =>
				Effect.succeed(
					Object.keys(trees[ref] ?? {}).map((path) =>
						LsTreeEntry.make({ mode: "100644", type: "blob", oid: "0".repeat(40), path }),
					),
				)),
		refExists: () => Effect.die("Git.refExists not scripted"),
		mergeBase: () => Effect.die("Git.mergeBase not scripted"),
		changedFiles: () => Effect.die("Git.changedFiles not scripted"),
		workingChanges: () => Effect.die("Git.workingChanges not scripted"),
		revParse: () => Effect.die("Git.revParse not scripted"),
		checkout: () => Effect.die("Git.checkout not scripted"),
	});

/**
 * Wire `WorkspaceSnapshots` over a scripted `Git` and a virtual filesystem. The
 * filesystem carries the root marker (`WorkspaceRoot` walks the live tree); the
 * ref content comes from `git`.
 */
const snapshotsLayer = (git: Layer.Layer<Git>, tree: Tree, cwd = "/repo") => {
	const base = platform(tree);
	const core = Workspaces.layer({ cwd });
	const snapshots = WorkspaceSnapshots.layer({ cwd }).pipe(Layer.provide(git), Layer.provide(core));
	return Layer.mergeAll(core, snapshots).pipe(Layer.provideMerge(base));
};

/** Project the virtual (absolute-path) tree into a root-relative "HEAD" ref map. */
const refFromTree = (tree: Tree, root = "/repo"): RefTrees => {
	const prefix = `${root}/`;
	const rel: Record<string, string> = {};
	for (const [abs, content] of Object.entries(tree)) {
		if (abs.startsWith(prefix)) rel[abs.slice(prefix.length)] = content;
	}
	return { HEAD: rel };
};

// ── The c594ff1 regression: a bun/npm workspace must NOT collapse to root ────
//
// No `pnpm-workspace.yaml` at the ref, so the globs MUST fall back to the root
// `package.json` `workspaces` field. Without that fallback the snapshot would
// carry the root package alone, and a consumer diffing two refs would see every
// declared dependency as newly added.

const npmRefTrees: RefTrees = {
	HEAD: {
		"package.json": rootManifest(["packages/*"]),
		"packages/alpha/package.json": manifest("@x/alpha"),
		"packages/beta/package.json": manifest("@x/beta", { dependencies: { "@x/alpha": "workspace:*" } }),
	},
};

// The live filesystem only needs the root marker so `WorkspaceRoot.find`
// resolves `/repo`; the member manifests are read from git, not disk.
const npmMarkerOnly: Tree = { "/repo/package.json": rootManifest(["packages/*"]) };

describe("WorkspaceSnapshots.at — the c594ff1 fallback", () => {
	layer(snapshotsLayer(scriptGit(npmRefTrees), npmMarkerOnly))((it) => {
		it.effect("a bun/npm workspace at a ref discovers its members, not the root alone", () =>
			Effect.gen(function* () {
				const snapshots = yield* WorkspaceSnapshots;
				const snapshot = yield* snapshots.at("HEAD");
				const names = [...snapshot.versions.keys()].sort();
				// Root PLUS both members. A collapse-to-root bug returns just ["root"].
				assert.deepStrictEqual(names, ["@x/alpha", "@x/beta", "root"]);
			}),
		);

		it.effect("member dependency records survive into the snapshot", () =>
			Effect.gen(function* () {
				const snapshots = yield* WorkspaceSnapshots;
				const snapshot = yield* snapshots.at("HEAD");
				const beta = snapshot.package("@x/beta");
				assert.isTrue(Option.isSome(beta));
				if (Option.isSome(beta)) {
					assert.strictEqual(beta.value.dependencies["@x/alpha"], "workspace:*");
				}
			}),
		);
	});
});

// ── A directory that does NOT match the globs is excluded ───────────────────

const scopedRefTrees: RefTrees = {
	HEAD: {
		"package.json": rootManifest(["packages/*"]),
		"packages/alpha/package.json": manifest("@x/alpha"),
		"tools/gen/package.json": manifest("@x/gen"), // outside packages/* — must be dropped
	},
};

describe("WorkspaceSnapshots.at — glob filtering over ls-tree", () => {
	layer(snapshotsLayer(scriptGit(scopedRefTrees), npmMarkerOnly))((it) => {
		it.effect("only package.json directories the glob set accepts become members", () =>
			Effect.gen(function* () {
				const snapshots = yield* WorkspaceSnapshots;
				const snapshot = yield* snapshots.at("HEAD");
				const names = [...snapshot.versions.keys()].sort();
				// `tools/gen` is a package.json but outside `packages/*`; the root is
				// always included.
				assert.deepStrictEqual(names, ["@x/alpha", "root"]);
			}),
		);
	});
});

// ── at("HEAD") vs worktree() parity on a clean tree ─────────────────────────
//
// A pnpm workspace with an inline catalog and no lockfile: worktree assembles
// catalogs over the live filesystem, at("HEAD") over the same content via git.
// A clean tree means they must agree.

const parityTree: Tree = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\ncatalog:\n  effect: ^4.0.0\n",
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
	"/repo/packages/alpha/package.json": manifest("@x/alpha", { dependencies: { effect: "catalog:" } }),
	"/repo/packages/beta/package.json": manifest("@x/beta", {
		version: "2.0.0",
		dependencies: { "@x/alpha": "workspace:*" },
	}),
};

/** The observable state of a snapshot, normalized for comparison. */
const projected = (snapshot: WorkspaceStateSnapshot) => ({
	versions: [...snapshot.versions.entries()].sort(),
	catalogs: snapshot.catalogs.entries,
	effectResolved: snapshot.resolve("effect", "catalog:"),
	alphaResolved: snapshot.resolve("@x/alpha", "workspace:*"),
});

describe("WorkspaceSnapshots — at('HEAD') and worktree() parity on a clean tree", () => {
	layer(snapshotsLayer(scriptGit(refFromTree(parityTree)), parityTree))((it) => {
		it.effect("the two snapshots agree on packages, catalogs and resolution", () =>
			Effect.gen(function* () {
				const snapshots = yield* WorkspaceSnapshots;
				const atHead = yield* snapshots.at("HEAD");
				const worktree = yield* snapshots.worktree();
				assert.deepStrictEqual(projected(atHead), projected(worktree));
				// And that resolution is non-trivial: the catalog and workspace
				// indirections actually resolved.
				assert.deepStrictEqual(atHead.resolve("effect", "catalog:"), Option.some("^4.0.0"));
				assert.deepStrictEqual(atHead.resolve("@x/alpha", "workspace:*"), Option.some("1.0.0"));
				assert.deepStrictEqual(atHead.resolve("@x/beta", "workspace:^"), Option.some("2.0.0"));
			}),
		);
	});
});

// ── bun inline catalogs at a ref with NO bun.lock: at('HEAD') vs worktree() ──
//
// A bun-style workspace declares its catalogs in the root `package.json`
// `workspaces.catalog` block and has NO committed `bun.lock` at the ref.
// `worktree()` reads the inline block unconditionally (via `fromManifestWorkspaces`);
// gating the at-ref inline read on `bun.lock` presence reintroduced c594ff1 one
// layer up — the two snapshots disagreed, and a consumer diffing them saw every
// catalog dependency as newly added. Against the pre-fix (gated) code the inline
// read returns empty, so this parity assertion fails.

const bunNoLockTree: Tree = {
	"/repo/package.json": JSON.stringify({
		name: "root",
		version: "0.0.0",
		private: true,
		packageManager: "bun@1.2.0",
		workspaces: { packages: ["packages/*"], catalog: { effect: "^4.0.0" } },
	}),
	"/repo/packages/alpha/package.json": manifest("@x/alpha", { dependencies: { effect: "catalog:" } }),
};

describe("WorkspaceSnapshots — bun inline catalogs at a ref with NO bun.lock (parity)", () => {
	layer(snapshotsLayer(scriptGit(refFromTree(bunNoLockTree)), bunNoLockTree))((it) => {
		it.effect("at('HEAD') reads inline bun catalogs without a lockfile, matching worktree()", () =>
			Effect.gen(function* () {
				const snapshots = yield* WorkspaceSnapshots;
				const atHead = yield* snapshots.at("HEAD");
				const worktree = yield* snapshots.worktree();
				// The two catalog sets must agree — the gated code returned an EMPTY set
				// from at('HEAD') while worktree() carried `effect: ^4.0.0`.
				assert.deepStrictEqual(atHead.catalogs.entries, worktree.catalogs.entries);
				assert.deepStrictEqual(atHead.resolve("effect", "catalog:"), Option.some("^4.0.0"));
				assert.deepStrictEqual(worktree.resolve("effect", "catalog:"), Option.some("^4.0.0"));
			}),
		);
	});
});

// ── TTL-cache discipline: a failed at(ref) init is RETRIED, not memoized ─────

describe("WorkspaceSnapshots.at — a failed init is retried", () => {
	let lsTreeCalls = 0;
	const flakyLsTree: Git["Service"]["lsTree"] = (_cwd: string, ref: string) => {
		lsTreeCalls += 1;
		if (lsTreeCalls === 1) {
			return Effect.fail(new GitCommandError({ args: ["ls-tree", "-r", "-z", ref], cwd: "/repo", stderr: "boom" }));
		}
		return Effect.succeed(
			Object.keys(npmRefTrees[ref] ?? {}).map((path) =>
				LsTreeEntry.make({ mode: "100644", type: "blob", oid: "0".repeat(40), path }),
			),
		);
	};

	layer(snapshotsLayer(scriptGit(npmRefTrees, { lsTree: flakyLsTree }), npmMarkerOnly))((it) => {
		it.effect("the first call fails; the second recomputes and succeeds", () =>
			Effect.gen(function* () {
				const snapshots = yield* WorkspaceSnapshots;
				const first = yield* Effect.result(snapshots.at("HEAD"));
				assert.strictEqual(first._tag, "Failure");
				// A bare `Effect.cached` would replay the failure here. The success-only
				// memo invalidated its cell, so the second call re-runs the init.
				const second = yield* snapshots.at("HEAD");
				assert.deepStrictEqual([...second.versions.keys()].sort(), ["@x/alpha", "@x/beta", "root"]);
			}),
		);
	});
});

// ── Snapshot-scoped resolution and resolver layers (pure, no git) ───────────

const resolveSnapshot = WorkspaceStateSnapshot.make({
	packages: [
		PackageStateSnapshot.make({ name: "@x/alpha", version: "1.2.3", relativePath: "packages/alpha" }),
		PackageStateSnapshot.make({ name: "@x/beta", version: "4.5.6", relativePath: "packages/beta" }),
	],
	catalogs: CatalogSet.make({ entries: { default: { effect: "^4.0.0" }, build: { vitest: "^3.0.0" } } }),
});

describe("WorkspaceStateSnapshot.resolve", () => {
	it.effect("resolves workspace: against the snapshot's captured versions", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(resolveSnapshot.resolve("@x/alpha", "workspace:*"), Option.some("1.2.3"));
			assert.deepStrictEqual(resolveSnapshot.resolve("@x/beta", "workspace:^"), Option.some("4.5.6"));
		}),
	);

	it.effect("resolves catalog: against the snapshot's captured catalog set", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(resolveSnapshot.resolve("effect", "catalog:"), Option.some("^4.0.0"));
			assert.deepStrictEqual(resolveSnapshot.resolve("vitest", "catalog:build"), Option.some("^3.0.0"));
		}),
	);

	it.effect("an unmatched specifier is Option.none(), never an error", () =>
		Effect.sync(() => {
			assert.isTrue(Option.isNone(resolveSnapshot.resolve("nope", "workspace:*"))); // not a member
			assert.isTrue(Option.isNone(resolveSnapshot.resolve("effect", "catalog:missing"))); // unknown catalog
			assert.isTrue(Option.isNone(resolveSnapshot.resolve("effect", "^4.0.0"))); // plain range: nothing to resolve
			assert.isTrue(Option.isNone(resolveSnapshot.resolve("effect", "not a specifier"))); // unparseable
		}),
	);
});

describe("WorkspaceStateSnapshot — snapshot-scoped resolver layers", () => {
	it.effect("CatalogResolver and WorkspaceResolver resolve against the snapshot", () =>
		Effect.gen(function* () {
			const catalog = yield* CatalogResolver;
			const workspace = yield* WorkspaceResolver;
			assert.deepStrictEqual(yield* catalog.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
			assert.deepStrictEqual(yield* catalog.rangeOf("vitest", Option.some("build")), Option.some("^3.0.0"));
			assert.deepStrictEqual(yield* workspace.versionOf("@x/beta"), Option.some("4.5.6"));
		}).pipe(Effect.provide(resolveSnapshot.resolvers)),
	);

	it.effect("an unmatched name resolves to Option.none() on both layers", () =>
		Effect.gen(function* () {
			const catalog = yield* CatalogResolver;
			const workspace = yield* WorkspaceResolver;
			assert.isTrue(Option.isNone(yield* catalog.rangeOf("nope", Option.none())));
			assert.isTrue(Option.isNone(yield* workspace.versionOf("nope")));
		}).pipe(Effect.provide(resolveSnapshot.resolvers)),
	);
});
