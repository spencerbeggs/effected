import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { CatalogAssemblyError } from "@effected/npm";
import { Effect, Layer, Option } from "effect";
import { ConfigDependencyHooks, WorkspaceCatalogs, Workspaces } from "../../src/index.js";
import type { Tree } from "../fixtures.js";
import { manifest, platform } from "../fixtures.js";

// The hook-replay seam is inherently real-filesystem: the live layer dynamically
// `import()`s a `pnpmfile.cjs`, driving Node's module loader over disk fixtures.
// That makes this an INTEGRATION suite, not a virtual-FS unit test. It builds a
// temp workspace root with a real `node_modules/.pnpm-config/<name>/pnpmfile.cjs`
// (node_modules is gitignored, so it cannot be committed) by copying the
// committed fixture module, and points the config-dependency resolution at it.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const CJS_FIXTURE = join(FIXTURES, "hook-pnpmfile.cjs");
const MJS_FIXTURE = join(FIXTURES, "hook-pnpmfile.mjs");
const NESTED_MISSING_FIXTURE = join(FIXTURES, "hook-pnpmfile-nested-missing.mjs");
const AGE_4320_FIXTURE = join(FIXTURES, "hook-pnpmfile-age-4320.mjs");
const AGE_1440_FIXTURE = join(FIXTURES, "hook-pnpmfile-age-1440.mjs");
const AGE_GARBAGE_FIXTURE = join(FIXTURES, "hook-pnpmfile-age-garbage.mjs");

const DEP_NAME = "cfg-fixture";
// A config dependency shipping ONLY `pnpmfile.mjs` — the pnpm-11-native shape.
const MJS_DEP_NAME = "cfg-fixture-mjs";
// A config dependency directory that exists but ships NEITHER pnpmfile.
const NEITHER_DEP_NAME = "cfg-fixture-neither";
// A config dependency whose `pnpmfile.mjs` has a missing nested import.
const NESTED_DEP_NAME = "cfg-fixture-nested-missing";
// Config dependencies whose hooks set pnpm's release-age keys.
const AGE_4320_DEP_NAME = "cfg-fixture-age-4320";
const AGE_1440_DEP_NAME = "cfg-fixture-age-1440";
const AGE_GARBAGE_DEP_NAME = "cfg-fixture-age-garbage";
const SEED = { default: { effect: "^4.0.0" } } as const;

let root: string;

/** The `.pnpm-config/<name>` directory under the temp root. */
const configDepDir = (name: string): string => join(root, "node_modules", ".pnpm-config", name);

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "effected-hooks-"));
	// The legacy `.cjs`-only config dependency.
	const cjsDir = configDepDir(DEP_NAME);
	mkdirSync(cjsDir, { recursive: true });
	copyFileSync(CJS_FIXTURE, join(cjsDir, "pnpmfile.cjs"));
	// A pnpm-11-native config dependency shipping ONLY `pnpmfile.mjs`.
	const mjsDir = configDepDir(MJS_DEP_NAME);
	mkdirSync(mjsDir, { recursive: true });
	copyFileSync(MJS_FIXTURE, join(mjsDir, "pnpmfile.mjs"));
	// A config-dependency directory that exists but carries neither pnpmfile.
	mkdirSync(configDepDir(NEITHER_DEP_NAME), { recursive: true });
	// A config dependency whose `pnpmfile.mjs` imports a module that does not resolve.
	const nestedDir = configDepDir(NESTED_DEP_NAME);
	mkdirSync(nestedDir, { recursive: true });
	copyFileSync(NESTED_MISSING_FIXTURE, join(nestedDir, "pnpmfile.mjs"));
	// Config dependencies whose hooks set pnpm's release-age keys.
	const age4320Dir = configDepDir(AGE_4320_DEP_NAME);
	mkdirSync(age4320Dir, { recursive: true });
	copyFileSync(AGE_4320_FIXTURE, join(age4320Dir, "pnpmfile.mjs"));
	const age1440Dir = configDepDir(AGE_1440_DEP_NAME);
	mkdirSync(age1440Dir, { recursive: true });
	copyFileSync(AGE_1440_FIXTURE, join(age1440Dir, "pnpmfile.mjs"));
	const ageGarbageDir = configDepDir(AGE_GARBAGE_DEP_NAME);
	mkdirSync(ageGarbageDir, { recursive: true });
	copyFileSync(AGE_GARBAGE_FIXTURE, join(ageGarbageDir, "pnpmfile.mjs"));
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
			assert.strictEqual(result.catalogs.default?.["hooked-dep"], "^9.9.9");
			assert.strictEqual(result.catalogs.default?.effect, "^4.0.0");
			assert.strictEqual(result.catalogs.extra?.["extra-dep"], "^1.2.3");
			// This fixture sets no release-age keys, so it contributes an empty gate.
			assert.deepStrictEqual(result.releaseAge, {});
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
			// `absent-dep` has no `.pnpm-config/absent-dep/` directory at all, so both
			// the `.mjs` and `.cjs` candidate imports fail ERR_MODULE_NOT_FOUND for the
			// candidate itself and it is skipped; the seed passes through unchanged.
			const result = yield* hooks.inject(root, { "absent-dep": "1.0.0" }, SEED);
			assert.deepStrictEqual(result, { catalogs: SEED, releaseAge: {} });
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);
});

