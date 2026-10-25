// `detectPackageManagerSync` and `localExecContextSync` — the sync facade's
// package-manager half.
//
// The facade's promise is the Effect detector's answer, synchronously. So the
// core of this suite is a parity table: every tree runs through BOTH surfaces —
// `PackageManagerDetector` over the Effect fixture platform, the facade over
// `@effected/memfs`' node-shaped sync port — and the two must agree on the
// verdict or on the failure. The table walks every evidence rung, the
// devEngines-over-packageManager precedence, version attribution, the stray
// lockfiles, the refusal and the corrupt-manifest failures.

import nodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { LocalExec, LocalExecError } from "@effected/commands";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Option, Result } from "effect";
import type { DetectedPackageManager, WorkspacesSyncOptions } from "../src/index.js";
import {
	PackageManagerDetectionError,
	PackageManagerDetector,
	WorkspaceManifestError,
	detectPackageManagerSync,
	localExecContextSync,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { platform } from "./fixtures.js";

/** Sync ops over a fresh memfs volume holding exactly `tree`. */
const memOps = (tree: Tree): WorkspacesSyncOptions => ({
	fileSystem: MemoryFileSystem.makeSync(tree).sync,
	path: nodePath.posix,
});

const manifestWith = (fields: Record<string, unknown>) => JSON.stringify({ name: "root", version: "0.0.0", ...fields });

/** What parity compares: the verdict's fields, or the failure's tag and kind. */
const observe = (
	result: Result.Result<DetectedPackageManager, PackageManagerDetectionError | WorkspaceManifestError>,
) =>
	Result.isSuccess(result)
		? {
				name: result.success.name,
				version: result.success.version,
				runtime: result.success.runtime,
				evidence: result.success.evidence,
			}
		: result.failure._tag === "WorkspaceManifestError"
			? { failure: result.failure._tag, kind: result.failure.kind, path: result.failure.packageJsonPath }
			: { failure: result.failure._tag, checked: result.failure.checked };

const TABLE: ReadonlyArray<readonly [string, Tree]> = [
	[
		"pnpm-workspace.yaml with a corepack version",
		{
			"/repo/pnpm-workspace.yaml": "packages: []\n",
			"/repo/package.json": manifestWith({ packageManager: "pnpm@10.33.0+sha512.abc" }),
		},
	],
	["pnpm-workspace.yaml with no manifest at all", { "/repo/pnpm-workspace.yaml": "packages: []\n" }],
	[
		"pnpm wins over a stray yarn.lock naming yarn",
		{
			"/repo/pnpm-workspace.yaml": "",
			"/repo/yarn.lock": "",
			"/repo/package.json": manifestWith({ packageManager: "yarn@4.5.0" }),
		},
	],
	[
		"bun.lock plus a bun field",
		{ "/repo/bun.lock": "", "/repo/package.json": manifestWith({ packageManager: "bun@1.2.0" }) },
	],
	[
		"bun.lockb plus a devEngines bun",
		{
			"/repo/bun.lockb": "",
			"/repo/package.json": manifestWith({ devEngines: { packageManager: { name: "bun", version: "1.2.0" } } }),
		},
	],
	["a bun lockfile without a bun field", { "/repo/bun.lock": "", "/repo/package.json": manifestWith({}) }],
	[
		"yarn.lock plus a yarn field",
		{ "/repo/yarn.lock": "", "/repo/package.json": manifestWith({ packageManager: "yarn@4.5.0" }) },
	],
	[
		"a stray yarn.lock in an npm workspace",
		{
			"/repo/yarn.lock": "",
			"/repo/package.json": manifestWith({ workspaces: ["packages/*"] }),
		},
	],
	[
		"npm workspaces",
		{ "/repo/package.json": manifestWith({ workspaces: ["packages/*"], packageManager: "npm@11.0.0" }) },
	],
	["a standalone pnpm-lock.yaml", { "/repo/pnpm-lock.yaml": "", "/repo/package.json": manifestWith({}) }],
	["a standalone package-lock.json", { "/repo/package-lock.json": "", "/repo/package.json": manifestWith({}) }],
	["pnpm-lock.yaml beats package-lock.json", { "/repo/pnpm-lock.yaml": "", "/repo/package-lock.json": "" }],
	[
		"devEngines alone",
		{
			"/repo/package.json": manifestWith({
				devEngines: { packageManager: { name: "pnpm", version: "11.11.0+sha512.x" } },
			}),
		},
	],
	["packageManager alone", { "/repo/package.json": manifestWith({ packageManager: "yarn@4.5.0" }) }],
	[
		"devEngines beats a disagreeing packageManager for the name",
		{
			"/repo/package.json": manifestWith({
				packageManager: "yarn@4.5.0",
				devEngines: { packageManager: { name: "pnpm" } },
			}),
		},
	],
	[
		"a devEngines range carries no version",
		{
			"/repo/pnpm-lock.yaml": "",
			"/repo/package.json": manifestWith({ devEngines: { packageManager: { name: "pnpm", version: "^10" } } }),
		},
	],
	[
		"a malformed devEngines is ignored",
		{
			"/repo/package.json": manifestWith({
				devEngines: { packageManager: [{ name: "pnpm" }] },
				packageManager: "npm@11.0.0",
			}),
		},
	],
	[
		"an unknown declared manager is a refusal",
		{ "/repo/package.json": manifestWith({ packageManager: "deno@2.0.0" }) },
	],
	["nothing at all is a refusal", { "/repo/README.md": "" }],
	["a manifest that is not JSON", { "/repo/pnpm-workspace.yaml": "", "/repo/package.json": "{ nope" }],
	["a manifest that is JSON but not an object", { "/repo/pnpm-lock.yaml": "", "/repo/package.json": "[1, 2]" }],
];

describe("detectPackageManagerSync — parity with PackageManagerDetector", () => {
	for (const [label, tree] of TABLE) {
		it.effect(label, () =>
			Effect.gen(function* () {
				const viaEffect = yield* Effect.result(
					Effect.gen(function* () {
						const detector = yield* PackageManagerDetector;
						return yield* detector.detect("/repo");
					}),
				).pipe(Effect.provide(PackageManagerDetector.layer.pipe(Layer.provide(platform(tree)))));
				const viaSync = detectPackageManagerSync("/repo", memOps(tree));
				assert.deepStrictEqual(observe(viaSync), observe(viaEffect));
			}),
		);
	}
});

describe("detectPackageManagerSync — the facade's own edges", () => {
	it("a throwing readFile is a WorkspaceManifestError of kind read, never a throw", () => {
		const ops = memOps({ "/repo/pnpm-lock.yaml": "", "/repo/package.json": "{}" });
		const cause = new Error("EACCES");
		const result = detectPackageManagerSync("/repo", {
			...ops,
			fileSystem: {
				...ops.fileSystem,
				readFile: () => {
					throw cause;
				},
			},
		});
		if (Result.isSuccess(result)) return assert.fail("expected a failure");
		assert.instanceOf(result.failure, WorkspaceManifestError);
		assert.strictEqual(result.failure._tag === "WorkspaceManifestError" && result.failure.kind, "read");
		assert.strictEqual(result.failure._tag === "WorkspaceManifestError" && result.failure.cause, cause);
	});

	it("probes the root as given — no ascent", () => {
		const result = detectPackageManagerSync("/repo/packages/a", memOps({ "/repo/pnpm-workspace.yaml": "" }));
		assert.isTrue(Result.isFailure(result) && result.failure instanceof PackageManagerDetectionError);
	});
});

describe("localExecContextSync", () => {
	it("a pnpm workspace yields pnpm's context, scoped to the root", () => {
		const result = localExecContextSync("/repo/packages/a", memOps({ "/repo/pnpm-workspace.yaml": "" }));
		if (Result.isFailure(result) || Option.isNone(result.success)) return assert.fail("expected a context");
		const context = result.success.value;
		assert.strictEqual(context.label, "pnpm");
		assert.deepStrictEqual(context.prefix, LocalExec.prefixes("pnpm").prefix);
		assert.deepStrictEqual(context.dlxPrefix, LocalExec.prefixes("pnpm").dlxPrefix);
		assert.deepStrictEqual(context.scriptPrefix, LocalExec.prefixes("pnpm").scriptPrefix);
		assert.strictEqual(context.directory, "/repo");
	});

	it("an npm workspace yields npm's context", () => {
		const result = localExecContextSync("/repo", memOps({ "/repo/package.json": manifestWith({ workspaces: [] }) }));
		const context = Result.isSuccess(result) ? Option.getOrUndefined(result.success) : undefined;
		assert.deepStrictEqual(context?.prefix, LocalExec.prefixes("npm").prefix);
	});

	it("no workspace root is none, not a failure", () => {
		const result = localExecContextSync("/repo", memOps({ "/repo/pnpm-lock.yaml": "", "/repo/package.json": "{}" }));
		assert.isTrue(Result.isSuccess(result) && Option.isNone(result.success));
	});

	it("a stopAt ceiling below the root is none", () => {
		const ops = memOps({ "/repo/pnpm-workspace.yaml": "", "/repo/packages/a/package.json": "{}" });
		const result = localExecContextSync("/repo/packages/a", { ...ops, stopAt: "/repo/packages/a" });
		assert.isTrue(Result.isSuccess(result) && Option.isNone(result.success));
	});

	it("a corrupt root manifest is a LocalExecError carrying the manifest failure", () => {
		const result = localExecContextSync(
			"/repo",
			memOps({ "/repo/pnpm-workspace.yaml": "", "/repo/package.json": "{ nope" }),
		);
		if (Result.isSuccess(result)) return assert.fail("expected a failure");
		assert.instanceOf(result.failure, LocalExecError);
		assert.strictEqual(result.failure.directory, "/repo");
		assert.instanceOf(result.failure.cause, WorkspaceManifestError);
	});
});
