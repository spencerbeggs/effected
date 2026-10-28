// `markers` across every root-resolving service, and through the composites.
//
// The layout is the yarn-migrated pnpm workspace: a pnpm root whose member
// `pkgs/migrated` kept a `package.json#workspaces` field. pnpm ignores that
// field, so for a pnpm-only tool the root of `pkgs/migrated` is `/repo`. With
// the default markers every service stops at the member (the controls pin
// that); with `markers: ["pnpm-workspace.yaml"]` each must pass it and answer
// from `/repo`. A composite must forward the filter to ALL of them — never a
// split where discovery answers from `/repo` while the lockfile, catalog or
// snapshot reads stop at the member.

import nodePath from "node:path";
import { assert, describe, it, layer } from "@effect/vitest";
import { LocalExec, ScriptedSpawner } from "@effected/commands";
import { Git, LsTreeEntry } from "@effected/git";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Option } from "effect";
import {
	ConfigDependencyHooks,
	LockfileReader,
	WorkspaceCatalogs,
	WorkspaceDiscovery,
	WorkspaceRoot,
	WorkspaceSnapshots,
	Workspaces,
	findWorkspaceRootSync,
	locateWorkspaceRootSync,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform } from "./fixtures.js";

const CWD = "/repo/pkgs/migrated";
const pnpmOnly = ["pnpm-workspace.yaml"] as const;

const workspaceYaml = "packages:\n  - 'pkgs/*'\ncatalog:\n  effect: ^4.0.0\n";
const lockfile = [
	"lockfileVersion: '9.0'",
	"catalogs:",
	"  default:",
	"    effect:",
	"      specifier: ^4.0.0",
	"      version: 4.0.0",
	"importers:",
	"  .:",
	"    dependencies: {}",
	"  pkgs/migrated:",
	"    dependencies: {}",
	"  pkgs/other:",
	"    dependencies: {}",
	"",
].join("\n");
const rootManifest = JSON.stringify({ name: "repo-root", version: "0.0.0", private: true });
const migratedManifest = manifest("migrated", { workspaces: ["sub/*"] });

const migratedTree: Tree = {
	"/repo/pnpm-workspace.yaml": workspaceYaml,
	"/repo/pnpm-lock.yaml": lockfile,
	"/repo/package.json": rootManifest,
	"/repo/pkgs/migrated/package.json": migratedManifest,
	"/repo/pkgs/other/package.json": manifest("other"),
};

/** The workspace as git would show it at `HEAD`, root-relative. */
const atHead: Readonly<Record<string, string>> = {
	"pnpm-workspace.yaml": workspaceYaml,
	"pnpm-lock.yaml": lockfile,
	"package.json": rootManifest,
	"pkgs/migrated/package.json": migratedManifest,
	"pkgs/other/package.json": manifest("other"),
};

/**
 * A scripted `Git` that answers only for a repository at `/repo`: a snapshot
 * read from any other root sees an empty tree, so a service that stopped at the
 * member cannot pass by accident.
 */
const repoGit: Layer.Layer<Git> = Git.layerTest({
	show: (cwd: string, _ref: string, path: string) => {
		if (cwd !== "/repo") return Effect.succeed(Option.none());
		const content = atHead[path.startsWith("./") ? path.slice(2) : path];
		return Effect.succeed(content === undefined ? Option.none() : Option.some(content));
	},
	lsTree: (cwd: string) =>
		Effect.succeed(
			cwd !== "/repo"
				? []
				: Object.keys(atHead).map((path) =>
						LsTreeEntry.make({ mode: "100644", type: "blob", oid: "0".repeat(40), path }),
					),
		),
});

/** The unfiltered core composite, which every sibling below is built over. */
const unfilteredCore = Workspaces.layer({ cwd: CWD });

/** Discovery, lockfile and catalogs all answer from `/repo`. */
const coreAnswersFromRepo = Effect.gen(function* () {
	const info = yield* (yield* WorkspaceDiscovery).info();
	assert.strictEqual(info.root, "/repo");
	const read = yield* (yield* LockfileReader).read();
	assert.include(
		read.importers.map((importer) => importer.path),
		"pkgs/other",
	);
	const catalogs = yield* (yield* WorkspaceCatalogs).set();
	assert.strictEqual(catalogs.entries.default?.effect, "^4.0.0");
});

/** `at(ref)` reads the `/repo` tree. */
const snapshotAnswersFromRepo = Effect.gen(function* () {
	const snapshot = yield* (yield* WorkspaceSnapshots).at("HEAD");
	assert.isTrue(snapshot.versions.has("other"));
});

