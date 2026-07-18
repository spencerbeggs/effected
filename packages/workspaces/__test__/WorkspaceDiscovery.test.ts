import { assert, describe, it, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import {
	PackageNotFoundError,
	WorkspaceDiscovery,
	WorkspaceDiscoveryError,
	WorkspaceInfo,
	WorkspacePackage,
	WorkspacePatternError,
	WorkspaceRoot,
	WorkspaceRootNotFoundError,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform, rootManifest } from "./fixtures.js";

/** Discovery over a tree, rooted at `/repo`. */
const discoveryOver = (
	tree: Tree,
	options?: {
		readonly maxDepth?: number;
		readonly unreadable?: ReadonlySet<string>;
		readonly unreadableFiles?: ReadonlySet<string>;
	},
) => {
	const { unreadable, unreadableFiles, ...discoveryOptions } = options ?? {};
	const base = platform(tree, {
		...(unreadable === undefined ? {} : { unreadable }),
		...(unreadableFiles === undefined ? {} : { unreadableFiles }),
	});
	const roots = WorkspaceRoot.layer.pipe(Layer.provide(base));
	return Layer.mergeAll(
		roots,
		WorkspaceDiscovery.layer({ cwd: "/repo", ...discoveryOptions }).pipe(Layer.provide(roots), Layer.provide(base)),
	).pipe(Layer.provideMerge(base));
};

// ── one-level wildcards: the v3 behaviour, which must NOT regress ───────────

const oneLevel: Tree = {
	"/repo/package.json": rootManifest(["packages/*", "apps/*"]),
	"/repo/packages/alpha/package.json": manifest("@x/alpha"),
	"/repo/packages/beta/package.json": manifest("@x/beta", { dependencies: { "@x/alpha": "1.0.0" } }),
	"/repo/packages/no-manifest/README.md": "not a package",
	"/repo/apps/web/package.json": manifest("@x/web", { dependencies: { "@x/beta": "1.0.0" } }),
};

describe("WorkspaceDiscovery — one-level patterns", () => {
	layer(discoveryOver(oneLevel))((it) => {
		it.effect("discovers the root package first, then members sorted by relative path", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				assert.deepStrictEqual(
					packages.map((pkg) => pkg.name),
					["root", "@x/web", "@x/alpha", "@x/beta"],
				);
				assert.isTrue(packages[0].isRootWorkspace);
				assert.strictEqual(packages[0].relativePath, ".");
			}),
		);

		it.effect("carries the as-read manifest record on every member", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				const beta = packages.find((pkg) => pkg.name === "@x/beta");
				// The whole parsed record, not the typed slice: dependency fields AND
				// everything discovery never modeled ride along from the one read.
				assert.deepStrictEqual(beta?.manifestRecord, {
					name: "@x/beta",
					version: "1.0.0",
					dependencies: { "@x/alpha": "1.0.0" },
				});
			}),
		);

		it.effect("a directory without a package.json is not a workspace package", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				assert.isFalse(packages.some((pkg) => pkg.relativePath === "packages/no-manifest"));
			}),
		);

		it.effect("importerMap keys on the root-relative path", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const importers = yield* discovery.importerMap();
				assert.strictEqual(importers.get("packages/alpha")?.name, "@x/alpha");
				assert.strictEqual(importers.get(".")?.name, "root");
			}),
		);

		it.effect("getPackage fails with the available names when the name is unknown", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const error = yield* Effect.flip(discovery.getPackage("@x/nope"));
				assert.instanceOf(error, PackageNotFoundError);
				assert.include(error.available, "@x/alpha");
			}),
		);

		it.effect("resolveFile attributes a file to its owning package by longest prefix", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				// The root package's path is a PREFIX of every member's, so a naive
				// first-match index would attribute this to `root`.
				const owner = yield* discovery.resolveFile("/repo/packages/alpha/src/index.ts");
				assert.isTrue(Option.isSome(owner));
				assert.strictEqual(Option.getOrThrow(owner).name, "@x/alpha");
			}),
		);

		it.effect("a file outside every package resolves to none", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				assert.isTrue(Option.isNone(yield* discovery.resolveFile("/elsewhere/x.ts")));
			}),
		);

		it.effect("resolveFiles returns each owner once, sorted", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const owners = yield* discovery.resolveFiles([
					"/repo/packages/beta/a.ts",
					"/repo/packages/beta/b.ts",
					"/repo/apps/web/c.ts",
				]);
				assert.deepStrictEqual(
					owners.map((pkg) => pkg.name),
					["@x/beta", "@x/web"],
				);
			}),
		);
	});
});

