// package.json TEXT, read through `@effected/package-json`'s
// `PackageJsonFormat.parseObjectResult` at every site that used to hand-roll
// `JSON.parse` plus an object check, and the layer-bound cwd default that now
// flows through core `Path` instead of an ambient `process.cwd()`.
//
// Each site keeps its own vocabulary — a miss, a typed failure, or a skip — so
// these tests pin the per-site mapping, not the shared helper (which
// package-json's own suite covers).

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { PackageJsonSyntaxError } from "@effected/package-json";
import { Cause, ConfigProvider, Effect, Exit, Layer, Path } from "effect";
import { CatalogSet, WorkspaceRoot, WorkspaceRootNotFoundError } from "../src/index.js";
import { environmentStoreRoots } from "../src/internal/configDependencyResolution.js";
import { manifestVersion, messageOf } from "../src/internal/configDependencyShared.js";
import { findLayerRoot } from "../src/internal/layerRoot.js";

// ── WorkspaceRoot: a non-object root manifest is "not a root" ───────────────

describe("WorkspaceRoot.find — a package.json that is valid JSON but not an object", () => {
	// Before parseObjectResult, `null` parsed fine and `.workspaces` was read
	// off it: a TypeError DEFECT out of an effect typed as never-failing.
	for (const text of ["null", "42", '"x"']) {
		const tree = Layer.mergeAll(
			MemoryFileSystem.layerWith({ "/r/package.json": text, "/r/a/package.json": '{ "name": "a" }' }),
			Path.layer,
		);
		layer(WorkspaceRoot.layer.pipe(Layer.provide(tree)))(`root manifest ${text}`, (it) => {
			it.effect("fails WorkspaceRootNotFoundError, never a defect", () =>
				Effect.gen(function* () {
					const roots = yield* WorkspaceRoot;
					const exit = yield* Effect.exit(roots.find("/r/a", { stopAt: "/r" }));
					if (Exit.isSuccess(exit)) return assert.fail(`expected ${text} not to mark a root`);
					assert.isFalse(Cause.hasDies(exit.cause), "a non-object manifest must not die");
					const error = Cause.findErrorOption(exit.cause);
					assert.isTrue(error._tag === "Some" && error.value instanceof WorkspaceRootNotFoundError);
				}),
			);
		});
	}

	// Discriminating control: the same tree with an object carrying
	// `workspaces` IS a root, so the failures above are about the shape alone.
	const control = Layer.mergeAll(
		MemoryFileSystem.layerWith({
			"/r/package.json": '{ "workspaces": ["a"] }',
			"/r/a/package.json": '{ "name": "a" }',
		}),
		Path.layer,
	);
	layer(WorkspaceRoot.layer.pipe(Layer.provide(control)))("control", (it) => {
		it.effect("an object carrying workspaces marks the root", () =>
			Effect.gen(function* () {
				const roots = yield* WorkspaceRoot;
				assert.strictEqual(yield* roots.find("/r/a", { stopAt: "/r" }), "/r");
			}),
		);
	});
});

// ── the layer-bound cwd default ─────────────────────────────────────────────

describe("findLayerRoot — an omitted cwd", () => {
	it.effect('reaches WorkspaceRoot.find as ".", not an ambient absolute path', () =>
		Effect.gen(function* () {
			const seen: Array<string> = [];
			const root = yield* findLayerRoot(
				{
					find: (cwd) =>
						Effect.suspend(() => {
							seen.push(cwd);
							return Effect.succeed("/repo");
						}),
				},
				undefined,
			);
			assert.strictEqual(root, "/repo");
			assert.deepStrictEqual(seen, ["."]);
		}),
	);

	it.effect("passes an explicit cwd through unchanged", () =>
		Effect.gen(function* () {
			const seen: Array<string> = [];
			yield* findLayerRoot(
				{
					find: (cwd) =>
						Effect.suspend(() => {
							seen.push(cwd);
							return Effect.succeed("/repo");
						}),
				},
				{ cwd: "/repo/packages/a" },
			);
			assert.deepStrictEqual(seen, ["/repo/packages/a"]);
		}),
	);

	// The default is resolved by the live WorkspaceRoot through whatever Path it
	// was given: swap Path, and the default moves with it. Under the ambient
	// `process.cwd()` read this would resolve from the test runner's cwd and
	// find no `/repo` at all.
	const resolvingFromRepoPackage = Layer.effect(
		Path.Path,
		Effect.map(Path.Path, (real) => ({
			...real,
			resolve: (...segments: ReadonlyArray<string>) =>
				segments.length === 1 && segments[0] === "." ? "/repo/packages/a" : real.resolve(...segments),
		})),
	).pipe(Layer.provide(Path.layer));
	const live = WorkspaceRoot.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				MemoryFileSystem.layerWith({
					"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
					"/repo/packages/a/package.json": '{ "name": "a" }',
				}),
				resolvingFromRepoPackage,
			),
		),
	);
	layer(live)("through the injected Path", (it) => {
		it.effect('resolves "." with the Path the layer was built on', () =>
			Effect.gen(function* () {
				const roots = yield* WorkspaceRoot;
				assert.strictEqual(yield* findLayerRoot(roots, undefined), "/repo");
			}),
		);
	});

	layer(WorkspaceRoot.layerTest("/repo"))("the test double", (it) => {
		it.effect("reports a resolved searchPath for the default, like the live service", () =>
			Effect.gen(function* () {
				const roots = yield* WorkspaceRoot;
				const error = yield* Effect.flip(findLayerRoot(roots, { stopAt: "/elsewhere" }));
				assert.instanceOf(error, WorkspaceRootNotFoundError);
				assert.notStrictEqual(error.searchPath, ".");
				assert.isTrue(error.searchPath.startsWith("/"), error.searchPath);
			}),
		);
	});
});

