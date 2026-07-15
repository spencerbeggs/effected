import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ConfigDependencyHooks } from "../src/index.js";

// The hook-replay seam is inherently real-filesystem: the live layer dynamically
// `import()`s a `pnpmfile.cjs`. So this suite builds a temp workspace root with a
// real `node_modules/.pnpm-config/<name>/pnpmfile.cjs` (node_modules is
// gitignored, so it cannot be committed) by copying the committed fixture module,
// and points the config-dependency resolution at it.

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hook-pnpmfile.cjs");
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
			// `absent-dep` has no `.pnpm-config/absent-dep/pnpmfile.cjs`, so it is
			// skipped; the seed passes through unchanged.
			const result = yield* hooks.inject(root, { "absent-dep": "1.0.0" }, SEED);
			assert.deepStrictEqual(result, SEED);
		}).pipe(Effect.provide(ConfigDependencyHooks.layerLive)),
	);
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
