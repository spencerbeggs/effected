// `ConfigDependencyHooks.layerSubprocess` against a real `node` child process.
//
// The subprocess replay exists because a bundler compiles layerLive's computed
// dynamic `import()` into a context module that cannot resolve at runtime; the
// child performs the computed imports where no bundler rewrote them. This suite
// drives the REAL protocol end to end — real spawner, real fixtures on disk —
// and pins that the subprocess layer's typed semantics match layerLive's
// exactly, so the two are drop-in interchangeable.
//
// The parent-side plumbing (argv contract, no-spawn fast paths, transport
// failure mapping) is unit-tested with a scripted spawner in
// `../ConfigDependencyHooksSubprocess.test.ts`.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { CatalogAssemblyError } from "@effected/npm";
import { Effect, Layer } from "effect";
import { ConfigDependencyHooks, WorkspaceCatalogs, Workspaces } from "../../src/index.js";
import type { Tree } from "../fixtures.js";
import { manifest, platform } from "../fixtures.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const CJS_FIXTURE = join(FIXTURES, "hook-pnpmfile.cjs");
const MJS_FIXTURE = join(FIXTURES, "hook-pnpmfile.mjs");
const NESTED_MISSING_FIXTURE = join(FIXTURES, "hook-pnpmfile-nested-missing.mjs");
const AGE_4320_FIXTURE = join(FIXTURES, "hook-pnpmfile-age-4320.mjs");
const AGE_1440_FIXTURE = join(FIXTURES, "hook-pnpmfile-age-1440.mjs");

const DEP_NAME = "cfg-fixture";
// A config dependency shipping BOTH pnpmfiles — the precedence probe.
const BOTH_DEP_NAME = "cfg-fixture-both";
// A config dependency directory that exists but ships NEITHER pnpmfile.
const NEITHER_DEP_NAME = "cfg-fixture-neither";
// A config dependency whose `pnpmfile.mjs` has a missing nested import.
const NESTED_DEP_NAME = "cfg-fixture-nested-missing";
// A config dependency whose `pnpmfile.mjs` does not parse.
const SYNTAX_DEP_NAME = "cfg-fixture-syntax-error";
// A config dependency whose hook throws when CALLED.
const THROWING_DEP_NAME = "cfg-fixture-throwing";
// A config dependency whose hook returns a MALFORMED value for every key.
const MALFORMED_DEP_NAME = "cfg-fixture-malformed";
const AGE_4320_DEP_NAME = "cfg-fixture-age-4320";
const AGE_1440_DEP_NAME = "cfg-fixture-age-1440";
const SEED = { default: { effect: "^4.0.0" } } as const;

let root: string;

/** The `.pnpm-config/<name>` directory under the temp root. */
const configDepDir = (name: string): string => join(root, "node_modules", ".pnpm-config", name);

