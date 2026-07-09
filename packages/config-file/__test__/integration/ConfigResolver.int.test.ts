import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Path } from "effect";
import { ConfigResolver } from "../../src/ConfigResolver.js";

const Platform = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

/** Run `use` against a fresh temp dir, removing it whether `use` passes or throws. */
const withTempDir = <A, R>(use: (root: string) => Effect.Effect<A, never, R>): Effect.Effect<A, never, R> =>
	Effect.acquireUseRelease(
		Effect.promise(() => nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "cf-"))),
		use,
		(root) => Effect.promise(() => nodeFs.rm(root, { recursive: true, force: true })),
	);

describe("ConfigResolver against a real filesystem", () => {
	it.effect("upwardWalk finds a nearer file before a higher one", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const deep = nodePath.join(root, "a", "b");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, "a", ".apprc"), "{}"));

				const resolver = ConfigResolver.upwardWalk({ filename: ".apprc", cwd: deep, stopAt: root });
				const found = yield* resolver.resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, "a", ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("gitRoot anchors on the .git marker", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const deep = nodePath.join(root, "pkg", "src");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() => nodeFs.mkdir(nodePath.join(root, ".git")));
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const found = yield* ConfigResolver.gitRoot({ filename: ".apprc", cwd: deep }).resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("gitRoot anchors on a .git file (worktree)", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const deep = nodePath.join(root, "pkg", "src");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() =>
					nodeFs.writeFile(nodePath.join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/pkg"),
				);
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const found = yield* ConfigResolver.gitRoot({ filename: ".apprc", cwd: deep }).resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("workspaceRoot anchors on pnpm-workspace.yaml", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const deep = nodePath.join(root, "packages", "pkg");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() =>
					nodeFs.writeFile(nodePath.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n"),
				);
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const found = yield* ConfigResolver.workspaceRoot({ filename: ".apprc", cwd: deep }).resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("workspaceRoot anchors on a package.json with a workspaces field", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const deep = nodePath.join(root, "packages", "pkg");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() =>
					nodeFs.writeFile(nodePath.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] })),
				);
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const found = yield* ConfigResolver.workspaceRoot({ filename: ".apprc", cwd: deep }).resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("upwardWalk yields none() when nothing is found before stopAt", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const found = yield* ConfigResolver.upwardWalk({ filename: ".missing", cwd: root, stopAt: root }).resolve;
				assert.isTrue(Option.isNone(found));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("upwardWalk: an earlier-listed subpath wins over a later one in the same directory", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				yield* Effect.promise(() => nodeFs.mkdir(nodePath.join(root, ".config"), { recursive: true }));
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".config", ".apprc"), "{}"));
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const resolver = ConfigResolver.upwardWalk({
					filename: ".apprc",
					cwd: root,
					stopAt: root,
					subpaths: [".config", "."],
				});
				const found = yield* resolver.resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".config", ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("upwardWalk searches stopAt itself, not just directories strictly above it", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const deep = nodePath.join(root, "a", "b");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const resolver = ConfigResolver.upwardWalk({ filename: ".apprc", cwd: deep, stopAt: root });
				const found = yield* resolver.resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("workspaceRoot absorbs an unparsable package.json and keeps ascending to the real root", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const malformedDir = nodePath.join(root, "malformed");
				const deep = nodePath.join(malformedDir, "pkg");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(malformedDir, "package.json"), "{ not json"));
				yield* Effect.promise(() =>
					nodeFs.writeFile(nodePath.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n"),
				);
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const found = yield* ConfigResolver.workspaceRoot({ filename: ".apprc", cwd: deep }).resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);

	it.effect("workspaceRoot does not treat a package.json without a workspaces field as a root", () =>
		withTempDir((root) =>
			Effect.gen(function* () {
				const decoyDir = nodePath.join(root, "mid");
				const deep = nodePath.join(decoyDir, "deep");
				yield* Effect.promise(() => nodeFs.mkdir(deep, { recursive: true }));
				yield* Effect.promise(() =>
					nodeFs.writeFile(nodePath.join(decoyDir, "package.json"), JSON.stringify({ name: "decoy" })),
				);
				yield* Effect.promise(() =>
					nodeFs.writeFile(nodePath.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] })),
				);
				yield* Effect.promise(() => nodeFs.writeFile(nodePath.join(root, ".apprc"), "{}"));

				const found = yield* ConfigResolver.workspaceRoot({ filename: ".apprc", cwd: deep }).resolve;

				assert.strictEqual(Option.getOrNull(found), nodePath.join(root, ".apprc"));
			}),
		).pipe(Effect.provide(Platform)),
	);
});
