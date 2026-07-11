import { assert, describe, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
	ChangeDetectionOptions,
	ChangeDetector,
	GitCommandError,
	GitReader,
	PublishabilityDetector,
	WorkspaceDiscovery,
	WorkspacePackage,
	WorkspaceRoot,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform, rootManifest } from "./fixtures.js";

// a → b → c: `web` depends on `beta`, `beta` depends on `alpha`. Touching a file
// in `alpha` must therefore affect `beta` AND `web`.
const tree: Tree = {
	"/repo/package.json": rootManifest(["packages/*", "apps/*"]),
	"/repo/packages/alpha/package.json": manifest("@x/alpha"),
	"/repo/packages/beta/package.json": manifest("@x/beta", { dependencies: { "@x/alpha": "1.0.0" } }),
	"/repo/apps/web/package.json": manifest("@x/web", { dependencies: { "@x/beta": "1.0.0" } }),
};

/** A GitReader that replays a scripted `git diff --name-only` result. */
const gitStub = (
	byArgs: (args: ReadonlyArray<string>) => string | GitCommandError,
	available = true,
): Layer.Layer<GitReader> =>
	Layer.succeed(GitReader, {
		run: (_cwd, args) => {
			const result = byArgs(args);
			return result instanceof GitCommandError ? Effect.fail(result) : Effect.succeed(result);
		},
		available: () => Effect.succeed(available),
	});

const detectorOver = (git: Layer.Layer<GitReader>) => {
	const base = platform(tree);
	const roots = WorkspaceRoot.layer.pipe(Layer.provide(base));
	const discovery = WorkspaceDiscovery.layer({ cwd: "/repo" }).pipe(Layer.provide(roots), Layer.provide(base));
	return Layer.mergeAll(discovery, git, ChangeDetector.layer.pipe(Layer.provide(git), Layer.provide(discovery))).pipe(
		Layer.provideMerge(base),
	);
};

const committedOnly = gitStub((args) =>
	args[0] === "diff" && args.includes("HEAD~1...HEAD") ? "packages/alpha/src/index.ts\n" : "",
);

describe("ChangeDetector — committed changes", () => {
	layer(detectorOver(committedOnly))((it) => {
		it.effect("changedFiles returns the diff output, trimmed and sorted", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				assert.deepStrictEqual(yield* detector.changedFiles(), ["packages/alpha/src/index.ts"]);
			}),
		);

		it.effect("changedPackages maps files onto their owning package", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				const changed = yield* detector.changedPackages();
				assert.deepStrictEqual(
					changed.map((pkg: WorkspacePackage) => pkg.name),
					["@x/alpha"],
				);
			}),
		);

		it.effect("affectedPackages walks the reverse graph TRANSITIVELY", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				const affected = yield* detector.affectedPackages();
				// `@x/web` is two hops from `@x/alpha`. A one-hop implementation
				// returns only alpha and beta and passes a lazier assertion.
				assert.deepStrictEqual(
					affected.map((pkg: WorkspacePackage) => pkg.name),
					["@x/alpha", "@x/beta", "@x/web"],
				);
			}),
		);
	});
});

// `includeUncommitted` must fold in three MORE git invocations. A stub that only
// answers the committed range proves nothing about them, so each returns a
// distinct file and all four must appear.
const withWorkingTree = gitStub((args) => {
	if (args[0] === "diff" && args.includes("HEAD~1...HEAD")) return "packages/alpha/committed.ts\n";
	if (args[0] === "diff" && args.includes("--cached")) return "packages/beta/staged.ts\n";
	if (args[0] === "diff") return "packages/beta/unstaged.ts\n";
	if (args[0] === "ls-files") return "apps/web/untracked.ts\n";
	return "";
});

describe("ChangeDetector — includeUncommitted", () => {
	layer(detectorOver(withWorkingTree))((it) => {
		it.effect("folds in unstaged, staged and untracked files", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				const files = yield* detector.changedFiles(ChangeDetectionOptions.make({ includeUncommitted: true }));
				assert.deepStrictEqual(files, [
					"apps/web/untracked.ts",
					"packages/alpha/committed.ts",
					"packages/beta/staged.ts",
					"packages/beta/unstaged.ts",
				]);
			}),
		);

		it.effect("the default omits the working tree entirely", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				assert.deepStrictEqual(yield* detector.changedFiles(), ["packages/alpha/committed.ts"]);
			}),
		);

		it.effect("changedPackages over the working tree covers every touched package", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				const changed = yield* detector.changedPackages(ChangeDetectionOptions.make({ includeUncommitted: true }));
				assert.deepStrictEqual(
					changed.map((pkg: WorkspacePackage) => pkg.name),
					["@x/alpha", "@x/beta", "@x/web"],
				);
			}),
		);
	});
});