// The real spawner over the real filesystem — the only platform surface the
// subprocess layer needs.
const Spawner = NodeChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));
const HooksSubprocess = ConfigDependencyHooks.layerSubprocess.pipe(Layer.provide(Spawner));

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "effected-hooks-subprocess-"));
	// The legacy `.cjs`-only config dependency.
	const cjsDir = configDepDir(DEP_NAME);
	mkdirSync(cjsDir, { recursive: true });
	copyFileSync(CJS_FIXTURE, join(cjsDir, "pnpmfile.cjs"));
	// BOTH files present: the `.mjs` injects DISTINCT entries from the `.cjs`, so
	// the injected names prove which file was loaded.
	const bothDir = configDepDir(BOTH_DEP_NAME);
	mkdirSync(bothDir, { recursive: true });
	copyFileSync(MJS_FIXTURE, join(bothDir, "pnpmfile.mjs"));
	copyFileSync(CJS_FIXTURE, join(bothDir, "pnpmfile.cjs"));
	// A config-dependency directory that exists but carries neither pnpmfile.
	mkdirSync(configDepDir(NEITHER_DEP_NAME), { recursive: true });
	// A config dependency whose `pnpmfile.mjs` imports a module that does not resolve.
	const nestedDir = configDepDir(NESTED_DEP_NAME);
	mkdirSync(nestedDir, { recursive: true });
	copyFileSync(NESTED_MISSING_FIXTURE, join(nestedDir, "pnpmfile.mjs"));
	// A pnpmfile that does not PARSE — a real load failure, not an absent file.
	// Written inline rather than committed: a syntax-error fixture would trip the
	// repo's own lint gates.
	const syntaxDir = configDepDir(SYNTAX_DEP_NAME);
	mkdirSync(syntaxDir, { recursive: true });
	writeFileSync(join(syntaxDir, "pnpmfile.mjs"), "export const hooks = {\n");
	// A pnpmfile that loads fine but whose hook THROWS when called.
	const throwingDir = configDepDir(THROWING_DEP_NAME);
	mkdirSync(throwingDir, { recursive: true });
	writeFileSync(
		join(throwingDir, "pnpmfile.mjs"),
		'export const hooks = {\n\tupdateConfig() {\n\t\tthrow new Error("hook exploded");\n\t},\n};\n',
	);
	// A pnpmfile whose hook returns garbage for EVERY config key — the bad slice
	// both layers must thread tolerantly, and identically.
	const malformedDir = configDepDir(MALFORMED_DEP_NAME);
	mkdirSync(malformedDir, { recursive: true });
	writeFileSync(
		join(malformedDir, "pnpmfile.mjs"),
		'export const hooks = {\n\tupdateConfig() {\n\t\treturn { catalog: 42, catalogs: ["nope"], minimumReleaseAge: "soon", minimumReleaseAgeExclude: "nope" };\n\t},\n};\n',
	);
	// Config dependencies whose hooks set pnpm's release-age keys.
	const age4320Dir = configDepDir(AGE_4320_DEP_NAME);
	mkdirSync(age4320Dir, { recursive: true });
	copyFileSync(AGE_4320_FIXTURE, join(age4320Dir, "pnpmfile.mjs"));
	const age1440Dir = configDepDir(AGE_1440_DEP_NAME);
	mkdirSync(age1440Dir, { recursive: true });
	copyFileSync(AGE_1440_FIXTURE, join(age1440Dir, "pnpmfile.mjs"));
});

afterAll(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

describe("ConfigDependencyHooks.layerSubprocess — replays the pnpmfile in a child process", () => {
	it.effect("loads the config dependency's updateConfig and injects its catalogs", () => {
		const markerPath = join(root, "subprocess-marker.txt");
		process.env.HOOK_MARKER = markerPath;
		return Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const result = yield* hooks.inject(root, { [DEP_NAME]: "1.0.0" }, SEED);
			// The hook injected into the default catalog and a named one, and the seed
			// survived — identical to the layerLive assertions.
			assert.strictEqual(result.catalogs.default?.["hooked-dep"], "^9.9.9");
			assert.strictEqual(result.catalogs.default?.effect, "^4.0.0");
			assert.strictEqual(result.catalogs.extra?.["extra-dep"], "^1.2.3");
			assert.deepStrictEqual(result.releaseAge, {});
			// The marker proves the fixture executed — in the CHILD, which inherits
			// the environment.
			assert.isTrue(existsSync(markerPath));
		}).pipe(
			Effect.provide(HooksSubprocess),
			Effect.ensuring(
				Effect.sync(() => {
					delete process.env.HOOK_MARKER;
				}),
			),
		);
	});

	it.effect("surfaces the release-age keys a hook sets", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const result = yield* hooks.inject(root, { [AGE_1440_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result.releaseAge, { ageMinutes: 1440, exclude: ["@scope/b"] });
			assert.deepStrictEqual(result.catalogs, SEED);
		}).pipe(Effect.provide(HooksSubprocess)),
	);

	it.effect("threads release-age keys last-hook-wins over ONE config object, in declaration order", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// `age-4320` (4320) THEN `age-1440` (1440): the LATER, LOWER 1440 wins —
			// last-wins threading, not a strictest-wins merge inside the replay.
			const result = yield* hooks.inject(root, { [AGE_4320_DEP_NAME]: "1.0.0", [AGE_1440_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result.releaseAge, { ageMinutes: 1440, exclude: ["@scope/b"] });
		}).pipe(Effect.provide(HooksSubprocess)),
	);
});

