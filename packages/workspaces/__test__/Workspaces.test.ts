// The one-call conveniences on the composite: `Workspaces.resolverLayer`
// (the two @effected/npm contracts over one factory call) and
// `Workspaces.resolveManifest` (whole-manifest projection in one shot).
//
// Everything runs on the virtual filesystem — `platform(tree)` — so the
// factory's FileSystem/Path requirement is discharged without a platform
// package, exactly like every other suite here.

import { assert, describe, layer } from "@effect/vitest";
import { CatalogResolver, Manifest, UnresolvedDependencyError, WorkspaceResolver } from "@effected/npm";
import { Effect, Layer, Option } from "effect";
import { Workspaces } from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { platform } from "./fixtures.js";

const TREE: Tree = {
	"/repo/pnpm-workspace.yaml": [
		"packages:",
		"  - 'packages/*'",
		"catalog:",
		"  effect: ^4.0.0",
		"catalogs:",
		"  react18:",
		"    react: ^18.2.0",
		"",
	].join("\n"),
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
	"/repo/packages/a/package.json": JSON.stringify({ name: "@x/a", version: "1.2.3" }),
};

describe("Workspaces.resolveManifest", () => {
	layer(platform(TREE))((it) => {
		it.effect("projects catalog: and workspace: specifiers across the whole manifest", () =>
			Effect.gen(function* () {
				const manifest = yield* Manifest.decode({
					name: "consumer",
					dependencies: { effect: "catalog:", react: "catalog:react18", lodash: "^4.17.0" },
					devDependencies: { "@x/a": "workspace:^" },
					scripts: { build: "tsc" },
				});
				assert.isTrue(manifest.needsResolution);

				const resolved = yield* Workspaces.resolveManifest(manifest, { cwd: "/repo" });
				const record = resolved.toRecord();
				assert.deepStrictEqual(record.dependencies, {
					effect: "^4.0.0",
					lodash: "^4.17.0",
					react: "^18.2.0",
				});
				// `workspace:^` is the pnpm publish projection against the member's
				// CONCRETE version, not a passthrough.
				assert.deepStrictEqual(record.devDependencies, { "@x/a": "^1.2.3" });
				// Non-dependency fields ride through untouched.
				assert.strictEqual(record.name, "consumer");
				assert.deepStrictEqual(record.scripts, { build: "tsc" });
				assert.isFalse(resolved.needsResolution);
			}),
		);

		it.effect("an alias-form workspace: specifier projects to pnpm's npm: publish alias", () =>
			Effect.gen(function* () {
				const manifest = yield* Manifest.decode({
					name: "consumer",
					dependencies: { viz: "workspace:@x/a@*", charts: "workspace:@x/a@^" },
				});
				const resolved = yield* Workspaces.resolveManifest(manifest, { cwd: "/repo" });
				// The dep key is the alias; the version is the TARGET member's.
				assert.deepStrictEqual(resolved.toRecord().dependencies, {
					charts: "npm:@x/a@^1.2.3",
					viz: "npm:@x/a@1.2.3",
				});
			}),
		);

		it.effect("a catalog: specifier with no catalog entry fails typed as UnresolvedDependencyError", () =>
			Effect.gen(function* () {
				const manifest = yield* Manifest.decode({ dependencies: { "left-pad": "catalog:" } });
				const error = yield* Effect.flip(Workspaces.resolveManifest(manifest, { cwd: "/repo" }));
				assert.instanceOf(error, UnresolvedDependencyError);
				assert.strictEqual(error.reason, "catalog-entry-missing");
				assert.strictEqual(error.dependency, "left-pad");
			}),
		);

		it.effect("a manifest with nothing to resolve passes through unchanged", () =>
			Effect.gen(function* () {
				const manifest = yield* Manifest.decode({ name: "plain", dependencies: { effect: "^4.0.0" } });
				// The documented skip-fast path: nothing to resolve, no assembly needed.
				assert.isFalse(manifest.needsResolution);
				const resolved = yield* Workspaces.resolveManifest(manifest, { cwd: "/repo" });
				assert.deepStrictEqual(resolved.toRecord(), { dependencies: { effect: "^4.0.0" }, name: "plain" });
			}),
		);
	});
});

describe("Workspaces.resolverLayer", () => {
	// A fresh layer per call is the factory's documented contract; a suite
	// boundary needs exactly one, bound to a const — same rule as any layer.
	// Its own requirement set is FileSystem | Path, discharged by the same
	// virtual platform every other suite uses.
	const Resolvers = Workspaces.resolverLayer({ cwd: "/repo" }).pipe(Layer.provideMerge(platform(TREE)));
	layer(Resolvers)((it) => {
		it.effect("provides both @effected/npm contracts over one factory call", () =>
			Effect.gen(function* () {
				const catalogs = yield* CatalogResolver;
				const workspaces = yield* WorkspaceResolver;
				assert.deepStrictEqual(yield* catalogs.rangeOf("effect", Option.none()), Option.some("^4.0.0"));
				assert.deepStrictEqual(yield* catalogs.rangeOf("react", Option.some("react18")), Option.some("^18.2.0"));
				assert.deepStrictEqual(yield* workspaces.versionOf("@x/a"), Option.some("1.2.3"));
				// An unmatched name is none, not an error — the contract's convention.
				assert.deepStrictEqual(yield* catalogs.rangeOf("nothing", Option.none()), Option.none());
			}),
		);
	});
});
