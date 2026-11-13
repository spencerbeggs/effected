import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { ReleasePlan } from "../src/ReleasePlan.js";

// ReleasePlan.read hands ReleaseManager.detect's answer to assemble: a `./dir` key resolves
// only where pnpm plans the releases.
const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0" });

const repo = (versioning: boolean) => {
	const fs = MemoryFileSystem.layerWithPath({
		"/repo/package.json": '{"name":"root","private":true}',
		"/repo/pnpm-workspace.yaml": `packages:\n  - packages/*\n${versioning ? "versioning:\n  maxBump: minor\n" : ""}`,
		"/repo/packages/a/package.json": manifest("@p/a"),
		"/repo/packages/b/package.json": manifest("@p/b"),
		"/repo/packages/c/package.json": manifest("@p/a"),
		"/repo/.changeset/config.json": "{}",
		"/repo/.changeset/one.md": '---\n"./packages/b": patch\n---\n\nFix.\n',
		"/repo/.changeset/two.md": '---\n"@p/a": patch\n---\n\nFix.\n',
	});
	return WorkspaceDiscovery.layer().pipe(Layer.provide(WorkspaceRoot.layer), Layer.provideMerge(fs));
};

it.effect("read resolves a ./dir key under pnpm and fails a shared bare name typed", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ReleasePlan.read("/repo"));
		assert.isTrue(
			error._tag === "AmbiguousPackageError" &&
				error.packageName === "@p/a" &&
				error.directories.join(",") === "packages/a,packages/c",
		);
	}).pipe(Effect.provide(repo(true))),
);

it.effect("read rejects a ./dir key under the Changesets CLI", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ReleasePlan.read("/repo"));
		assert.isTrue(error._tag === "UnknownPackageError" && error.packageName === "./packages/b");
	}).pipe(Effect.provide(repo(false))),
);