describe("ConfigDependencyHooks.layerLive — pnpm 11 .mjs pnpmfile and load discrimination", () => {
	it.effect("an .mjs-only config dependency replays its hook — proving .mjs is loaded", () => {
		const markerPath = join(root, "mjs-marker.txt");
		process.env.HOOK_MARKER = markerPath;
		return Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// The dep ships ONLY `pnpmfile.mjs`. The seam tries `.mjs` first, loads it,
			// and replays it — the DISTINCT `mjs-dep` / `mjsExtra` entries prove it was
			// the `.mjs` (there is no `.cjs` to have loaded), and the seed survived.
			const result = yield* hooks.inject(root, { [MJS_DEP_NAME]: "1.0.0" }, SEED);
			assert.strictEqual(result.catalogs.default?.["mjs-dep"], "^2.0.0");
			assert.strictEqual(result.catalogs.default?.effect, "^4.0.0");
			assert.strictEqual(result.catalogs.mjsExtra?.["mjs-extra-dep"], "^3.4.5");
			// The side-effect marker proves the `.mjs` fixture actually executed.
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

	it.effect("a config-dependency directory with neither pnpmfile.mjs nor pnpmfile.cjs is skipped, not a failure", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// The directory exists but carries neither candidate, so both imports fail
			// ERR_MODULE_NOT_FOUND for the candidate itself — the legitimate skip.
			const result = yield* hooks.inject(root, { [NEITHER_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result, { catalogs: SEED, releaseAge: {} });
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);

	it.effect("a pnpmfile whose OWN nested import is missing fails typed, never silently skipped", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// `pnpmfile.mjs` exists but statically imports a module that does not
			// resolve. That raises ERR_MODULE_NOT_FOUND for the NESTED module (err.url
			// differs from the candidate pnpmfile URL), so it must surface typed — the
			// exact case a broad "ERR_MODULE_NOT_FOUND ⇒ no pnpmfile" skip would swallow.
			const error = yield* Effect.flip(hooks.inject(root, { [NESTED_DEP_NAME]: "1.0.0" }, SEED));
			assert.instanceOf(error, CatalogAssemblyError);
			assert.strictEqual(error.source, "hooks");
			assert.strictEqual(error.path, NESTED_DEP_NAME);
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
			assert.deepStrictEqual(result, { catalogs: SEED, releaseAge: {} });
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
			assert.deepStrictEqual(result, { catalogs: SEED, releaseAge: {} });
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

	it.effect("contributes an empty release-age gate — the no-op runs no hooks", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// Declaring the age-setting config dependency changes nothing under the
			// no-op: it runs no hooks, so it contributes no release-age keys.
			const result = yield* hooks.inject(root, { [AGE_4320_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result.releaseAge, {});
		}).pipe(Effect.provide(ConfigDependencyHooks.layerNoop)),
	);
});

describe("ConfigDependencyHooks.layerLive — surfaces the release-age keys hooks set", () => {
	it.effect("a hook's numeric minimumReleaseAge and array exclude become the gate contribution", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// The `age-1440` fixture sets `minimumReleaseAge: 1440` and
			// `minimumReleaseAgeExclude: ["@scope/b"]`; both must survive to `releaseAge`
			// (mapped onto `ageMinutes` / `exclude`), and the catalog seed is unchanged.
			const result = yield* hooks.inject(root, { [AGE_1440_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result.releaseAge, { ageMinutes: 1440, exclude: ["@scope/b"] });
			assert.deepStrictEqual(result.catalogs, SEED);
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);

	it.effect("a later hook rewrites an earlier hook's release-age value — last-wins, not max", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// Two config deps replayed IN ORDER: `age-4320` (4320) THEN `age-1440`
			// (1440). Threading is last-wins over one config object exactly as pnpm
			// replays — so the LATER, LOWER 1440 wins. A strictest-wins merge WITHIN the
			// replay would have kept 4320, so 1440 is the discriminating result. The
			// exclude is last-wins too (`@scope/b`, not `@scope/a`).
			const result = yield* hooks.inject(root, { [AGE_4320_DEP_NAME]: "1.0.0", [AGE_1440_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result.releaseAge, { ageMinutes: 1440, exclude: ["@scope/b"] });
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);

	it.effect("a hook returning garbage release-age values drops them — tolerant, never a typed failure", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// The `age-garbage` fixture returns a non-numeric age and a non-array
			// exclude. A hook's returned DATA is read tolerantly (only a load/replay
			// mechanism failure is typed), so both are dropped: an empty contribution.
			const result = yield* hooks.inject(root, { [AGE_GARBAGE_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result.releaseAge, {});
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);
});

describe("WorkspaceCatalogs.releaseAgeGate — combines inline + hook sources strictest-wins", () => {
	// The virtual tree is keyed to the REAL temp root: the effect-FileSystem read of
	// pnpm-workspace.yaml is virtual, while layerLive's node:fs read of the config
	// dependency's real pnpmfile hits disk under the same root — the same split the
	// default-layer test above relies on.
	const treeWith = (inlineAge: number, inlineExclude: readonly string[], dep: string): Tree => ({
		[`${root}/pnpm-workspace.yaml`]: [
			"packages:",
			"  - packages/*",
			`minimumReleaseAge: ${inlineAge}`,
			// Emit the exclude block only when non-empty — a bare `key:` line yields a
			// null value pnpm treats as no excludes.
			...(inlineExclude.length > 0
				? ["minimumReleaseAgeExclude:", ...inlineExclude.map((pattern) => `  - "${pattern}"`)]
				: []),
			"configDependencies:",
			`  ${dep}: '1.0.0'`,
			"",
		].join("\n"),
		[`${root}/package.json`]: JSON.stringify({ name: "root", version: "0.0.0", private: true }),
		[`${root}/packages/a/package.json`]: manifest("@x/a"),
	});

	it.effect("the hook's stricter age wins and excludes union", () => {
		const tree = treeWith(1440, ["inline-excl"], AGE_4320_DEP_NAME);
		const appLayer = Workspaces.layerWithConfigDependencies({ cwd: root }).pipe(Layer.provideMerge(platform(tree)));
		return Effect.gen(function* () {
			const catalogs = yield* WorkspaceCatalogs;
			const gate = yield* catalogs.releaseAgeGate();
			// Inline 1440 vs hook 4320 → max is the hook's 4320.
			assert.strictEqual(gate.ageMinutes, 4320);
			// Excludes union: the inline pattern plus the hook's two, deduped.
			assert.deepStrictEqual([...gate.exclude].sort(), ["@scope/a", "inline-excl", "typescript"]);
		}).pipe(Effect.provide(appLayer));
	});

	it.effect("the inline stricter age wins", () => {
		const tree = treeWith(10_000, [], AGE_1440_DEP_NAME);
		const appLayer = Workspaces.layerWithConfigDependencies({ cwd: root }).pipe(Layer.provideMerge(platform(tree)));
		return Effect.gen(function* () {
			const catalogs = yield* WorkspaceCatalogs;
			const gate = yield* catalogs.releaseAgeGate();
			// Inline 10000 vs hook 1440 → max is the inline 10000.
			assert.strictEqual(gate.ageMinutes, 10_000);
			// Only the hook set an exclude here.
			assert.deepStrictEqual([...gate.exclude], ["@scope/b"]);
		}).pipe(Effect.provide(appLayer));
	});
});
