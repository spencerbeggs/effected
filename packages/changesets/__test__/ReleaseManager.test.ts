import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Schema } from "effect";
import { ReleaseManager } from "../src/ReleaseManager.js";

const repo = (files: Record<string, string>) =>
	MemoryFileSystem.layerWithPath({ "/repo/package.json": '{"name":"root"}', ...files });

const WORKSPACE = "packages:\n  - packages/*\n";

it.effect("versioning key means pnpm", () =>
	Effect.gen(function* () {
		assert.strictEqual(yield* ReleaseManager.detect("/repo"), "pnpm");
	}).pipe(Effect.provide(repo({ "/repo/pnpm-workspace.yaml": `${WORKSPACE}versioning:\n  maxBump: minor\n` }))),
);

it.effect("ledger.yaml alone means pnpm", () =>
	Effect.gen(function* () {
		assert.strictEqual(yield* ReleaseManager.detect("/repo"), "pnpm");
	}).pipe(Effect.provide(repo({ "/repo/pnpm-workspace.yaml": WORKSPACE, "/repo/.changeset/ledger.yaml": "{}\n" }))),
);

it.effect("config.json and pre.json alone mean changesets", () =>
	Effect.gen(function* () {
		assert.strictEqual(yield* ReleaseManager.detect("/repo"), "changesets");
	}).pipe(
		Effect.provide(
			repo({
				"/repo/pnpm-workspace.yaml": WORKSPACE,
				"/repo/.changeset/config.json": "{}",
				"/repo/.changeset/pre.json": '{"mode":"pre","tag":"next"}',
			}),
		),
	),
);

it.effect("a repository with no pnpm-workspace.yaml means changesets", () =>
	Effect.gen(function* () {
		assert.strictEqual(yield* ReleaseManager.detect("/repo"), "changesets");
	}).pipe(Effect.provide(repo({ "/repo/.changeset/config.json": "{}" }))),
);

it.effect("pre.json beside a versioning key still means pnpm", () =>
	Effect.gen(function* () {
		assert.strictEqual(yield* ReleaseManager.detect("/repo"), "pnpm");
	}).pipe(
		Effect.provide(
			repo({
				"/repo/pnpm-workspace.yaml": `${WORKSPACE}versioning:\n  maxBump: minor\n`,
				"/repo/.changeset/pre.json": '{"mode":"pre","tag":"next"}',
			}),
		),
	),
);

it.effect("a versioning block that does not decode fails typed", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ReleaseManager.detect("/repo"));
		assert.strictEqual(error._tag, "PnpmSettingsError");
	}).pipe(Effect.provide(repo({ "/repo/pnpm-workspace.yaml": `${WORKSPACE}versioning: 5\n` }))),
);

it("the schema admits exactly the two managers", () => {
	assert.strictEqual(Schema.decodeUnknownSync(ReleaseManager)("pnpm"), "pnpm");
	assert.strictEqual(Schema.decodeUnknownSync(ReleaseManager)("changesets"), "changesets");
	assert.throws(() => Schema.decodeUnknownSync(ReleaseManager)("yarn"));
});