// ── messages keep the JSON position ─────────────────────────────────────────

describe("CatalogSet.fromManifestWorkspaces — package.json syntax failures", () => {
	it.effect("invalid JSON fails CatalogAssemblyError whose message carries the JSON position", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(CatalogSet.fromManifestWorkspaces("{bad"));
			assert.strictEqual(error._tag, "CatalogAssemblyError");
			assert.instanceOf(error.cause, PackageJsonSyntaxError);
			assert.include(error.message, "Failed to assemble catalogs from manifest package.json");
			// The SyntaxError's own text, position included, survives the wrapper.
			assert.include(error.message, "position 1");
		}),
	);

	it.effect("valid JSON that is not an object fails, saying so", () =>
		Effect.gen(function* () {
			for (const text of ["null", "[]"]) {
				const error = yield* Effect.flip(CatalogSet.fromManifestWorkspaces(text));
				assert.include(error.message, "package.json text is not a JSON object", text);
			}
		}),
	);
});

// `manifestVersion` reads the real disk by design (config-dependency store
// copies are never virtual), so these cases use a scratch directory.
describe("manifestVersion — the version state of a config dependency's package.json", () => {
	const withManifest = <A, E>(text: string, use: (dir: string) => Effect.Effect<A, E>) =>
		Effect.acquireUseRelease(
			Effect.promise(async () => {
				const dir = await mkdtemp(join(tmpdir(), "manifest-version-"));
				await writeFile(join(dir, "package.json"), text);
				return dir;
			}),
			use,
			(dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
		);

	it.live("invalid JSON fails, and the fetch rung's spliced message keeps the JSON position", () =>
		withManifest("{bad", (dir) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(manifestVersion("cfg", dir));
				assert.strictEqual(error._tag, "CatalogAssemblyError");
				// configDependencyFetch splices exactly `messageOf(error.cause)`.
				assert.include(messageOf(error.cause), "position 1");
			}),
		),
	);

	it.live("valid JSON that is not an object is UNVERSIONED, not a failure", () =>
		Effect.gen(function* () {
			for (const text of ["null", "[]", "42"]) {
				const state = yield* withManifest(text, (dir) => manifestVersion("cfg", dir));
				assert.deepStrictEqual(state, { _tag: "unversioned" }, text);
			}
		}),
	);

	it.live("an object with a version carries it (control)", () =>
		withManifest('{ "version": "1.2.3" }', (dir) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* manifestVersion("cfg", dir), { _tag: "version", version: "1.2.3" });
			}),
		),
	);
});

// ── store discovery reads the environment through Config ────────────────────

describe("environmentStoreRoots", () => {
	const rootsUnder = (env: Record<string, string>, preserveEmptyStrings = false) =>
		environmentStoreRoots.pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env, preserveEmptyStrings }))),
		);

	it.effect("puts $PNPM_HOME/store first when PNPM_HOME is set", () =>
		Effect.gen(function* () {
			const roots = yield* rootsUnder({ PNPM_HOME: "/p" });
			assert.strictEqual(roots[0], join("/p", "store"));
		}),
	);

	it.effect("treats an empty PNPM_HOME as unset even under a provider that preserves empty strings", () =>
		Effect.gen(function* () {
			// preserveEmptyStrings makes the provider hand "" through as present, so
			// only envVar's own filter keeps it from becoming a cwd-relative store.
			const roots = yield* rootsUnder({ PNPM_HOME: "" }, true);
			assert.notInclude(roots, "store");
			assert.isTrue(
				roots.every((root) => root.startsWith("/") || /^[A-Za-z]:/.test(root)),
				roots.join(","),
			);
			// Control: the same provider with no PNPM_HOME gives the same roots.
			assert.deepStrictEqual(roots, yield* rootsUnder({}));
		}),
	);

	it.effect("adds $XDG_DATA_HOME/pnpm/store after PNPM_HOME", () =>
		Effect.gen(function* () {
			const roots = yield* rootsUnder({ PNPM_HOME: "/p", XDG_DATA_HOME: "/x" });
			assert.deepStrictEqual(roots.slice(0, 2), [join("/p", "store"), join("/x", "pnpm", "store")]);
		}),
	);
});
