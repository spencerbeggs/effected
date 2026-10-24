// The lazy-init discipline, pinned per service: a failed init is RETRIED on
// the next call, concurrent callers share ONE in-flight init (one underlying
// read, one shared failure), and a success is kept for good.
//
// `WorkspaceSnapshots` has its own pin; these cover the other exit-keyed memos
// (`LockfileReader`, `WorkspaceDiscovery`'s layer-bound and per-root cells,
// `WorkspaceCatalogs`). A bare `Effect.cached` at any of them replays the
// first failure forever and turns the retry step red; a per-call init (no
// memo at all) turns the one-underlying-read count red.
import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, PlatformError } from "effect";
import { LockfileReader, WorkspaceCatalogs, WorkspaceDiscovery, Workspaces } from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest } from "./fixtures.js";

const tree: Tree = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\ncatalog:\n  effect: ^4.0.0\n",
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
	"/repo/packages/a/package.json": manifest("@x/a"),
	"/repo/pnpm-lock.yaml": [
		"lockfileVersion: '9.0'",
		"catalogs:",
		"  default:",
		"    effect:",
		"      specifier: ^4.0.0",
		"      version: 4.0.0",
		"importers:",
		"  .:",
		"    dependencies: {}",
		"  packages/a:",
		"    dependencies: {}",
		"",
	].join("\n"),
};

/** A fault gate: while `deny` is on, the gated read fails; every gated call is counted either way. */
interface Gate {
	deny: boolean;
	calls: number;
}

const denied = (method: string, path: string) =>
	Effect.fail(
		PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path }),
	);

/**
 * The full stack over `tree`, with one gated `readFileString` path and one
 * gated `readDirectory` path. A gated read YIELDS before it answers: the
 * volume is otherwise synchronous, so a first caller would run its whole init
 * to completion before a second one ever started, and "two concurrent
 * callers" would never overlap. The yield is what makes the race a race.
 */
const gatedWorkspaces = (gate: Gate, gatedFile: string | undefined, gatedDirectory: string | undefined) =>
	Workspaces.layer({ cwd: "/repo" }).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				MemoryFileSystem.layerWith(tree, {
					faults: (base) => ({
						readFileString: (path, encoding) =>
							path !== gatedFile
								? undefined
								: Effect.gen(function* () {
										gate.calls += 1;
										yield* Effect.yieldNow;
										if (gate.deny) return yield* denied("readFileString", path);
										return yield* base.readFileString(path, encoding);
									}),
						readDirectory: (path, options) =>
							path !== gatedDirectory
								? undefined
								: Effect.gen(function* () {
										gate.calls += 1;
										yield* Effect.yieldNow;
										if (gate.deny) return yield* denied("readDirectory", path);
										return yield* base.readDirectory(path, options);
									}),
					}),
				}),
				Path.layer,
			),
		),
	);

/** Two concurrent callers of `init`: both exits, from one shared in-flight run. */
const race = <A, E>(init: Effect.Effect<A, E>) =>
	Effect.all([Effect.result(init), Effect.result(init)], { concurrency: "unbounded" });

describe("LockfileReader.read — a failed init is retried, concurrent callers share one", () => {
	const gate: Gate = { deny: true, calls: 0 };
	layer(gatedWorkspaces(gate, "/repo/pnpm-lock.yaml", undefined))((it) => {
		it.effect("first fails once for both racers, then the next call re-reads and succeeds", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const [first, second] = yield* race(reader.read());
				assert.strictEqual(first._tag, "Failure");
				assert.strictEqual(second._tag, "Failure");
				assert.strictEqual(gate.calls, 1, "two concurrent callers shared ONE in-flight init");
				// A bare `Effect.cached` would replay the failure here.
				gate.deny = false;
				const lockfile = yield* reader.read();
				assert.include(
					lockfile.packages.filter((pkg) => pkg.isWorkspace).map((pkg) => pkg.name),
					"@x/a",
				);
				assert.strictEqual(gate.calls, 2, "the failure expired at once, so the next call re-read");
				yield* reader.read();
				assert.strictEqual(gate.calls, 2, "a success is kept for good");
			}),
		);
	});
});

describe("WorkspaceDiscovery — a failed init is retried, concurrent callers share one", () => {
	const gate: Gate = { deny: true, calls: 0 };
	layer(gatedWorkspaces(gate, undefined, "/repo/packages"))((it) => {
		it.effect("the layer-bound listPackages: one shared failure, then a retried success", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const [first, second] = yield* race(discovery.listPackages());
				assert.strictEqual(first._tag, "Failure");
				assert.strictEqual(second._tag, "Failure");
				assert.strictEqual(gate.calls, 1, "two concurrent callers shared ONE in-flight discovery");
				gate.deny = false;
				const packages = yield* discovery.listPackages();
				assert.include(
					packages.map((pkg) => pkg.name),
					"@x/a",
				);
				assert.strictEqual(gate.calls, 2);
				yield* discovery.listPackages();
				assert.strictEqual(gate.calls, 2, "a success is kept for good");
			}),
		);

		it.effect("the per-root listPackagesIn cell is its own memo on the same discipline", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				// The layer-bound cell is a success now; the per-root cell for `/repo`
				// is separate and fresh, so a gated read is its first.
				gate.deny = true;
				const before = gate.calls;
				const [first, second] = yield* race(discovery.listPackagesIn("/repo/packages/a"));
				assert.strictEqual(first._tag, "Failure");
				assert.strictEqual(second._tag, "Failure");
				assert.strictEqual(gate.calls, before + 1, "two concurrent callers shared ONE in-flight discovery");
				gate.deny = false;
				const packages = yield* discovery.listPackagesIn("/repo/packages/a");
				assert.include(
					packages.map((pkg) => pkg.name),
					"@x/a",
				);
				assert.strictEqual(gate.calls, before + 2);
				yield* discovery.listPackagesIn("/repo");
				assert.strictEqual(gate.calls, before + 2, "two directories in one workspace share the kept success");
			}),
		);
	});
});

describe("WorkspaceCatalogs.set — a failed init is retried, concurrent callers share one", () => {
	const gate: Gate = { deny: true, calls: 0 };
	layer(gatedWorkspaces(gate, "/repo/pnpm-workspace.yaml", undefined))((it) => {
		it.effect("first fails once for both racers, then the next call re-assembles and succeeds", () =>
			Effect.gen(function* () {
				const catalogs = yield* WorkspaceCatalogs;
				const [first, second] = yield* race(catalogs.set());
				assert.strictEqual(first._tag, "Failure");
				assert.strictEqual(second._tag, "Failure");
				assert.strictEqual(gate.calls, 1, "two concurrent callers shared ONE in-flight assembly");
				gate.deny = false;
				const set = yield* catalogs.set();
				assert.deepStrictEqual(Object.keys(set.entries), ["default"]);
				assert.strictEqual(gate.calls, 2);
				yield* catalogs.set();
				assert.strictEqual(gate.calls, 2, "a success is kept for good");
			}),
		);
	});
});
