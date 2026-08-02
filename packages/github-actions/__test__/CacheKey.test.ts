import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { Path } from "effect";
import { Effect, FileSystem, Option, Schema } from "effect";
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

	describe("an explicit ladder policy", () => {
		it("answers exactly the depths given, in the order given", () => {
			// The consumer case this exists for: a five-segment key whose default
			// ladder derives rungs WITHOUT the version digest — rungs that match
			// stale cross-version caches. The literal expectations matter: an
			// implementation that ignores the policy and falls back to
			// all-prefixes yields four rungs here, not these two.
			const key = CacheKey.of("Linux", "X64", "v1hash", "main", "lockhash").withRestoreDepths([4, 3]);
			assert.deepStrictEqual(key.restoreKeys, ["Linux-X64-v1hash-main-", "Linux-X64-v1hash-"]);
		});

		it("preserves a non-descending order verbatim — the order IS the policy", () => {
			// GitHub tries restore keys in order; descending is recommended in the
			// TSDoc, deliberately not enforced.
			const key = CacheKey.of("a", "b", "c").withRestoreDepths([1, 2]);
			assert.deepStrictEqual(key.restoreKeys, ["a-", "a-b-"]);
		});

		it("leaves the primary key alone", () => {
			const key = CacheKey.of("Linux", "pnpm-store", "abc123").withRestoreDepths([1]);
			assert.strictEqual(key.key, "Linux-pnpm-store-abc123");
		});

		it("does not change the default ladder of a key without a policy", () => {
			// Byte-compatibility claim for every existing consumer.
			assert.deepStrictEqual(CacheKey.of("Linux", "pnpm-store", "abc123").restoreKeys, ["Linux-pnpm-store-", "Linux-"]);
		});

		it("refuses a depth that keeps every segment — that rung would repeat the primary key", () => {
			assert.throws(() => CacheKey.of("a", "b", "c").withRestoreDepths([3]));
		});

		it("refuses a depth of zero — that rung would match every cache in the repository", () => {
			assert.throws(() => CacheKey.of("a", "b", "c").withRestoreDepths([0]));
		});

		it("refuses a negative or fractional depth", () => {
			assert.throws(() => CacheKey.of("a", "b", "c").withRestoreDepths([-1]));
			assert.throws(() => CacheKey.of("a", "b", "c").withRestoreDepths([1.5]));
		});
	});

	describe("no ladder at all — exact-match-only", () => {
		it("answers zero rungs", () => {
			// The third point in the policy space: absent = the default ladder,
			// explicit depths = that ladder, EMPTY = no ladder. A mutant that
			// reads an empty policy as "no policy" regenerates the two default
			// rungs here and fails on the literal [].
			assert.deepStrictEqual(CacheKey.of("Linux", "pnpm-store", "abc123").withoutRestoreKeys().restoreKeys, []);
		});

		it("leaves the primary key alone", () => {
			assert.strictEqual(
				CacheKey.of("Linux", "pnpm-store", "abc123").withoutRestoreKeys().key,
				"Linux-pnpm-store-abc123",
			);
		});

		it("survives a schema round-trip without regaining a ladder", () => {
			// The policy is a plain field, so a key that crossed a serialization
			// boundary (state, JSON output) keeps meaning "exact match only".
			const encoded = Schema.encodeSync(CacheKey)(CacheKey.of("Linux", "pnpm-store").withoutRestoreKeys());
			const decoded = Schema.decodeUnknownSync(CacheKey)(encoded);
			assert.deepStrictEqual(decoded.restoreKeys, []);
			assert.strictEqual(decoded.key, "Linux-pnpm-store");
		});

		it("does not change a key without a policy — absent still means the default ladder", () => {
			assert.deepStrictEqual(CacheKey.of("Linux", "pnpm-store", "abc123").restoreKeys, ["Linux-pnpm-store-", "Linux-"]);
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

	describe("hashing what a pattern set matches", () => {
		// Real filesystem, real walk: the claims here are about what is on disk and
		// what a recursive read reports, and a stubbed directory listing would only
		// assert the stub.
		const workspace = () => {
			const root = mkdtempSync(join(tmpdir(), "effected-cachekey-"));
			mkdirSync(join(root, "packages", "a"), { recursive: true });
			mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
			writeFileSync(join(root, "pnpm-lock.yaml"), "lock\n");
			writeFileSync(join(root, "packages", "a", "pnpm-lock.yaml"), "inner\n");
			writeFileSync(join(root, "node_modules", "dep", "pnpm-lock.yaml"), "vendored\n");
			writeFileSync(join(root, "readme.md"), "docs\n");
			return root;
		};

		const walking = <A, E>(use: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) => {
			const root = workspace();
			return use(root).pipe(
				Effect.provide(NodeServices.layer),
				Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
			);
		};

		it.effect("matches relative to the workspace, and honours an exclusion", () =>
			walking((root) =>
				Effect.gen(function* () {
					const matched = yield* CacheKey.matchingFiles({
						workspace: root,
						patterns: ["**/pnpm-lock.yaml", "!**/node_modules/**"],
					});
					// Matching against the RELATIVE path is what makes "never reach outside
					// the workspace" structural. Matching absolute paths would also make
					// every pattern depend on where the runner happened to check out.
					assert.deepStrictEqual(
						matched.map((file) => file.slice(root.length + 1)),
						["packages/a/pnpm-lock.yaml", "pnpm-lock.yaml"],
					);
				}),
			),
		);

		it.effect("excludes a directory whose name matches the pattern", () =>
			walking((root) =>
				Effect.gen(function* () {
					// A directory called `notes.txt` matches `**\/*.txt` and is not a file.
					// Without the check it reaches `hashFiles`, which fails on the read —
					// so this is the difference between a working cache key and a failing
					// action.
					mkdirSync(join(root, "notes.txt"));
					writeFileSync(join(root, "notes.txt", "inner.txt"), "inner\n");
					const matched = yield* CacheKey.matchingFiles({ workspace: root, patterns: ["*.txt", "**/*.txt"] });
					assert.deepStrictEqual(
						matched.map((file) => file.slice(root.length + 1)),
						["notes.txt/inner.txt"],
					);
				}),
			),
		);

		it.effect("is exactly hashFiles over what it matched", () =>
			walking((root) =>
				Effect.gen(function* () {
					const matched = yield* CacheKey.matchingFiles({ workspace: root, patterns: ["**/pnpm-lock.yaml"] });
					assert.deepStrictEqual(
						yield* CacheKey.hashMatching({ workspace: root, patterns: ["**/pnpm-lock.yaml"] }),
						yield* CacheKey.hashFiles(matched),
					);
				}),
			),
		);

		it.effect("reports nothing rather than a digest when the patterns match nothing", () =>
			walking((root) =>
				Effect.gen(function* () {
					assert.isTrue(Option.isNone(yield* CacheKey.hashMatching({ workspace: root, patterns: ["**/*.absent"] })));
				}),
			),
		);

		it.effect("fails typed, naming the pattern, when one will not compile", () =>
			walking((root) =>
				Effect.gen(function* () {
					const hostile = "x".repeat(70_000);
					const error = yield* Effect.flip(CacheKey.matchingFiles({ workspace: root, patterns: [hostile] }));
					assert.instanceOf(error, CacheKeyError);
					assert.strictEqual(error.reason, "badPattern");
					assert.strictEqual(error.pattern, hostile);
				}),
			),
		);

		it.effect("fails typed, naming the workspace, when it cannot be walked", () =>
			walking((root) =>
				Effect.gen(function* () {
					const absent = join(root, "not-here");
					const error = yield* Effect.flip(CacheKey.matchingFiles({ workspace: absent, patterns: ["**"] }));
					assert.strictEqual(error.reason, "readFailed");
					assert.strictEqual(error.path, absent);
				}),
			),
		);
	});
});