describe("ConfigDependencyHooks.layerSubprocess — pnpm 11 loader order and skip discrimination", () => {
	it.effect("tries pnpmfile.mjs FIRST when both files exist — the .cjs is never loaded", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const result = yield* hooks.inject(root, { [BOTH_DEP_NAME]: "1.0.0" }, SEED);
			// The `.mjs` fixture's DISTINCT entries prove precedence: its injections
			// are present and the sibling `.cjs` fixture's are absent.
			assert.strictEqual(result.catalogs.default?.["mjs-dep"], "^2.0.0");
			assert.strictEqual(result.catalogs.mjsExtra?.["mjs-extra-dep"], "^3.4.5");
			assert.isUndefined(result.catalogs.default?.["hooked-dep"]);
			assert.isUndefined(result.catalogs.extra);
		}).pipe(Effect.provide(HooksSubprocess)),
	);

	it.effect("a config dependency with no pnpmfile contributes nothing, not a failure", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// `absent-dep` has no `.pnpm-config/absent-dep/` directory at all;
			// `cfg-fixture-neither` exists but ships neither candidate. Both are the
			// legitimate skip: ERR_MODULE_NOT_FOUND for the candidate itself.
			const result = yield* hooks.inject(root, { "absent-dep": "1.0.0", [NEITHER_DEP_NAME]: "1.0.0" }, SEED);
			assert.deepStrictEqual(result, {
				catalogs: SEED,
				releaseAge: {},
				peerDependencyRules: { allowedVersions: {}, ignoreMissing: [], allowAny: [] },
			});
		}).pipe(Effect.provide(HooksSubprocess)),
	);

	it.effect("a pnpmfile whose OWN nested import is missing fails typed, never silently skipped", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			// ERR_MODULE_NOT_FOUND for the NESTED module: err.url differs from the
			// candidate URL, so the child must surface it typed — the case a broad
			// "ERR_MODULE_NOT_FOUND ⇒ no pnpmfile" skip would swallow.
			const error = yield* Effect.flip(hooks.inject(root, { [NESTED_DEP_NAME]: "1.0.0" }, SEED));
			assert.instanceOf(error, CatalogAssemblyError);
			assert.strictEqual(error.source, "hooks");
			assert.strictEqual(error.path, NESTED_DEP_NAME);
		}).pipe(Effect.provide(HooksSubprocess)),
	);
});

describe("ConfigDependencyHooks.layerSubprocess — load/replay failures name the dependency", () => {
	it.effect("a pnpmfile with a syntax error fails typed, naming that dependency", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const error = yield* Effect.flip(hooks.inject(root, { [SYNTAX_DEP_NAME]: "1.0.0" }, SEED));
			assert.instanceOf(error, CatalogAssemblyError);
			assert.strictEqual(error.source, "hooks");
			assert.strictEqual(error.path, SYNTAX_DEP_NAME);
		}).pipe(Effect.provide(HooksSubprocess)),
	);

	it.effect("a hook that throws when called fails typed, naming that dependency", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const error = yield* Effect.flip(hooks.inject(root, { [THROWING_DEP_NAME]: "1.0.0" }, SEED));
			assert.instanceOf(error, CatalogAssemblyError);
			assert.strictEqual(error.source, "hooks");
			assert.strictEqual(error.path, THROWING_DEP_NAME);
			// The child-side failure detail crossed the process boundary.
			assert.include(String((error.cause as Error).message), "hook exploded");
		}).pipe(Effect.provide(HooksSubprocess)),
	);

	it.effect("a config dependency name with a '..' segment fails typed", () =>
		Effect.gen(function* () {
			const hooks = yield* ConfigDependencyHooks;
			const error = yield* Effect.flip(hooks.inject(root, { "../../evil": "1.0.0" }, SEED));
			assert.instanceOf(error, CatalogAssemblyError);
			assert.strictEqual(error.source, "hooks");
			assert.strictEqual(error.path, "../../evil");
		}).pipe(Effect.provide(HooksSubprocess)),
	);
});

