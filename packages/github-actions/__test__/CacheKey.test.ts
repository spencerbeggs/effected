import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { systemError } from "effect/PlatformError";
import { CacheKey, CacheKeyError } from "../src/index.js";

/**
 * The digest of `alpha\n` + `beta\n` under `@actions/glob`'s algorithm, pinned
 * as a literal.
 *
 * @remarks
 * A literal rather than a recomputation, because recomputing it in the test
 * would just be the implementation written twice — and the mistake this is
 * guarding against (feeding the per-file digest in as hex rather than binary)
 * would be reproduced identically by the copy. The wrong-way digest is
 * `e11ab1a1…`, which is what this constant discriminates against.
 */
const ALPHA_BETA = "24d116e0411b3a4a8d3d5c9c88c150bc4d4603a490294bd4b23d3ef549e1f1a0";

const FILES: Record<string, string> = {
	"/w/alpha.txt": "alpha\n",
	"/w/beta.txt": "beta\n",
};

const files = FileSystem.layerNoop({
	readFile: (path) =>
		Effect.suspend(() => {
			const content = FILES[String(path)];
			return content === undefined
				? Effect.fail(
						systemError({ _tag: "NotFound", module: "FileSystem", method: "readFile", pathOrDescriptor: String(path) }),
					)
				: Effect.succeed(new TextEncoder().encode(content));
		}),
});

const hashing = <A, E>(program: Effect.Effect<A, E, FileSystem.FileSystem>) => program.pipe(Effect.provide(files));

describe("CacheKey", () => {
	describe("the key and its ladder", () => {
		it("joins the segments", () => {
			assert.strictEqual(CacheKey.of("Linux", "pnpm-store", "abc123").key, "Linux-pnpm-store-abc123");
		});

		it("derives the restore keys most specific first, each ending in the separator", () => {
			// The trailing separator is the point: "Linux-pnpm" would also prefix-match
			// "Linux-pnpmx-…" from an unrelated cache, because GitHub matches restore
			// keys as bare prefixes.
			assert.deepStrictEqual(CacheKey.of("Linux", "pnpm-store", "abc123").restoreKeys, ["Linux-pnpm-store-", "Linux-"]);
		});

		it("gives a single-segment key no ladder at all", () => {
			// There is deliberately no rung here: an empty prefix would match every
			// cache in the repository.
			assert.deepStrictEqual(CacheKey.of("Linux").restoreKeys, []);
		});

		it("refuses a segment containing a comma, which the runner reads as a delimiter", () => {
			assert.throws(() => CacheKey.of("Linux", "a,b"));
		});

		it("refuses a segment containing a newline", () => {
			assert.throws(() => CacheKey.of("Linux", "a\nb"));
		});

		it("refuses a key longer than GitHub accepts", () => {
			assert.throws(() => CacheKey.of("Linux", "x".repeat(512)));
		});

		it("accepts a key exactly at the limit", () => {
			const key = CacheKey.of("x".repeat(512));
			assert.lengthOf(key.key, 512);
		});
	});

	describe("branch-aware derivation", () => {
		it("orders the segments so the first fallback stays on the branch", () => {
			const key = CacheKey.forBranch({ os: "Linux", scope: "pnpm-store", branch: "feature/x", hash: "abc123" });
			assert.strictEqual(key.key, "Linux-pnpm-store-feature/x-abc123");
			// Rung one is this branch's earlier caches; only rung two reaches across
			// branches. Reversing branch and scope would make a feature branch warm
			// itself from main before ever finding its own cache.
			assert.deepStrictEqual(key.restoreKeys, ["Linux-pnpm-store-feature/x-", "Linux-pnpm-store-", "Linux-"]);
		});

		it("omits the os and hash when they are not supplied", () => {
			const key = CacheKey.forBranch({ scope: "pnpm-store", branch: "main" });
			assert.strictEqual(key.key, "pnpm-store-main");
			assert.deepStrictEqual(key.restoreKeys, ["pnpm-store-"]);
		});
	});

	describe("hashFiles", () => {
		it.effect("hashes files the way @actions/glob does", () =>
			hashing(
				Effect.gen(function* () {
					const digest = yield* CacheKey.hashFiles(["/w/alpha.txt", "/w/beta.txt"]);
					assert.deepStrictEqual(digest, Option.some(ALPHA_BETA));
				}),
			),
		);

		it.effect("does not depend on the order the caller discovered files in", () =>
			hashing(
				Effect.gen(function* () {
					const digest = yield* CacheKey.hashFiles(["/w/beta.txt", "/w/alpha.txt"]);
					assert.deepStrictEqual(digest, Option.some(ALPHA_BETA));
				}),
			),
		);

		it.effect("counts a repeated path once", () =>
			hashing(
				Effect.gen(function* () {
					const digest = yield* CacheKey.hashFiles(["/w/alpha.txt", "/w/beta.txt", "/w/alpha.txt"]);
					assert.deepStrictEqual(digest, Option.some(ALPHA_BETA));
				}),
			),
		);

		it.effect("distinguishes different content", () =>
			hashing(
				Effect.gen(function* () {
					const both = yield* CacheKey.hashFiles(["/w/alpha.txt", "/w/beta.txt"]);
					const one = yield* CacheKey.hashFiles(["/w/alpha.txt"]);
					assert.notDeepEqual(both, one);
				}),
			),
		);

		it.effect("reports nothing rather than a digest when no file matched", () =>
			hashing(
				Effect.gen(function* () {
					// A digest of nothing would be a constant, so every run would key
					// against the same value and the cache would always hit with the
					// wrong contents.
					assert.isTrue(Option.isNone(yield* CacheKey.hashFiles([])));
				}),
			),
		);

		it.effect("fails typed, naming the file, when one cannot be read", () =>
			hashing(
				Effect.gen(function* () {
					const error = yield* Effect.flip(CacheKey.hashFiles(["/w/alpha.txt", "/w/gone.txt"]));
					assert.instanceOf(error, CacheKeyError);
					assert.strictEqual(error.reason, "readFailed");
					assert.strictEqual(error.path, "/w/gone.txt");
				}),
			),
		);
	});
});
