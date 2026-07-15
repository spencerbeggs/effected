import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { CatalogAssemblyError, ConfigDependencyHooks, WorkspaceCatalogs, Workspaces } from "../../src/index.js";
import type { Tree } from "../fixtures.js";
import { manifest, platform } from "../fixtures.js";

// The hook-replay seam is inherently real-filesystem: the live layer dynamically
// `import()`s a `pnpmfile.cjs`, driving Node's module loader over disk fixtures.
// That makes this an INTEGRATION suite, not a virtual-FS unit test. It builds a
// temp workspace root with a real `node_modules/.pnpm-config/<name>/pnpmfile.cjs`
// (node_modules is gitignored, so it cannot be committed) by copying the
// committed fixture module, and points the config-dependency resolution at it.

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "hook-pnpmfile.cjs");
const DEP_NAME = "cfg-fixture";
const SEED = { default: { effect: "^4.0.0" } } as const;

let root: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "effected-hooks-"));
	const depDir = join(root, "node_modules", ".pnpm-config", DEP_NAME);
	mkdirSync(depDir, { recursive: true });
	copyFileSync(FIXTURE, join(depDir, "pnpmfile.cjs"));
});

afterAll(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

describe("ConfigDependencyHooks.layerLive — replays the pnpmfile", () => {
	it.effect("loads the config dependency's updateConfig and injects its catalogs", () => {
		const markerPath = join(root, "live-marker.txt");
		process.env.HOOK_MARKER = markerPath;
		return Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const result = yield* hooks.inject(root, { [DEP_NAME]: "1.0.0" }, SEED);
			// The hook injected into the default catalog and a named one, and the seed
			// survived.
			assert.strictEqual(result.default?.["hooked-dep"], "^9.9.9");
			assert.strictEqual(result.default?.effect, "^4.0.0");
			assert.strictEqual(result.extra?.["extra-dep"], "^1.2.3");
			// The side-effect marker proves the fixture actually executed.
			assert.isTrue(existsSync(markerPath));
		}).pipe(
			Effect.provide(ConfigDependencyHooks.layerLive),
			Effect.ensuring(
				Effect.sync(() => {
					delete process.env.HOOK_MARKER;
				}),
			),
		);
	});

	it.effect("a config dependency with no pnpmfile contributes nothing, not a failure", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// `absent-dep` has no `.pnpm-config/absent-dep/pnpmfile.cjs`, so the import
			// fails ERR_MODULE_NOT_FOUND and it is skipped; the seed passes through unchanged.
			const result = yield* hooks.inject(root, { "absent-dep": "1.0.0" }, SEED);
			assert.deepStrictEqual(result, SEED);
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);
});

describe("ConfigDependencyHooks.layerLive — rejects a traversal name before import()", () => {
	it.effect("a config dependency name with a '..' segment fails typed, never escaping .pnpm-config", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// `../../evil` would `import()` a path OUTSIDE `.pnpm-config`. The guard
			// rejects it typed, on the `hooks` source, before any path is built.
			const error = yield* Effect.flip(hooks.inject(root, { "../../evil": "1.0.0" }, SEED));
			assert.instanceOf(error, CatalogAssemblyError);
			assert.strictEqual(error.source, "hooks");
			assert.strictEqual(error.path, "../../evil");
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);

	it.effect("a scoped name (a legitimate '/') is NOT rejected — only '..' segments are", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// `@scope/pkg` contains a `/` but no `..`; it resolves inside `.pnpm-config`,
			// finds no pnpmfile, and contributes nothing — the seed passes through.
			const result = yield* hooks.inject(root, { "@scope/pkg": "1.0.0" }, SEED);
			assert.deepStrictEqual(result, SEED);
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);
});

describe("Workspaces.layer default — provably never executes a config dependency's pnpmfile", () => {
	it.effect("set() succeeds and the real pnpmfile marker is never written under the DEFAULT layer", () => {
		// A pnpm-workspace.yaml declaring a configDependencies entry whose REAL
		// pnpmfile.cjs exists on disk (copied under root in beforeAll). The default
		// Workspaces.layer wires ConfigDependencyHooks.layerNoop, so assembly must
		// NEVER import that pnpmfile. Switch the default composite to layerLive and
		// the marker appears — this is the discriminating test that lack of one let
		// the default silently regress.
		const markerPath = join(root, "default-layer-marker.txt");
		process.env.HOOK_MARKER = markerPath;
		// The virtual tree is keyed to the REAL temp root, so the effect-FileSystem
		// read of pnpm-workspace.yaml is virtual while layerLive's node:fs read of
		// the pnpmfile (were it wired) would hit the real file under the same root.
		const tree: Tree = {
			[`${root}/pnpm-workspace.yaml`]: [
				"packages:",
				"  - packages/*",
				"catalog:",
				"  effect: ^4.0.0",
				"configDependencies:",
				`  ${DEP_NAME}: '1.0.0'`,
				"",
			].join("\n"),
			[`${root}/package.json`]: JSON.stringify({ name: "root", version: "0.0.0", private: true }),
			[`${root}/packages/a/package.json`]: manifest("@x/a", { dependencies: { effect: "catalog:" } }),
		};
		const defaultLayer = Workspaces.layer({ cwd: root }).pipe(Layer.provideMerge(platform(tree)));
		return Effect.gen(function* () {
			const catalogs = yield* WorkspaceCatalogs;
			const set = yield* catalogs.set();
			// The inline catalog assembled — proof the default catalog path actually ran.
			assert.deepStrictEqual(set.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
			// ...and the config dependency's real pnpmfile never executed.
			assert.isFalse(existsSync(markerPath));
		}).pipe(
			Effect.provide(defaultLayer),
			Effect.ensuring(
				Effect.sync(() => {
					delete process.env.HOOK_MARKER;
				}),
			),
		);
	});
});

describe("ConfigDependencyHooks.layerNoop — provably never loads the pnpmfile", () => {
	it.effect("returns the seed untouched and executes no config-dependency code", () => {
		// A marker path the fixture WOULD write if it ran. Under the no-op it must
		// stay absent — proving the default catalog path never loads the pnpmfile.
		const markerPath = join(root, "noop-marker.txt");
		process.env.HOOK_MARKER = markerPath;
		return Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const result = yield* hooks.inject(root, { [DEP_NAME]: "1.0.0" }, SEED);
			// Same root and same declared config dependency as the live test — the ONLY
			// difference is the layer. The seed is unchanged and the fixture never ran.
			assert.deepStrictEqual(result, SEED);
			assert.isFalse(existsSync(markerPath));
		}).pipe(
			Effect.provide(ConfigDependencyHooks.layerNoop),
			Effect.ensuring(
				Effect.sync(() => {
					delete process.env.HOOK_MARKER;
				}),
			),
		);
	});
});