describe("ConfigDependencyHooks.layerSubprocess — drop-in interchangeable with layerLive", () => {
	it.effect("the two layers produce identical HookInjections for the same root and dependencies", () => {
		// The malformed hook sits BETWEEN two well-formed ones: both layers must
		// thread its garbage tolerantly (each key falls back to the PRIOR threaded
		// value, not the seed), through their separate configOf/finiteNumberOr/
		// stringArrayOr copies — the same bad slice exercised on both sides.
		const deps = { [DEP_NAME]: "1.0.0", [MALFORMED_DEP_NAME]: "1.0.0", [AGE_1440_DEP_NAME]: "1.0.0" };
		const run = (layer: Layer.Layer<ConfigDependencyHooks>) =>
			Effect.gen(function* () {
				const hooks = yield* ConfigDependencyHooks;
				return yield* hooks.inject(root, deps, SEED);
			}).pipe(Effect.provide(layer));
		return Effect.gen(function* () {
			const inProcess = yield* run(ConfigDependencyHooks.layerLive);
			const subprocess = yield* run(HooksSubprocess);
			assert.deepStrictEqual(subprocess, inProcess);
			// The parity is over a WELL-FORMED outcome, not shared garbage: the
			// first hook's catalog injections survived the malformed rewrite …
			assert.strictEqual(subprocess.catalogs.default?.["hooked-dep"], "^9.9.9");
			assert.strictEqual(subprocess.catalogs.extra?.["extra-dep"], "^1.2.3");
			// … and the LAST hook's release-age keys landed on the threaded object.
			assert.deepStrictEqual(subprocess.releaseAge, { ageMinutes: 1440, exclude: ["@scope/b"] });
		});
	});
});

describe("Workspaces.layerWithConfigDependenciesSubprocess — releaseAgeGate reaches the hooks", () => {
	it.effect("combines inline + subprocess-replayed hook sources strictest-wins", () => {
		// The virtual tree is keyed to the REAL temp root: the effect-FileSystem
		// read of pnpm-workspace.yaml is virtual, while the child process reads the
		// config dependency's real pnpmfile from disk under the same root — the
		// same split the layerLive composite tests rely on.
		const tree: Tree = {
			[`${root}/pnpm-workspace.yaml`]: [
				"packages:",
				"  - packages/*",
				"catalog:",
				"  effect: ^4.0.0",
				"minimumReleaseAge: 720",
				"configDependencies:",
				`  ${AGE_1440_DEP_NAME}: '1.0.0'`,
				"",
			].join("\n"),
			[`${root}/package.json`]: JSON.stringify({ name: "root", version: "0.0.0", private: true }),
			[`${root}/packages/a/package.json`]: manifest("@x/a"),
		};
		const appLayer = Workspaces.layerWithConfigDependenciesSubprocess({ cwd: root }).pipe(
			Layer.provide(Spawner),
			Layer.provideMerge(platform(tree)),
		);
		return Effect.gen(function* () {
			const catalogs = yield* WorkspaceCatalogs;
			const gate = yield* catalogs.releaseAgeGate();
			// Inline 720 vs the hook's 1440 → strictest (max) wins: 1440.
			assert.strictEqual(gate.ageMinutes, 1440);
			assert.deepStrictEqual([...gate.exclude], ["@scope/b"]);
			// The inline catalog still assembled through the same pass.
			const set = yield* catalogs.set();
			assert.strictEqual(set.entries.default?.effect, "^4.0.0");
		}).pipe(Effect.provide(appLayer));
	});
});