// ── the issue-#62 regression: a trailing /** must cross segment boundaries ──

const nested: Tree = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/**'\n",
	"/repo/packages/alpha/package.json": manifest("@x/alpha"),
	"/repo/packages/group/nested/package.json": manifest("@x/nested"),
	"/repo/packages/group/deeper/still/package.json": manifest("@x/deep"),
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
};

describe("WorkspaceDiscovery — packages/** crosses segments (workspaces #62)", () => {
	layer(discoveryOver(nested))((it) => {
		it.effect("finds a package TWO levels below the prefix, not just one", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				const names = packages.map((pkg) => pkg.name);
				// v3 silently rewrote `packages/**` to `packages/*`, so it found alpha
				// and nothing else. Every name below is a package v3 could not see.
				assert.include(names, "@x/alpha");
				assert.include(names, "@x/nested");
				assert.include(names, "@x/deep");
			}),
		);

		it.effect("reads the packages list from pnpm-workspace.yaml via @effected/yaml", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const info = yield* discovery.info();
				assert.deepStrictEqual(info.patterns, ["packages/**"]);
				assert.strictEqual(info.root, "/repo");
			}),
		);
	});
});

// ── node_modules is pruned, exclusions exclude, depth is capped ─────────────

const withNodeModules: Tree = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/**'\n  - '!packages/private-*'\n",
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
	"/repo/packages/alpha/package.json": manifest("@x/alpha"),
	"/repo/packages/private-thing/package.json": manifest("@x/private"),
	"/repo/packages/alpha/node_modules/evil/package.json": manifest("evil"),
	"/repo/packages/alpha/.git/hooks/package.json": manifest("git-junk"),
};

describe("WorkspaceDiscovery — pruning and exclusion", () => {
	layer(discoveryOver(withNodeModules))((it) => {
		it.effect("never descends into node_modules", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				assert.isFalse(packages.some((pkg) => pkg.name === "evil"));
			}),
		);

		it.effect("never descends into .git", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				assert.isFalse(packages.some((pkg) => pkg.name === "git-junk"));
			}),
		);

		it.effect("a leading-bang pattern excludes a package the includes matched", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				assert.isTrue(packages.some((pkg) => pkg.name === "@x/alpha"));
				assert.isFalse(packages.some((pkg) => pkg.name === "@x/private"));
			}),
		);
	});
});

describe("WorkspaceDiscovery — the descent is bounded", () => {
	layer(discoveryOver(nested, { maxDepth: 1 }))((it) => {
		it.effect("fails typed when a segment-crossing pattern descends past maxDepth", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspacePatternError);
				assert.strictEqual(error.kind, "depthExceeded");
				assert.strictEqual(error.pattern, "packages/**");
			}),
		);
	});
});

describe("WorkspaceDiscovery — a fractional maxDepth is a DEFECT, not a typed error", () => {
	layer(discoveryOver(nested, { maxDepth: 2.5 }))((it) => {
		it.effect("dies rather than silently enumerating a truncated tree", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const exit = yield* Effect.exit(discovery.listPackages());
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					// A bare `depth < maxDepth` guard would admit 2.5 AND NaN; the
					// discriminating assertion is that no typed Fail is produced.
					assert.isFalse(exit.cause.reasons.some(Cause.isFailReason));
					assert.isTrue(Cause.hasDies(exit.cause));
				}
			}),
		);
	});
});

describe("WorkspaceDiscovery — NaN maxDepth is a DEFECT", () => {
	layer(discoveryOver(nested, { maxDepth: Number.NaN }))((it) => {
		it.effect("dies rather than returning an empty package list", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const exit = yield* Effect.exit(discovery.listPackages());
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					assert.isFalse(exit.cause.reasons.some(Cause.isFailReason));
					assert.isTrue(Cause.hasDies(exit.cause));
				}
			}),
		);
	});
});

// ── failure paths ──────────────────────────────────────────────────────────

const missingBase: Tree = {
	"/repo/package.json": rootManifest(["packages/*", "apps/*"]),
	"/repo/packages/alpha/package.json": manifest("@x/alpha"),
};

describe("WorkspaceDiscovery — a pattern naming a missing directory fails typed", () => {
	layer(discoveryOver(missingBase))((it) => {
		it.effect("names the offending pattern, so a typo is obvious", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspacePatternError);
				assert.strictEqual(error.kind, "missingBaseDir");
				assert.strictEqual(error.pattern, "apps/*");
			}),
		);
	});
});

const malformed: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	"/repo/packages/bad/package.json": "{ not json",
};

describe("WorkspaceDiscovery — malformed input fails typed, never as a defect", () => {
	layer(discoveryOver(malformed))((it) => {
		it.effect("an unparseable member package.json is a typed WorkspaceDiscoveryError", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const result = yield* Effect.result(discovery.listPackages());
				assert.strictEqual(result._tag, "Failure");
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspaceDiscoveryError);
				assert.strictEqual(error.kind, "invalidJson");
				assert.strictEqual(error.path, "/repo/packages/bad/package.json");
			}),
		);
	});
});

const nameless: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	"/repo/packages/bad/package.json": JSON.stringify({ version: "1.0.0" }),
};

describe("WorkspaceDiscovery — a member without a name", () => {
	layer(discoveryOver(nameless))((it) => {
		it.effect("fails with the missingName discriminant", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspaceDiscoveryError);
				assert.strictEqual(error.kind, "missingName");
			}),
		);
	});
});

const versionless: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	"/repo/packages/bad/package.json": JSON.stringify({ name: "@x/bad" }),
};

describe("WorkspaceDiscovery — a member without a version", () => {
	layer(discoveryOver(versionless))((it) => {
		it.effect("fails with the missingVersion discriminant", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspaceDiscoveryError);
				assert.strictEqual(error.kind, "missingVersion");
			}),
		);
	});
});

// ── the tolerant projection: a non-semver version must NOT break discovery ──

const oddVersion: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	"/repo/packages/odd/package.json": JSON.stringify({ name: "@x/odd", version: "not-semver" }),
};

describe("WorkspaceDiscovery — the projection is deliberately tolerant", () => {
	layer(discoveryOver(oddVersion))((it) => {
		it.effect("a non-semver version discovers fine; only the strict manifest bridge is strict", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const pkg = yield* discovery.getPackage("@x/odd");
				assert.strictEqual(pkg.version, "not-semver");
			}),
		);
	});
});

// ── no workspace root at all ───────────────────────────────────────────────

describe("WorkspaceRoot — no marker anywhere", () => {
	const bare: Tree = { "/repo/src/index.ts": "" };
	const base = platform(bare);
	layer(WorkspaceRoot.layer.pipe(Layer.provideMerge(base)))((it) => {
		it.effect("fails typed, naming the markers it looked for", () =>
			Effect.gen(function* () {
				const roots = yield* WorkspaceRoot;
				const error = yield* Effect.flip(roots.find("/repo/src"));
				assert.instanceOf(error, WorkspaceRootNotFoundError);
				assert.include(error.markers, "pnpm-workspace.yaml");
			}),
		);
	});
});

describe("WorkspaceRoot — the NEAREST root wins", () => {
	const nestedRoots: Tree = {
		"/outer/package.json": rootManifest(["packages/*"]),
		"/outer/inner/pnpm-workspace.yaml": "packages:\n  - 'pkgs/*'\n",
		"/outer/inner/package.json": JSON.stringify({ name: "inner", version: "0.0.0" }),
		"/outer/inner/pkgs/a/package.json": manifest("@i/a"),
	};
	const base = platform(nestedRoots);
	layer(WorkspaceRoot.layer.pipe(Layer.provideMerge(base)))((it) => {
		it.effect("stops at the first marker on the way up, not the outermost", () =>
			Effect.gen(function* () {
				const roots = yield* WorkspaceRoot;
				assert.strictEqual(yield* roots.find("/outer/inner/pkgs/a"), "/outer/inner");
			}),
		);

		it.effect("ascends past directories with no marker", () =>
			Effect.gen(function* () {
				const roots = yield* WorkspaceRoot;
				assert.strictEqual(yield* roots.find("/outer/inner/pkgs"), "/outer/inner");
			}),
		);
	});
});

// ── a member manifest that is valid JSON but not an object ─────────────────

const nonObjectManifest: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	"/repo/packages/good/package.json": manifest("@x/good"),
	// `JSON.parse` returns `undefined` for NOTHING. A manifest of `null` parses
	// happily to `null`, and reading `.name` off it throws a TypeError — malformed
	// input escaping as an unhandled DEFECT rather than the typed channel.
	"/repo/packages/nullish/package.json": "null",
};

describe("WorkspaceDiscovery — a member package.json that is `null`", () => {
	layer(discoveryOver(nonObjectManifest))((it) => {
		it.effect("fails TYPED, never as a defect", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const exit = yield* Effect.exit(discovery.listPackages());
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					// The discriminating assertion: no Die reason. An implementation that
					// lets the TypeError escape still "fails", but it fails as a defect.
					assert.isFalse(exit.cause.reasons.some(Cause.isDieReason));
					assert.isTrue(exit.cause.reasons.some(Cause.isFailReason));
				}

				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspaceDiscoveryError);
				// `null` is VALID JSON — the text parses. What is wrong is its shape, so
				// this is invalidShape, not invalidJson. Asserting invalidJson here is
				// what let a never-constructed invalidShape kind ship unnoticed.
				assert.strictEqual(error.kind, "invalidShape");
			}),
		);
	});
});

// ── a well-formed manifest the schema rejects ──────────────────────────────

const wrongShape: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	// Valid JSON, valid name and version, but `dependencies` is not a string map:
	// the tolerant decode's schema rejects it and raises a SchemaError.
	"/repo/packages/bad/package.json": JSON.stringify({
		name: "@x/bad",
		version: "1.0.0",
		publishConfig: { access: 42 },
	}),
};

describe("WorkspaceDiscovery — a manifest whose shape the schema rejects", () => {
	layer(discoveryOver(wrongShape))((it) => {
		it.effect("is invalidShape, distinct from a JSON syntax error", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspaceDiscoveryError);
				// The SchemaError path. Previously reported as invalidJson, which told a
				// consumer the file was not JSON when in fact it parsed perfectly.
				assert.strictEqual(error.kind, "invalidShape");
				assert.strictEqual(error.path, "/repo/packages/bad/package.json");
			}),
		);
	});
});

// ── an unreadable directory must not silently vanish ───────────────────────

const permissionTree: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	"/repo/packages/visible/package.json": manifest("@x/visible"),
	"/repo/packages/secret/package.json": manifest("@x/secret"),
};

describe("WorkspaceDiscovery — a directory that cannot be read", () => {
	layer(discoveryOver(permissionTree, { unreadable: new Set(["/repo/packages"]) }))((it) => {
		it.effect("surfaces a typed unreadableDirectory rather than reporting an empty workspace", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				// Absorbing every readDirectory failure as "no entries" would return the
				// root package alone and look like a legitimately empty workspace — the
				// same silent-degradation shape as the trailing-`/**` bug. A permission
				// error is a WRONG ANSWER, not an empty one.
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspacePatternError);
				assert.strictEqual(error.kind, "unreadableDirectory");
			}),
		);
	});
});

// ── an unreadable workspace CONFIG must not read as "no patterns declared" ──

const unreadablePnpmWorkspace: Tree = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
	"/repo/packages/a/package.json": manifest("@x/a"),
};

describe("WorkspaceDiscovery — an unreadable pnpm-workspace.yaml", () => {
	layer(discoveryOver(unreadablePnpmWorkspace, { unreadableFiles: new Set(["/repo/pnpm-workspace.yaml"]) }))((it) => {
		it.effect("fails typed rather than reading as a workspace with no patterns", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				// Substituting "" for an unreadable config made an UNREADABLE file and an
				// EMPTY file produce identical results — the failure was invisible by
				// construction. A permission error here would silently yield a workspace
				// with zero members and look exactly like a legitimately empty one.
				const error = yield* Effect.flip(discovery.listPackages());
				assert.instanceOf(error, WorkspaceDiscoveryError);
				assert.strictEqual(error.kind, "read");
				assert.strictEqual(error.path, "/repo/pnpm-workspace.yaml");
			}),
		);
	});
});

// ── the test double: stub ONE method, the derived surface answers consistently ──
//
// The motivating boilerplate (workspaces issue #109): `WorkspaceDiscoveryShape`
// is seven methods wide, and every in-memory double used to hand-stub all of
// them to satisfy tsc even when the test exercised one. `makeTest` fills the
// rest — and derives the lookup methods from the EFFECTIVE `listPackages`, so
// one stub yields a coherent workspace, not seven unrelated stubs.

const utilsPackage = WorkspacePackage.make({
	name: "@x/utils",
	version: "1.0.0",
	path: "/repo/packages/utils",
	packageJsonPath: "/repo/packages/utils/package.json",
	relativePath: "packages/utils",
});

const nestedPackage = WorkspacePackage.make({
	name: "@x/utils-extra",
	version: "1.0.0",
	path: "/repo/packages/utils/extra",
	packageJsonPath: "/repo/packages/utils/extra/package.json",
	relativePath: "packages/utils/extra",
});

// Bound to a const: layerTest is a parameterized layer factory and layers
// memoize by reference.
const StubbedDiscovery = WorkspaceDiscovery.layerTest({
	listPackages: () => Effect.succeed([utilsPackage, nestedPackage]),
});

describe("WorkspaceDiscovery.layerTest — one stubbed method", () => {
	layer(StubbedDiscovery)((it) => {
		it.effect("listPackages returns the stub", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const packages = yield* discovery.listPackages();
				assert.deepStrictEqual(
					packages.map((pkg) => pkg.name),
					["@x/utils", "@x/utils-extra"],
				);
			}),
		);

		it.effect("getPackage derives from the stubbed list — hit and typed miss", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const found = yield* discovery.getPackage("@x/utils");
				assert.strictEqual(found.relativePath, "packages/utils");

				const miss = yield* Effect.flip(discovery.getPackage("@x/nope"));
				assert.instanceOf(miss, PackageNotFoundError);
				assert.deepStrictEqual(miss.available, ["@x/utils", "@x/utils-extra"]);
			}),
		);

		it.effect("importerMap derives from the stubbed list", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const map = yield* discovery.importerMap();
				assert.strictEqual(map.get("packages/utils")?.name, "@x/utils");
				assert.strictEqual(map.size, 2);
			}),
		);

		it.effect("resolveFile derives by LONGEST prefix, not first match", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const owner = yield* discovery.resolveFile("/repo/packages/utils/extra/src/index.ts");
				assert.isTrue(Option.isSome(owner));
				assert.strictEqual(Option.isSome(owner) ? owner.value.name : "", "@x/utils-extra");

				const outside = yield* discovery.resolveFile("/elsewhere/file.ts");
				assert.isTrue(Option.isNone(outside));
			}),
		);

		it.effect("resolveFiles derives distinct owners sorted by name", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const owners = yield* discovery.resolveFiles([
					"/repo/packages/utils/extra/src/index.ts",
					"/repo/packages/utils/src/a.ts",
					"/repo/packages/utils/src/b.ts",
				]);
				assert.deepStrictEqual(
					owners.map((pkg) => pkg.name),
					["@x/utils", "@x/utils-extra"],
				);
			}),
		);
	});
});

// Bound to a const — see StubbedDiscovery.
const EmptyDiscovery = WorkspaceDiscovery.layerTest();

describe("WorkspaceDiscovery.makeTest — the empty-workspace defaults", () => {
	layer(EmptyDiscovery)((it) => {
		it.effect("list-shaped methods succeed empty and refresh is a no-op", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				assert.deepStrictEqual(yield* discovery.listPackages(), []);
				assert.strictEqual((yield* discovery.importerMap()).size, 0);
				assert.deepStrictEqual(yield* discovery.resolveFiles(["/repo/a.ts"]), []);
				assert.isTrue(Option.isNone(yield* discovery.resolveFile("/repo/a.ts")));
				yield* discovery.refresh();
			}),
		);

		it.effect("getPackage fails with the service's own typed error, never a fabricated one", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const miss = yield* Effect.flip(discovery.getPackage("@x/anything"));
				assert.instanceOf(miss, PackageNotFoundError);
				assert.deepStrictEqual(miss.available, []);
			}),
		);

		it.effect("info() DIES unless stubbed — an unstubbed call is a wiring mistake", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				// No honest default WorkspaceInfo exists (a fabricated root would leak
				// into consumer path logic), so the default is a defect, not a typed
				// failure a test could accidentally swallow.
				const exit = yield* Effect.exit(discovery.info());
				assert.isTrue(Exit.isFailure(exit));
				assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
			}),
		);
	});
});

describe("WorkspaceDiscovery.makeTest — overrides win over derivation", () => {
	it.effect("a stubbed info() succeeds and the shape needs nothing else", () =>
		Effect.gen(function* () {
			// The shape value directly — no layer needed to use a double inline.
			const double = WorkspaceDiscovery.makeTest({
				info: () => Effect.succeed(WorkspaceInfo.make({ root: "/repo", patterns: ["packages/*"] })),
			});
			const info = yield* double.info();
			assert.strictEqual(info.root, "/repo");
			assert.deepStrictEqual(yield* double.listPackages(), []);
		}),
	);
});
