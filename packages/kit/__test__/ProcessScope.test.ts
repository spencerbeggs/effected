import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ProcessCwdHost } from "../src/index.js";
import { ProcessScope, ProcessScopeError } from "../src/index.js";

/** A cwd host double: `missing` directories cannot be entered, and `cwdThrows` models a deleted working directory. */
const makeHost = (start: string, options: { missing?: ReadonlyArray<string>; cwdThrows?: boolean } = {}) => {
	const calls: Array<string> = [];
	let current = start;
	const host: ProcessCwdHost = {
		cwd: () => {
			if (options.cwdThrows === true) throw new Error("ENOENT: uv_cwd");
			return current;
		},
		chdir: (directory) => {
			calls.push(directory);
			if (options.missing?.includes(directory) === true) throw new Error(`ENOENT: ${directory}`);
			current = directory;
		},
	};
	return { host, calls, current: () => current };
};

describe("ProcessScope.chdir", () => {
	it.effect("enters the directory and returns to the previous one when the scope closes", () =>
		Effect.gen(function* () {
			const { host, current } = makeHost("/boot");
			const seen = yield* Effect.scoped(Effect.andThen(ProcessScope.chdir(host, "/work"), Effect.sync(current)));
			assert.strictEqual(seen, "/work");
			assert.strictEqual(current(), "/boot");
		}),
	);

	it.effect("restores on failure and on interruption too", () =>
		Effect.gen(function* () {
			const { host, current } = makeHost("/boot");
			yield* Effect.flip(Effect.scoped(Effect.andThen(ProcessScope.chdir(host, "/work"), Effect.fail("boom"))));
			assert.strictEqual(current(), "/boot");
			yield* Effect.exit(Effect.scoped(Effect.andThen(ProcessScope.chdir(host, "/work"), Effect.interrupt)));
			assert.strictEqual(current(), "/boot");
		}),
	);

	it.effect("a directory that cannot be entered fails ChdirFailed and changes nothing", () =>
		Effect.gen(function* () {
			const { host, calls, current } = makeHost("/boot", { missing: ["/gone"] });
			const error = yield* Effect.flip(Effect.scoped(ProcessScope.chdir(host, "/gone")));
			assert.instanceOf(error, ProcessScopeError);
			assert.strictEqual(error.reason, "ChdirFailed");
			assert.strictEqual(error.path, "/gone");
			assert.deepStrictEqual(calls, ["/gone"], "no restore attempted");
			assert.strictEqual(current(), "/boot");
		}),
	);

	it.effect("a deleted previous directory still lets the change happen, and skips the restore", () =>
		Effect.gen(function* () {
			const { host, calls } = makeHost("/deleted", { cwdThrows: true });
			yield* Effect.scoped(ProcessScope.chdir(host, "/work"));
			assert.deepStrictEqual(calls, ["/work"]);
		}),
	);

	it.effect("a restore that throws is ignored", () =>
		Effect.gen(function* () {
			const { host, calls } = makeHost("/boot", { missing: ["/boot"] });
			yield* Effect.scoped(ProcessScope.chdir(host, "/work"));
			assert.deepStrictEqual(calls, ["/work", "/boot"]);
		}),
	);
});

describe("ProcessScope.env", () => {
	it.effect("applies the patch and restores every key, deleting keys that were absent", () =>
		Effect.gen(function* () {
			const env: Record<string, string | undefined> = { KEEP: "1", CHANGE: "old", DROP: "gone-later" };
			const inside = yield* Effect.scoped(
				Effect.andThen(
					ProcessScope.env(env, { CHANGE: "new", ADDED: "x", DROP: undefined }),
					Effect.sync(() => ({ ...env })),
				),
			);
			assert.deepStrictEqual(inside, { KEEP: "1", CHANGE: "new", ADDED: "x" });
			assert.isFalse(Object.hasOwn(inside, "DROP"), "undefined deletes, never assigns");
			assert.deepStrictEqual(env, { KEEP: "1", CHANGE: "old", DROP: "gone-later" });
			assert.isFalse(Object.hasOwn(env, "ADDED"), "an absent key is deleted again on restore");
		}),
	);

	it.effect("restores after a failure", () =>
		Effect.gen(function* () {
			const env: Record<string, string | undefined> = { A: "1" };
			yield* Effect.flip(Effect.scoped(Effect.andThen(ProcessScope.env(env, { A: "2" }), Effect.fail("boom"))));
			assert.deepStrictEqual(env, { A: "1" });
		}),
	);
});
