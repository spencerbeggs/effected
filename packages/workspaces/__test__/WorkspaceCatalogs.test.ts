import { assert, describe, it, layer } from "@effect/vitest";
import { CatalogResolver, WorkspaceResolver } from "@effected/npm";
import { Effect, Layer, Option } from "effect";
import {
	CatalogAssemblyError,
	CatalogSet,
	LockfileReader,
	PackageManagerDetector,
	WorkspaceCatalogs,
	WorkspaceDiscovery,
	WorkspaceRoot,
	Workspaces,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform } from "./fixtures.js";

/** The full workspaces stack over a virtual tree, rooted at `/repo`. */
const workspacesOver = (tree: Tree) => {
	const base = platform(tree);
	return Workspaces.layer({ cwd: "/repo" }).pipe(Layer.provideMerge(base));
};

// ── CatalogSet as a pure value ─────────────────────────────────────────────

describe("CatalogSet", () => {
	it("empty has no catalogs", () => {
		assert.isTrue(CatalogSet.empty().isEmpty);
	});

	it("normalizes pnpm's unnamed top-level catalog under 'default'", () =>
		Effect.runSync(
			Effect.gen(function* () {
				const set = yield* CatalogSet.fromWorkspaceYaml("catalog:\n  effect: ^4.0.0\n");
				assert.deepStrictEqual(Object.keys(set.entries), ["default"]);
				assert.deepStrictEqual(set.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
			}),
		));

	it("reads named catalogs", () =>
		Effect.runSync(
			Effect.gen(function* () {
				const set = yield* CatalogSet.fromWorkspaceYaml(
					"catalogs:\n  build:\n    typescript: ^6.0.0\n  test:\n    vitest: ^3.0.0\n",
				);
				assert.deepStrictEqual(Object.keys(set.entries).sort(), ["build", "test"]);
				// The SECOND named catalog — a bug that keeps only the first passes on `build`.
				assert.deepStrictEqual(set.rangeOf("vitest", Option.some("test")), Option.some("^3.0.0"));
				assert.deepStrictEqual(set.rangeOf("typescript", Option.some("build")), Option.some("^6.0.0"));
			}),
		));

	it("rangeOf is none for an unknown dependency and for an unknown catalog", () =>
		Effect.runSync(
			Effect.gen(function* () {
				const set = yield* CatalogSet.fromWorkspaceYaml("catalog:\n  effect: ^4.0.0\n");
				assert.deepStrictEqual(set.rangeOf("react", Option.none()), Option.none());
				assert.deepStrictEqual(set.rangeOf("effect", Option.some("nope")), Option.none());
			}),
		));

	it("resolveSpecifier resolves a catalog: protocol reference", () =>
		Effect.runSync(
			Effect.gen(function* () {
				const set = yield* CatalogSet.fromWorkspaceYaml(
					"catalog:\n  effect: ^4.0.0\ncatalogs:\n  build:\n    effect: ^3.0.0\n",
				);
				assert.deepStrictEqual(set.resolveSpecifier("effect", "catalog:"), Option.some("^4.0.0"));
				assert.deepStrictEqual(set.resolveSpecifier("effect", "catalog:build"), Option.some("^3.0.0"));
			}),
		));

	it("resolveSpecifier is none for a plain, non-catalog specifier", () =>
		Effect.runSync(
			Effect.gen(function* () {
				const set = yield* CatalogSet.fromWorkspaceYaml("catalog:\n  effect: ^4.0.0\n");
				assert.deepStrictEqual(set.resolveSpecifier("effect", "^4.0.0"), Option.none());
			}),
		));

	it.effect("malformed YAML fails typed, never as a defect", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(CatalogSet.fromWorkspaceYaml("catalog:\n\t- ["));
			assert.strictEqual(result._tag, "Failure");
			const error = yield* Effect.flip(CatalogSet.fromWorkspaceYaml("catalog:\n\t- ["));
			assert.instanceOf(error, CatalogAssemblyError);
			assert.strictEqual(error.source, "manifest");
		}),
	);

	it("fromLockfileCatalogs unwraps the { specifier, version } lockfile shape", () => {
		const set = CatalogSet.fromLockfileCatalogs({
			default: { effect: { specifier: "^4.0.0", version: "4.0.0-beta.97" } },
		});
		// The SPECIFIER is the declared range, which is what a catalog resolves to;
		// taking `version` would silently pin every consumer to an exact build.
		assert.deepStrictEqual(set.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
	});

	it("merge lets a later set win per dependency", () => {
		const older = CatalogSet.fromLockfileCatalogs({ default: { effect: "^3.0.0", react: "^18.0.0" } });
		const newer = CatalogSet.fromLockfileCatalogs({ default: { effect: "^4.0.0" } });
		const merged = CatalogSet.merge(older, newer);
		assert.deepStrictEqual(merged.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
		// The un-overridden key must SURVIVE the merge — a naive replace drops it.
		assert.deepStrictEqual(merged.rangeOf("react", Option.none()), Option.some("^18.0.0"));
	});

	it("a __proto__ catalog key lands as an own property, not on the prototype", () => {
		// It must come from JSON.parse, not an object literal — in a literal
		// `__proto__:` sets the prototype and creates no own key, so the test would
		// assert nothing. This is the shape a hostile lockfile actually produces.
		const hostile = JSON.parse('{"__proto__": {"evil": "1.0.0"}}') as unknown;
		const set = CatalogSet.fromLockfileCatalogs(hostile);
		assert.isTrue(Object.hasOwn(set.entries, "__proto__"));
		assert.isUndefined(({} as Record<string, unknown>).evil);
		assert.isUndefined((Object.prototype as unknown as Record<string, unknown>).evil);
	});

	it("a __proto__ DEPENDENCY key inside a catalog does not pollute either", () => {
		const hostile = JSON.parse('{"default": {"__proto__": "1.0.0"}}') as unknown;
		const set = CatalogSet.fromLockfileCatalogs(hostile);
		assert.isUndefined((Object.prototype as unknown as Record<string, unknown>)["1.0.0"]);
		assert.isTrue(Object.hasOwn(set.entries.default, "__proto__"));
	});
});

// ── WorkspaceCatalogs: assembly precedence ─────────────────────────────────

const withLockfileAndInline: Tree = {
	"/repo/pnpm-workspace.yaml": [
		"packages:",
		"  - 'packages/*'",
		"catalog:",
		"  effect: ^4.0.0",
		"catalogs:",
		"  build:",
		"    typescript: ^6.0.0",
		"",
	].join("\n"),
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
	"/repo/packages/a/package.json": manifest("@x/a", { dependencies: { effect: "catalog:" } }),
	// The lockfile records a STALE effect range and a react range the inline
	// catalog says nothing about. Inline must win on effect; react must survive.
	"/repo/pnpm-lock.yaml": [
		"lockfileVersion: '9.0'",
		"catalogs:",
		"  default:",
		"    effect:",
		"      specifier: ^3.0.0",
		"      version: 3.21.4",
		"    react:",
		"      specifier: ^18.0.0",
		"      version: 18.3.1",
		"importers:",
		"  .:",
		"    dependencies: {}",
		"  packages/a:",
		"    dependencies: {}",
		"",
	].join("\n"),
};

describe("WorkspaceCatalogs — assembly precedence", () => {
	layer(workspacesOver(withLockfileAndInline))((it) => {
		it.effect("the inline pnpm-workspace.yaml catalog beats the lockfile's record", () =>
			Effect.gen(function* () {
				const catalogs = yield* WorkspaceCatalogs;
				const set = yield* catalogs.set();
				assert.deepStrictEqual(set.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
			}),
		);

		it.effect("a lockfile-only entry survives the merge", () =>
			Effect.gen(function* () {
				const catalogs = yield* WorkspaceCatalogs;
				const set = yield* catalogs.set();
				assert.deepStrictEqual(set.rangeOf("react", Option.none()), Option.some("^18.0.0"));
			}),
		);

		it.effect("named inline catalogs assemble alongside the default one", () =>
			Effect.gen(function* () {
				const catalogs = yield* WorkspaceCatalogs;
				const set = yield* catalogs.set();
				assert.deepStrictEqual(set.rangeOf("typescript", Option.some("build")), Option.some("^6.0.0"));
			}),
		);

		it.effect("resolveSpecifier resolves a member's catalog: dependency", () =>
			Effect.gen(function* () {
				const catalogs = yield* WorkspaceCatalogs;
				assert.deepStrictEqual(yield* catalogs.resolveSpecifier("effect", "catalog:"), Option.some("^4.0.0"));
			}),
		);
	});
});

// ── the @effected/npm resolver contracts, implemented for real ─────────────

const resolversOver = (tree: Tree) => {
	const core = workspacesOver(tree);
	return Workspaces.resolvers.pipe(Layer.provide(core));
};

describe("the @effected/npm resolver contracts", () => {
	layer(resolversOver(withLockfileAndInline))((it) => {
		it.effect("CatalogResolver.rangeOf resolves against the real assembled catalogs", () =>
			Effect.gen(function* () {
				const resolver = yield* CatalogResolver;
				// The no-op layer @effected/npm ships would return none here.
				assert.deepStrictEqual(yield* resolver.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
				assert.deepStrictEqual(yield* resolver.rangeOf("typescript", Option.some("build")), Option.some("^6.0.0"));
			}),
		);

		it.effect("CatalogResolver.rangeOf is none — not an error — for an unmatched name", () =>
			Effect.gen(function* () {
				const resolver = yield* CatalogResolver;
				assert.deepStrictEqual(yield* resolver.rangeOf("nothing-here", Option.none()), Option.none());
			}),
		);

		it.effect("WorkspaceResolver.versionOf resolves against the discovered packages", () =>
			Effect.gen(function* () {
				const resolver = yield* WorkspaceResolver;
				assert.deepStrictEqual(yield* resolver.versionOf("@x/a"), Option.some("1.0.0"));
			}),
		);

		it.effect("WorkspaceResolver.versionOf is none for a non-member", () =>
			Effect.gen(function* () {
				const resolver = yield* WorkspaceResolver;
				assert.deepStrictEqual(yield* resolver.versionOf("react"), Option.none());
			}),
		);
	});
});

// ── a non-pnpm workspace simply has no catalogs ────────────────────────────

const npmWorkspace: Tree = {
	"/repo/package.json": JSON.stringify({
		name: "root",
		version: "0.0.0",
		workspaces: ["packages/*"],
	}),
	"/repo/packages/a/package.json": manifest("@x/a"),
	"/repo/package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
};

describe("WorkspaceCatalogs — a workspace with no pnpm-workspace.yaml", () => {
	layer(workspacesOver(npmWorkspace))((it) => {
		it.effect("assembles to the empty set rather than failing", () =>
			Effect.gen(function* () {
				const catalogs = yield* WorkspaceCatalogs;
				const set = yield* catalogs.set();
				assert.isTrue(set.isEmpty);
			}),
		);

		it.effect("detects npm from the workspaces field", () =>
			Effect.gen(function* () {
				const roots = yield* WorkspaceRoot;
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect(yield* roots.find("/repo"));
				assert.strictEqual(detected.name, "npm");
			}),
		);

		it.effect("reads the npm lockfile through @effected/lockfiles", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const lockfile = yield* reader.read();
				assert.strictEqual(lockfile.format, "npm");
			}),
		);

		it.effect("discovery still works without any catalogs", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				assert.deepStrictEqual(
					packages.map((pkg) => pkg.name),
					["root", "@x/a"],
				);
			}),
		);
	});
});
