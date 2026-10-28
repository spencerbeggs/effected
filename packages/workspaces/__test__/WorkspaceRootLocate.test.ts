// `WorkspaceRoot.locate` — the Effect form of `locateWorkspaceRootSync`.
//
// The agreement matrix runs both surfaces over ONE `@effected/memfs` volume
// (a handle's `layer` and its node-shaped `sync` port read the same bytes)
// for every case below: same match, or the sync `null` exactly where the
// Effect form fails `WorkspaceRootNotFoundError`. The matrix carries both
// answers — matches of each marker and misses — so an implementation that
// always failed, or always matched, could not pass it.

import nodePath from "node:path";
import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Exit, Result } from "effect";
import type { FindWorkspaceRootOptions } from "../src/index.js";
import {
	WorkspaceRoot,
	WorkspaceRootMatch,
	WorkspaceRootNotFoundError,
	locateWorkspaceRootSync,
} from "../src/index.js";
import { manifest } from "./fixtures.js";

const tree: Readonly<Record<string, string>> = {
	// A pnpm workspace whose member kept a yarn-era `workspaces` field.
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'pkgs/*'\n",
	"/repo/package.json": manifest("repo"),
	"/repo/pkgs/migrated/package.json": manifest("migrated", { workspaces: ["sub/*"] }),
	"/repo/pkgs/plain/src/index.ts": "",
	"/repo/pkgs/plain/package.json": manifest("plain"),
	// A yarn workspace, and a plain checkout nested inside the pnpm one.
	"/yarn/package.json": manifest("yarn", { workspaces: ["packages/*"] }),
	"/yarn/packages/a/package.json": manifest("a"),
	"/repo/nested/package.json": manifest("nested"),
	// No marker at all.
	"/solo/package.json": manifest("solo"),
};

interface Case {
	readonly name: string;
	readonly cwd: string;
	readonly options?: FindWorkspaceRootOptions;
}

const cases: ReadonlyArray<Case> = [
	{ name: "a pnpm member, default markers", cwd: "/repo/pkgs/plain/src" },
	{ name: "the migrated member, default markers (stops at the member)", cwd: "/repo/pkgs/migrated" },
	{ name: "the migrated member, pnpm only", cwd: "/repo/pkgs/migrated", options: { markers: ["pnpm-workspace.yaml"] } },
	{
		name: "the migrated member, package.json only",
		cwd: "/repo/pkgs/migrated",
		options: { markers: ["package.json"] },
	},
	{ name: "a yarn member, default markers", cwd: "/yarn/packages/a" },
	{ name: "a yarn member, pnpm only (a miss)", cwd: "/yarn/packages/a", options: { markers: ["pnpm-workspace.yaml"] } },
	{ name: "a nested checkout, unbounded (adopts the enclosing root)", cwd: "/repo/nested" },
	{ name: "a nested checkout, stopAt itself (a miss)", cwd: "/repo/nested", options: { stopAt: "/repo/nested" } },
	{ name: "a ceiling that is itself the root (inclusive)", cwd: "/repo/pkgs/plain", options: { stopAt: "/repo" } },
	{
		name: "a relative-looking ceiling with dot segments",
		cwd: "/repo/pkgs/plain",
		options: { stopAt: "/repo/pkgs/../pkgs" },
	},
	{ name: "no marker anywhere (a miss)", cwd: "/solo" },
];

const handle = MemoryFileSystem.makeSync(tree);
const syncOps = { fileSystem: handle.sync, path: nodePath.posix } as const;

describe("WorkspaceRoot.locate agrees with locateWorkspaceRootSync", () => {
	layer(handle.layer)((it) => {
		it.effect("the matrix covers matches of both markers and misses", () =>
			Effect.sync(() => {
				const answers = cases.map((c) => locateWorkspaceRootSync(c.cwd, { ...syncOps, ...c.options }));
				assert.isTrue(answers.some((a) => a?.marker === "pnpm-workspace.yaml"));
				assert.isTrue(answers.some((a) => a?.marker === "package.json"));
				assert.isTrue(answers.some((a) => a === null));
			}),
		);

		for (const c of cases) {
			it.effect(c.name, () =>
				Effect.gen(function* () {
					const sync = locateWorkspaceRootSync(c.cwd, { ...syncOps, ...c.options });
					const located = yield* Effect.result(WorkspaceRoot.locate(c.cwd, c.options));
					if (sync === null) {
						assert.isTrue(Result.isFailure(located), "sync answered null, so locate must fail");
						if (Result.isFailure(located)) assert.instanceOf(located.failure, WorkspaceRootNotFoundError);
					} else {
						assert.isTrue(Result.isSuccess(located), "sync matched, so locate must too");
						if (Result.isSuccess(located)) {
							assert.deepStrictEqual(located.success, sync);
							// And the service's `find` names the same root.
							const roots = yield* WorkspaceRoot.make;
							assert.strictEqual(yield* roots.find(c.cwd, c.options), located.success.root);
						}
					}
				}),
			);
		}

		it.effect("reports the matched file, not the starting directory", () =>
			Effect.gen(function* () {
				const match = yield* WorkspaceRoot.locate("/repo/pkgs/migrated", { markers: ["pnpm-workspace.yaml"] });
				assert.deepStrictEqual(
					match,
					WorkspaceRootMatch.make({ root: "/repo", marker: "pnpm-workspace.yaml", path: "/repo/pnpm-workspace.yaml" }),
				);
			}),
		);

		it.effect("an empty markers list dies, as find does", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(WorkspaceRoot.locate("/repo", { markers: [] }));
				assert.isTrue(Exit.isFailure(exit) && exit.cause.reasons.some((reason) => reason._tag === "Die"));
			}),
		);
	});
});