describe("markers — the unfiltered control stops at the member", () => {
	layer(unfilteredCore.pipe(Layer.provideMerge(platform(migratedTree))))((it) => {
		it.effect("WorkspaceRoot.find takes the member for the root, and discovery then fails on it", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* (yield* WorkspaceRoot).find(CWD), CWD);
				// The member's `sub/*` pattern names nothing: discovery rooted there fails.
				const error = yield* Effect.flip((yield* WorkspaceDiscovery).info());
				assert.strictEqual(error._tag, "WorkspacePatternError");
			}),
		);
	});
});

// ── each sibling service honours its OWN markers ───────────────────────────
//
// Every sibling is built over the UNFILTERED core, so the only filter in play
// is the service's own. A service that dropped its option would stop at the
// member.

describe("markers — WorkspaceDiscovery honours its own filter", () => {
	const discovery = WorkspaceDiscovery.layer({ cwd: CWD, markers: pnpmOnly }).pipe(
		Layer.provide(WorkspaceRoot.layer),
		Layer.provideMerge(platform(migratedTree)),
	);
	layer(discovery)((it) => {
		it.effect("info() answers from the pnpm root", () =>
			Effect.gen(function* () {
				assert.strictEqual((yield* (yield* WorkspaceDiscovery).info()).root, "/repo");
			}),
		);
		it.effect("the per-call infoIn takes the filter too, though not a ceiling", () =>
			Effect.gen(function* () {
				assert.strictEqual((yield* (yield* WorkspaceDiscovery).infoIn(CWD)).root, "/repo");
			}),
		);
	});
});

describe("markers — LockfileReader honours its own filter", () => {
	const lockfiles = LockfileReader.layer({ cwd: CWD, markers: pnpmOnly }).pipe(Layer.provide(unfilteredCore));
	layer(lockfiles.pipe(Layer.provideMerge(platform(migratedTree))))((it) => {
		it.effect("read() reads the pnpm root's lockfile", () =>
			Effect.gen(function* () {
				const read = yield* (yield* LockfileReader).read();
				assert.include(
					read.importers.map((importer) => importer.path),
					"pkgs/other",
				);
			}),
		);
	});
});

describe("markers — WorkspaceCatalogs honours its own filter", () => {
	const catalogs = WorkspaceCatalogs.layer({ cwd: CWD, markers: pnpmOnly }).pipe(Layer.provide(unfilteredCore));
	layer(catalogs.pipe(Layer.provideMerge(platform(migratedTree))))((it) => {
		it.effect("set() reads the pnpm root's catalog", () =>
			Effect.gen(function* () {
				const set = yield* (yield* WorkspaceCatalogs).set();
				assert.strictEqual(set.entries.default?.effect, "^4.0.0");
			}),
		);
	});
});

describe("markers — WorkspaceSnapshots honours its own filter", () => {
	const snapshots = WorkspaceSnapshots.layer({ cwd: CWD, markers: pnpmOnly }).pipe(
		Layer.provide(repoGit),
		Layer.provide(ConfigDependencyHooks.layerNoop),
		Layer.provide(unfilteredCore),
	);
	layer(snapshots.pipe(Layer.provideMerge(platform(migratedTree))))((it) => {
		it.effect("at(ref) reads the pnpm root's tree", () => snapshotAnswersFromRepo);
	});
});

// ── the composites forward ONE markers to every service they build ─────────

const filtered = { cwd: CWD, markers: pnpmOnly } as const;

const gitFreeComposites = {
	layer: Workspaces.layer(filtered),
	layerWithConfigDependencies: Workspaces.layerWithConfigDependencies(filtered),
} as const;

for (const [name, composite] of Object.entries(gitFreeComposites)) {
	describe(`markers — Workspaces.${name} forwards the filter`, () => {
		layer(composite.pipe(Layer.provideMerge(platform(migratedTree))))((it) => {
			it.effect("discovery, lockfile and catalogs all answer from the pnpm root", () => coreAnswersFromRepo);
		});
	});
}

describe("markers — Workspaces.layerWithConfigDependenciesSubprocess forwards the filter", () => {
	const spawner = ScriptedSpawner.make(() => ({}));
	const composite = Workspaces.layerWithConfigDependenciesSubprocess(filtered).pipe(
		Layer.provide(spawner.layer),
		Layer.provideMerge(platform(migratedTree)),
	);
	layer(composite)((it) => {
		it.effect("discovery, lockfile and catalogs all answer from the pnpm root", () => coreAnswersFromRepo);
	});
});