describe("ChangeDetector — a custom base ref reaches git", () => {
	// The stub answers ONLY `origin/main...HEAD`; a detector that ignored the
	// option and used the default range would see an empty diff.
	const custom = gitStub((args) => (args.includes("origin/main...HEAD") ? "packages/beta/x.ts\n" : ""));
	layer(detectorOver(custom))((it) => {
		it.effect("the base option is threaded into the git range", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				const changed = yield* detector.changedPackages(ChangeDetectionOptions.make({ base: "origin/main" }));
				assert.deepStrictEqual(
					changed.map((pkg: WorkspacePackage) => pkg.name),
					["@x/beta"],
				);
			}),
		);
	});
});

describe("ChangeDetector — git unavailable", () => {
	layer(detectorOver(gitStub(() => "", false)))((it) => {
		it.effect("fails typed with the unavailable discriminant, not a defect", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				const result = yield* Effect.result(detector.changedFiles());
				assert.strictEqual(result._tag, "Failure");
				const error = yield* Effect.flip(detector.changedFiles());
				assert.instanceOf(error, GitCommandError);
				assert.strictEqual(error.kind, "unavailable");
			}),
		);
	});
});

describe("ChangeDetector — a git command that fails", () => {
	const badRef = gitStub((args) =>
		args.includes("nope...HEAD")
			? new GitCommandError({
					kind: "failed",
					args,
					cwd: "/repo",
					exitCode: 128,
					stderr: "fatal: bad revision 'nope'",
				})
			: "",
	);
	layer(detectorOver(badRef))((it) => {
		it.effect("surfaces git's own diagnostic on a typed field", () =>
			Effect.gen(function* () {
				const detector = yield* ChangeDetector;
				const error = yield* Effect.flip(detector.changedFiles(ChangeDetectionOptions.make({ base: "nope" })));
				assert.instanceOf(error, GitCommandError);
				assert.strictEqual(error.kind, "failed");
				assert.strictEqual(error.exitCode, 128);
				assert.include(error.stderr, "bad revision");
			}),
		);
	});
});

// ── Publishability, which is pure and swappable ────────────────────────────

const location = {
	version: "1.0.0",
	path: "/repo/packages/p",
	packageJsonPath: "/repo/packages/p/package.json",
	relativePath: "packages/p",
};

describe("PublishabilityDetector — the default npm semantics", () => {
	layer(PublishabilityDetector.layer)((it) => {
		it.effect("a private package with no publishConfig.access publishes nowhere", () =>
			Effect.gen(function* () {
				const detector = yield* PublishabilityDetector;
				const targets = yield* detector.detect(WorkspacePackage.make({ name: "@x/p", ...location, private: true }));
				assert.lengthOf(targets, 0);
			}),
		);

		it.effect("an explicit publishConfig.access overrides private", () =>
			Effect.gen(function* () {
				const detector = yield* PublishabilityDetector;
				const targets = yield* detector.detect(
					WorkspacePackage.make({
						name: "@x/p",
						...location,
						private: true,
						publishConfig: { access: "restricted" },
					}),
				);
				assert.lengthOf(targets, 1);
				assert.strictEqual(targets[0].access, "restricted");
			}),
		);

		it.effect("a public package publishes to the public registry with defaults", () =>
			Effect.gen(function* () {
				const detector = yield* PublishabilityDetector;
				const targets = yield* detector.detect(WorkspacePackage.make({ name: "@x/p", ...location }));
				assert.lengthOf(targets, 1);
				assert.strictEqual(targets[0].registry, "https://registry.npmjs.org/");
				assert.strictEqual(targets[0].directory, ".");
				assert.strictEqual(targets[0].access, "public");
				assert.isFalse(targets[0].provenance);
			}),
		);

		it.effect("publishConfig registry and directory override the defaults", () =>
			Effect.gen(function* () {
				const detector = yield* PublishabilityDetector;
				const targets = yield* detector.detect(
					WorkspacePackage.make({
						name: "@x/p",
						...location,
						publishConfig: { registry: "https://npm.internal/", directory: "dist/npm" },
					}),
				);
				assert.strictEqual(targets[0].registry, "https://npm.internal/");
				assert.strictEqual(targets[0].directory, "dist/npm");
			}),
		);
	});
});
