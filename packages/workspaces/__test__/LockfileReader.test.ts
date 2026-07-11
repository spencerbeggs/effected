import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { LockfileReadError, LockfileReader, WorkspaceDiscovery, Workspaces } from "../src/index.js";
import { documentsOf } from "../src/internal/documents.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform } from "./fixtures.js";

const workspacesOver = (tree: Tree) => Workspaces.layer({ cwd: "/repo" }).pipe(Layer.provideMerge(platform(tree)));

describe("documentsOf", () => {
	it("a single document with no marker is one chunk, verbatim", () => {
		assert.deepStrictEqual(documentsOf("a: 1\nb: 2"), ["a: 1\nb: 2"]);
	});

	it("a leading marker does not manufacture an empty first document", () => {
		assert.deepStrictEqual(documentsOf("---\na: 1\n"), ["a: 1\n"]);
	});

	it("splits two documents, keeping each one's source text", () => {
		assert.deepStrictEqual(documentsOf("---\na: 1\n---\nb: 2\n"), ["a: 1", "b: 2\n"]);
	});

	it("a --- inside a scalar value is not a document marker", () => {
		// The marker must be `---` ALONE on its line. A three-dash value would
		// otherwise split a document in half.
		assert.lengthOf(documentsOf("key: ---\nother: 1\n"), 1);
	});

	it("empty text yields the original text rather than nothing", () => {
		assert.deepStrictEqual(documentsOf(""), [""]);
	});
});

// The shape pnpm 11 actually writes when a workspace uses configDependencies:
// a small config-dependency lockfile FIRST, then the real one. A single-document
// parse takes the first and reports an empty workspace — the exact bug this
// repo's own lockfile exposed.
const multiDocument: Tree = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\ncatalog:\n  effect: ^4.0.0\n",
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
	"/repo/packages/a/package.json": manifest("@x/a"),
	"/repo/packages/b/package.json": manifest("@x/b"),
	"/repo/pnpm-lock.yaml": [
		"---",
		"lockfileVersion: '9.0'",
		"importers:",
		"  .:",
		"    configDependencies:",
		"      some-plugin:",
		"        specifier: 1.0.0",
		"        version: 1.0.0",
		"---",
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
		"  packages/b:",
		"    dependencies: {}",
		"",
	].join("\n"),
};

describe("LockfileReader — a multi-document pnpm lockfile", () => {
	layer(workspacesOver(multiDocument))((it) => {
		it.effect("selects the REAL lockfile, not the configDependencies preamble", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const lockfile = yield* reader.read();
				const workspaces = lockfile.packages.filter((pkg) => pkg.isWorkspace);
				// The preamble document has zero workspace importers. Taking it would
				// look like an empty workspace rather than a failure.
				assert.isAbove(workspaces.length, 0);
			}),
		);

		it.effect("resolves pnpm importer paths to real package names", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const lockfile = yield* reader.read();
				const names = lockfile.packages.filter((pkg) => pkg.isWorkspace).map((pkg) => pkg.name);
				assert.include(names, "@x/a");
				assert.include(names, "@x/b");
				assert.notInclude(names, "packages/a");
			}),
		);

		it.effect("resolvedVersion looks a package up by its resolved name", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const found = yield* reader.resolvedVersion("@x/a");
				assert.isTrue(Option.isSome(found));
			}),
		);

		it.effect("resolvedVersion is none for a package the lockfile does not record", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				assert.isTrue(Option.isNone(yield* reader.resolvedVersion("not-in-the-lockfile")));
			}),
		);

		it.effect("integrity compares the lockfile against the discovered manifests", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const report = yield* reader.integrity();
				// No workspace declares a dependency on another, so nothing is missing.
				assert.deepStrictEqual(report.unsatisfiedConstraints, []);
			}),
		);

		it.effect("discovery and the lockfile agree on the non-root membership", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const reader = yield* LockfileReader;
				// The root importer is not a workspace *package* in the lockfile model
				// (`@effected/lockfiles` emits only the non-root importers), so the
				// comparison is against discovery's non-root members.
				const discovered = (yield* discovery.listPackages())
					.filter((pkg) => !pkg.isRootWorkspace)
					.map((pkg) => pkg.name)
					.sort();
				const locked = (yield* reader.read()).packages
					.filter((pkg) => pkg.isWorkspace)
					.map((pkg) => pkg.name)
					.sort();
				assert.deepStrictEqual(locked, discovered);
			}),
		);
	});
});

// ── the lockfile is missing ────────────────────────────────────────────────

const noLockfile: Tree = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
	"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
	"/repo/packages/a/package.json": manifest("@x/a"),
};

describe("LockfileReader — no lockfile on disk", () => {
	layer(workspacesOver(noLockfile))((it) => {
		it.effect("fails typed with the path it could not read", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const result = yield* Effect.result(reader.read());
				assert.strictEqual(result._tag, "Failure");
				const error = yield* Effect.flip(reader.read());
				assert.instanceOf(error, LockfileReadError);
				assert.strictEqual(error.lockfilePath, "/repo/pnpm-lock.yaml");
				assert.strictEqual(error.format, "pnpm");
			}),
		);

		it.effect("discovery is unaffected — a missing lockfile is not a missing workspace", () =>
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				const names = (yield* discovery.listPackages()).map((pkg) => pkg.name);
				assert.include(names, "@x/a");
			}),
		);
	});
});

// ── a malformed lockfile ───────────────────────────────────────────────────

const brokenLockfile: Tree = {
	...noLockfile,
	"/repo/pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n\t- [oops\n",
};

describe("LockfileReader — a malformed lockfile", () => {
	layer(workspacesOver(brokenLockfile))((it) => {
		it.effect("fails typed through @effected/lockfiles, never as a defect", () =>
			Effect.gen(function* () {
				const reader = yield* LockfileReader;
				const result = yield* Effect.result(reader.read());
				assert.strictEqual(result._tag, "Failure");
				const error = yield* Effect.flip(reader.read());
				// The parse error belongs to @effected/lockfiles and is NOT redefined here.
				assert.strictEqual(error._tag, "LockfileParseError");
			}),
		);
	});
});