const gitComposites = {
	layerWithGit: Workspaces.layerWithGit(filtered),
	layerWithGitAndConfigDependencies: Workspaces.layerWithGitAndConfigDependencies(filtered),
	layerWithGitAndConfigDependenciesSubprocess: Workspaces.layerWithGitAndConfigDependenciesSubprocess(filtered),
	layerWithGitAndHooks: Workspaces.layerWithGitAndHooks(ConfigDependencyHooks.layerNoop, filtered),
} as const;

for (const [name, composite] of Object.entries(gitComposites)) {
	describe(`markers — Workspaces.${name} forwards the filter`, () => {
		const spawner = ScriptedSpawner.make(() => ({}));
		layer(composite.pipe(Layer.provide(spawner.layer), Layer.provideMerge(platform(migratedTree))))((it) => {
			it.effect("discovery, lockfile and catalogs answer from the pnpm root, and at(ref) runs git there", () =>
				Effect.gen(function* () {
					yield* coreAnswersFromRepo;
					// The composite builds its own `Git` over the scripted spawner, whose
					// empty answers fail the read; what matters is where git ran. A
					// snapshots service that dropped the filter would spawn in the member.
					yield* Effect.exit((yield* WorkspaceSnapshots).at("HEAD"));
					assert.isAbove(spawner.spawns.length, 0);
					for (const spawn of spawner.spawns) assert.strictEqual(spawn.cwd, "/repo");
				}),
			);
		});
	});
}

// ── the localExecLayer filter ──────────────────────────────────────────────

describe("markers — Workspaces.localExecLayer runs from the pnpm root", () => {
	const contextUnder = (options: { readonly cwd: string; readonly markers?: ReadonlyArray<"pnpm-workspace.yaml"> }) =>
		Effect.flatMap(LocalExec, (local) => local.context).pipe(
			Effect.provide(Workspaces.localExecLayer(options).pipe(Layer.provide(unfilteredCore))),
		);
	layer(platform(migratedTree))((it) => {
		it.effect("filtered: the pnpm root; unfiltered: the member", () =>
			Effect.gen(function* () {
				const pnpm = yield* contextUnder(filtered);
				assert.isTrue(Option.isSome(pnpm));
				if (Option.isSome(pnpm)) assert.strictEqual(pnpm.value.directory, "/repo");
				const member = yield* contextUnder({ cwd: CWD });
				if (Option.isSome(member)) assert.notStrictEqual(member.value.directory, "/repo");
			}),
		);
	});
});

// ── an empty filter is wiring, and dies ───────────────────────────────────

it.effect("an empty markers list on a layer dies at first use", () =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			Effect.flatMap(WorkspaceDiscovery, (discovery) => discovery.info()).pipe(
				Effect.provide(
					WorkspaceDiscovery.layer({ cwd: CWD, markers: [] }).pipe(
						Layer.provide(WorkspaceRoot.layer),
						Layer.provideMerge(platform(migratedTree)),
					),
				),
			),
		);
		assert.isTrue(exit._tag === "Failure" && exit.cause.reasons.some((reason) => reason._tag === "Die"));
	}),
);

// ── the async layers agree with the sync helpers ──────────────────────────
//
// The regression the runtime review reported: on this tree, the sync
// `findWorkspaceRootSync(cwd, { markers })` answered `/repo` while
// `WorkspaceDiscovery.layer({ markers })` and `Workspaces.layer({ markers })`
// — which dropped the filter — answered the member. One memfs volume backs
// both surfaces, so they read the same bytes.

describe("markers — the async layers agree with the sync helpers on one volume", () => {
	const handle = MemoryFileSystem.makeSync(migratedTree);
	const syncOps = { fileSystem: handle.sync, path: nodePath.posix, markers: pnpmOnly } as const;
	const discovery = WorkspaceDiscovery.layer({ cwd: CWD, markers: pnpmOnly }).pipe(Layer.provide(WorkspaceRoot.layer));
	const composite = Workspaces.layer({ cwd: CWD, markers: pnpmOnly });
	layer(discovery.pipe(Layer.provideMerge(handle.layer)))((it) => {
		it.effect("WorkspaceDiscovery.layer and Workspaces.layer both answer the sync root", () =>
			Effect.gen(function* () {
				const sync = findWorkspaceRootSync(CWD, syncOps);
				assert.strictEqual(sync, "/repo");
				assert.strictEqual(locateWorkspaceRootSync(CWD, syncOps)?.root, sync);
				assert.strictEqual((yield* (yield* WorkspaceDiscovery).info()).root, sync);
				assert.strictEqual(
					(yield* Effect.provide(
						Effect.flatMap(WorkspaceDiscovery, (d) => d.info()),
						composite,
					)).root,
					sync,
				);
			}),
		);
	});
});
