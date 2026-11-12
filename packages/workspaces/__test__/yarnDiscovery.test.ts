// A yarn repository declares its members in `package.json#workspaces`, exactly
// as npm does, so discovery reads it with no manager in the loop: the root is
// found and every member listed. What the kit refuses is ACTING as yarn — the
// manager decision reports yarn as unsupported instead of guessing npm from the
// `workspaces` field beside a `yarn.lock`.

import nodePath from "node:path";
import { assert, describe, it, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Result } from "effect";
import {
	PackageManagerDetector,
	UnsupportedPackageManagerError,
	WorkspaceDiscovery,
	WorkspaceRoot,
	detectPackageManagerSync,
	findWorkspaceRootSync,
	getWorkspacePackagesSync,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform, rootManifest } from "./fixtures.js";

const YARN_WORKSPACE: Tree = {
	"/repo/package.json": rootManifest(["packages/*"]),
	"/repo/yarn.lock":
		'__metadata:\n  version: 8\n  cacheKey: 10c0\n\n"a@workspace:packages/a":\n  version: 0.0.0-use.local\n',
	"/repo/packages/a/package.json": manifest("a"),
	"/repo/packages/b/package.json": manifest("b"),
};

const base = platform(YARN_WORKSPACE);
const roots = WorkspaceRoot.layer.pipe(Layer.provide(base));
const discovery = WorkspaceDiscovery.layer({ cwd: "/repo/packages/a" }).pipe(Layer.provide(roots), Layer.provide(base));
const detector = PackageManagerDetector.layer.pipe(Layer.provide(base));

describe("a yarn workspace", () => {
	layer(Layer.mergeAll(discovery, roots, detector))((it) => {
		it.effect("discovers the members of a yarn workspace", () =>
			Effect.gen(function* () {
				const service = yield* WorkspaceDiscovery;
				const names = (yield* service.listPackages()).map((pkg) => pkg.name).filter((name) => name !== "root");
				assert.deepStrictEqual([...names].sort(), ["a", "b"]);
			}),
		);

		it.effect("finds the root of a yarn workspace", () =>
			Effect.gen(function* () {
				const service = yield* WorkspaceRoot;
				assert.strictEqual(yield* service.find("/repo/packages/b"), "/repo");
			}),
		);

		it.effect("reports yarn as unsupported rather than guessing npm", () =>
			Effect.gen(function* () {
				const service = yield* PackageManagerDetector;
				const error = yield* Effect.flip(service.detect("/repo"));
				assert.instanceOf(error, UnsupportedPackageManagerError);
				if (error._tag !== "UnsupportedPackageManagerError") return assert.fail("expected the unsupported case");
				assert.strictEqual(error.manager, "yarn");
				assert.strictEqual(error.evidence, "yarn.lock");
				assert.strictEqual(error.root, "/repo");
			}),
		);
	});

	describe("the sync facade gives the same answer", () => {
		layer(Layer.empty)((it) => {
			it.effect("reports yarn as unsupported rather than guessing npm", () =>
				Effect.sync(() => {
					const detected = detectPackageManagerSync("/repo", {
						fileSystem: MemoryFileSystem.makeSync(YARN_WORKSPACE).sync,
						path: nodePath.posix,
					});
					if (Result.isSuccess(detected)) return assert.fail(`expected a failure, got ${detected.success.name}`);
					assert.instanceOf(detected.failure, UnsupportedPackageManagerError);
				}),
			);
		});
	});
});

// The sync facades are what vitest-agent calls for its yarn users, with
// exactly these shapes: `findWorkspaceRootSync(cwd, ops)` then
// `getWorkspacePackagesSync(root, ops)`. Both yarn trees reach the Unsupported
// verdict (a sole yarn.lock, and a packageManager field naming yarn), so a
// membership that failed or truncated there would turn these red.
describe("the sync discovery facades on a yarn workspace", () => {
	const DECLARED: Tree = {
		...YARN_WORKSPACE,
		"/repo/package.json": rootManifest(["packages/*"], { packageManager: "yarn@4.5.0" }),
	};

	for (const [label, tree] of [
		["a sole yarn.lock", YARN_WORKSPACE],
		["a yarn packageManager field", DECLARED],
	] as const) {
		const ops = () => ({ fileSystem: MemoryFileSystem.makeSync(tree).sync, path: nodePath.posix });

		it(`${label}: findWorkspaceRootSync from a member dir returns the root`, () => {
			assert.strictEqual(findWorkspaceRootSync("/repo/packages/a", ops()), "/repo");
		});

		it(`${label}: getWorkspacePackagesSync returns the root and both members`, () => {
			const names = getWorkspacePackagesSync("/repo", ops()).map((pkg) => pkg.name);
			assert.deepStrictEqual([...names].sort(), ["a", "b", "root"]);
		});

		it(`${label}: the tree really is an unsupported yarn root`, () => {
			const detected = detectPackageManagerSync("/repo", ops());
			assert.isTrue(Result.isFailure(detected) && detected.failure instanceof UnsupportedPackageManagerError);
		});
	}
});
