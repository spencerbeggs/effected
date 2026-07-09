import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { ConfigResolver } from "../src/ConfigResolver.js";

/** A FileSystem whose every call fails with EACCES. */
const HostileFs = Layer.succeed(FileSystem.FileSystem, {
	exists: () => Effect.fail(new Error("EACCES: permission denied")),
	readFileString: () => Effect.fail(new Error("EACCES: permission denied")),
} as unknown as FileSystem.FileSystem);

const TestPath = Path.layer;
const HostilePlatform = Layer.mergeAll(HostileFs, TestPath);

describe("ConfigResolver error absorption", () => {
	it.effect("explicitPath yields none() when the filesystem denies permission", () =>
		Effect.gen(function* () {
			const resolver = ConfigResolver.explicitPath("/a/.apprc");
			const result = yield* resolver.resolve;
			assert.isTrue(Option.isNone(result));
		}).pipe(Effect.provide(HostilePlatform)),
	);

	it.effect("staticDir yields none() when the filesystem denies permission", () =>
		Effect.gen(function* () {
			const resolver = ConfigResolver.staticDir({ dir: "/a", filename: ".apprc" });
			const result = yield* resolver.resolve;
			assert.isTrue(Option.isNone(result));
		}).pipe(Effect.provide(HostilePlatform)),
	);

	it.effect("upwardWalk yields none() when the filesystem denies permission", () =>
		Effect.gen(function* () {
			const resolver = ConfigResolver.upwardWalk({ filename: ".apprc", cwd: "/a/b" });
			const result = yield* resolver.resolve;
			assert.isTrue(Option.isNone(result));
		}).pipe(Effect.provide(HostilePlatform)),
	);

	it.effect("workspaceRoot yields none() when the filesystem denies permission", () =>
		Effect.gen(function* () {
			const resolver = ConfigResolver.workspaceRoot({ filename: ".apprc", cwd: "/a/b" });
			const result = yield* resolver.resolve;
			assert.isTrue(Option.isNone(result));
		}).pipe(Effect.provide(HostilePlatform)),
	);

	it.effect("gitRoot yields none() when the filesystem denies permission", () =>
		Effect.gen(function* () {
			const resolver = ConfigResolver.gitRoot({ filename: ".apprc", cwd: "/a/b" });
			const result = yield* resolver.resolve;
			assert.isTrue(Option.isNone(result));
		}).pipe(Effect.provide(HostilePlatform)),
	);

	it.effect("systemEtc yields none() when the filesystem denies permission", () =>
		Effect.gen(function* () {
			const resolver = ConfigResolver.systemEtc({ app: "acme", filename: ".apprc" });
			const result = yield* resolver.resolve;
			assert.isTrue(Option.isNone(result));
		}).pipe(Effect.provide(HostilePlatform)),
	);

	it("every resolver names itself", () => {
		assert.strictEqual(ConfigResolver.explicitPath("/x").name, "explicit");
		assert.strictEqual(ConfigResolver.staticDir({ dir: "/x", filename: "y" }).name, "static");
		assert.strictEqual(ConfigResolver.upwardWalk({ filename: "y" }).name, "walk");
		assert.strictEqual(ConfigResolver.workspaceRoot({ filename: "y" }).name, "workspace");
		assert.strictEqual(ConfigResolver.gitRoot({ filename: "y" }).name, "git");
		assert.strictEqual(ConfigResolver.systemEtc({ app: "y", filename: "z" }).name, "system");
	});
});
