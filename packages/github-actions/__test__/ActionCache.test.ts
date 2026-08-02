import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { FileBlobTransfer } from "../src/index.js";
import { ActionCache, ActionCacheError, BlobTransferError, CacheKey } from "../src/index.js";
import { json, resultsEnv, twirpFetch } from "./results.js";

/**
 * A transport that keeps whole files in memory.
 *
 * @remarks
 * Real bytes, not a recorded call: the round-trip test saves through `tar`,
 * deletes the originals and restores them, so what this map holds has to be an
 * archive a real `tar` will accept.
 */
const fileTransfer = () => {
	const blobs = new Map<string, Uint8Array>();
	const transfer: FileBlobTransfer = {
		uploadFile: (url, file) =>
			Effect.tryPromise({
				try: async () => {
					blobs.set(url, new Uint8Array(await readFile(file)));
				},
				catch: (cause) => new BlobTransferError({ reason: "uploadFailed", cause }),
			}),
		downloadToFile: (url, file) =>
			Effect.tryPromise({
				try: async () => {
					const found = blobs.get(url);
					if (found === undefined) {
						throw new Error(`nothing was uploaded to ${url}`);
					}
					await writeFile(file, found);
				},
				catch: (cause) => new BlobTransferError({ reason: "downloadFailed", cause }),
			}),
	};
	return { blobs, transfer };
};

/** The real filesystem and the real `tar`, over a stubbed backend and transport. */
const live = (fetch: typeof globalThis.fetch, transfer: FileBlobTransfer, env: Readonly<Record<string, string>> = {}) =>
	ActionCache.layerWith(transfer).pipe(
		Layer.provide(
			Layer.mergeAll(
				resultsEnv(env),
				NodeServices.layer,
				FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch))),
			),
		),
	);

const scratch = () => mkdtempSync(join(tmpdir(), "effected-cache-test-"));

const withScratch = <A, E>(use: (root: string) => Effect.Effect<A, E>) => {
	const root = scratch();
	return use(root).pipe(Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))));
};

/** The digest `actions/cache` computes for the same path set. */
const versionOf = (paths: ReadonlyArray<string>): string =>
	createHash("sha256")
		.update([...paths, "gzip", "1.0"].join("|"))
		.digest("hex");

describe("ActionCache", () => {
	it.effect("round-trips real files through a real archive", () =>
		withScratch((root) =>
			Effect.gen(function* () {
				const file = join(root, "payload.txt");
				writeFileSync(file, "cached contents");
				const url = "https://blob.example/archive?sig=abc";
				const { blobs, transfer } = fileTransfer();
				const { fetch } = twirpFetch({
					CreateCacheEntry: () => json({ ok: true, signedUploadUrl: url }),
					FinalizeCacheEntryUpload: () => json({ ok: true }),
					GetCacheEntryDownloadURL: () => json({ ok: true, signedDownloadUrl: url, matched_key: "the-key" }),
				});

				const matched = yield* Effect.gen(function* () {
					const cache = yield* ActionCache;
					yield* cache.save([file], "the-key");
					return yield* cache.restore([file], "the-key");
				}).pipe(Effect.provide(live(fetch, transfer)));

				assert.isTrue(Option.isSome(matched));
				assert.strictEqual(Option.getOrNull(matched), "the-key");
				assert.strictEqual(blobs.size, 1);
				// gzip's magic: what was uploaded is an archive, not a description of one.
				assert.deepStrictEqual([...(blobs.get(url) ?? []).slice(0, 2)], [0x1f, 0x8b]);
				assert.strictEqual(readFileSync(file, "utf8"), "cached contents");
			}),
		),
	);

	it.effect("restores a file the save archived and the caller then deleted", () =>
		withScratch((root) =>
			Effect.gen(function* () {
				const file = join(root, "gone.txt");
				writeFileSync(file, "recovered");
				const url = "https://blob.example/a";
				const { transfer } = fileTransfer();
				const { fetch } = twirpFetch({
					CreateCacheEntry: () => json({ ok: true, signedUploadUrl: url }),
					FinalizeCacheEntryUpload: () => json({ ok: true }),
					GetCacheEntryDownloadURL: () => json({ ok: true, signedDownloadUrl: url }),
				});
				yield* Effect.flatMap(ActionCache, (cache) => cache.save([file], "k")).pipe(
					Effect.provide(live(fetch, transfer)),
				);
				rmSync(file);
				yield* Effect.flatMap(ActionCache, (cache) => cache.restore([file], "k")).pipe(
					Effect.provide(live(fetch, transfer)),
				);
				// The whole claim of a cache, and the one an in-memory double cannot make.
				assert.strictEqual(readFileSync(file, "utf8"), "recovered");
			}),
		),
	);

	it.effect("derives the entry version from the paths, in the order given", () =>
		Effect.gen(function* () {
			const { transfer } = fileTransfer();
			const { calls, fetch } = twirpFetch({ GetCacheEntryDownloadURL: () => json({ ok: false }) });
			yield* Effect.flatMap(ActionCache, (cache) => cache.restore(["b", "a"], "k")).pipe(
				Effect.provide(live(fetch, transfer)),
			);
			// Sorting the paths would be the obvious tidy-up and would compute a
			// version no other cache step in the workflow agrees with — the entry a
			// sibling `actions/cache` step wrote would simply never be found.
			assert.strictEqual(calls[0]?.body.version, versionOf(["b", "a"]));
			assert.notStrictEqual(versionOf(["b", "a"]), versionOf(["a", "b"]));
		}),
	);

	it.effect("sends a CacheKey's own restore-key ladder", () =>
		Effect.gen(function* () {
			const key = CacheKey.of("Linux", "pnpm-store", "abc123");
			const { transfer } = fileTransfer();
			const { calls, fetch } = twirpFetch({ GetCacheEntryDownloadURL: () => json({ ok: false }) });
			yield* Effect.flatMap(ActionCache, (cache) => cache.restore(["x"], key)).pipe(
				Effect.provide(live(fetch, transfer)),
			);
			assert.strictEqual(calls[0]?.body.key, "Linux-pnpm-store-abc123");
			// Deriving the ladder at the call site is what every consumer re-invents
			// and gets subtly wrong; passing the key passes the ladder with it.
			assert.deepStrictEqual(calls[0]?.body.restore_keys, [...key.restoreKeys]);
		}),
	);

	it.effect("hands a policy-carrying key's EXACT ladder through, not the derived prefixes", () =>
		Effect.gen(function* () {
			// The whole point of the ladder policy: the typed-key path must carry
			// it, or every consumer with a policy is back to hand-building the
			// restore-key list and bypassing CacheKey. The expected rungs are
			// LITERAL: an implementation that ignores the policy sends four
			// derived prefixes here, and asserting against `key.restoreKeys`
			// would agree with that mutant on both sides.
			const key = CacheKey.of("Linux", "X64", "v1hash", "main", "lockhash").withRestoreDepths([4, 3]);
			const { transfer } = fileTransfer();
			const { calls, fetch } = twirpFetch({ GetCacheEntryDownloadURL: () => json({ ok: false }) });
			yield* Effect.flatMap(ActionCache, (cache) => cache.restore(["x"], key)).pipe(
				Effect.provide(live(fetch, transfer)),
			);
			assert.strictEqual(calls[0]?.body.key, "Linux-X64-v1hash-main-lockhash");
			assert.deepStrictEqual(calls[0]?.body.restore_keys, ["Linux-X64-v1hash-main-", "Linux-X64-v1hash-"]);
		}),
	);

	it.effect("reports a miss as nothing", () =>
		Effect.gen(function* () {
			const { transfer } = fileTransfer();
			const { fetch } = twirpFetch({ GetCacheEntryDownloadURL: () => json({ ok: false }) });
			const found = yield* Effect.flatMap(ActionCache, (cache) => cache.restore(["x"], "k")).pipe(
				Effect.provide(live(fetch, transfer)),
			);
			assert.isTrue(Option.isNone(found));
		}),
	);

	it.effect("answers with the key that actually matched, not the one asked for", () =>
		withScratch((root) =>
			Effect.gen(function* () {
				const file = join(root, "f.txt");
				writeFileSync(file, "x");
				const url = "https://blob.example/b";
				const { transfer } = fileTransfer();
				const { fetch } = twirpFetch({
					CreateCacheEntry: () => json({ ok: true, signedUploadUrl: url }),
					FinalizeCacheEntryUpload: () => json({ ok: true }),
					GetCacheEntryDownloadURL: () => json({ ok: true, signedDownloadUrl: url, matchedKey: "Linux-pnpm-store-" }),
				});
				yield* Effect.flatMap(ActionCache, (cache) => cache.save([file], "primary")).pipe(
					Effect.provide(live(fetch, transfer)),
				);
				const matched = yield* Effect.flatMap(ActionCache, (cache) =>
					cache.restore([file], "primary", ["Linux-"]),
				).pipe(Effect.provide(live(fetch, transfer)));
				// A hit on a restore key is a PARTIAL hit; a caller that cannot tell it
				// from an exact hit never re-saves and the cache never warms.
				assert.strictEqual(Option.getOrNull(matched), "Linux-pnpm-store-");
			}),
		),
	);

	it.effect("refuses to save nothing, without asking the backend", () =>
		Effect.gen(function* () {
			const { transfer } = fileTransfer();
			const { calls, fetch } = twirpFetch({});
			const error = yield* Effect.flip(
				Effect.flatMap(ActionCache, (cache) => cache.save([], "k")).pipe(Effect.provide(live(fetch, transfer))),
			);
			assert.instanceOf(error, ActionCacheError);
			assert.strictEqual(error.reason, "archiveFailed");
			// Reserving an entry for an archive that will never exist leaves a key
			// that answers "present" and serves nothing.
			assert.lengthOf(calls, 0);
		}),
	);

	it.effect("fails with tar's own complaint when the archive cannot be built", () =>
		withScratch((root) =>
			Effect.gen(function* () {
				const { transfer } = fileTransfer();
				const { calls, fetch } = twirpFetch({});
				const error = yield* Effect.flip(
					Effect.flatMap(ActionCache, (cache) => cache.save([join(root, "absent")], "k")).pipe(
						Effect.provide(live(fetch, transfer)),
					),
				);
				assert.strictEqual(error.reason, "archiveFailed");
				// The exit code says it failed; only stderr says why, and the difference
				// between "no such file" and "tar is not installed" is the whole message.
				assert.isDefined(error.stderr);
				assert.lengthOf(calls, 0);
			}),
		),
	);

	it.effect("treats a create conflict as a save that already happened", () =>
		withScratch((root) =>
			Effect.gen(function* () {
				const file = join(root, "f.txt");
				writeFileSync(file, "x");
				const { blobs, transfer } = fileTransfer();
				const { calls, fetch } = twirpFetch({ CreateCacheEntry: () => new Response(null, { status: 409 }) });
				yield* Effect.flatMap(ActionCache, (cache) => cache.save([file], "k")).pipe(
					Effect.provide(live(fetch, transfer)),
				);
				assert.strictEqual(blobs.size, 0);
				assert.lengthOf(calls, 1);
			}),
		),
	);

	it.effect("fails when the upload is never finalized, even though every byte arrived", () =>
		withScratch((root) =>
			Effect.gen(function* () {
				const file = join(root, "f.txt");
				writeFileSync(file, "x");
				const { blobs, transfer } = fileTransfer();
				const { fetch } = twirpFetch({
					CreateCacheEntry: () => json({ ok: true, signedUploadUrl: "https://blob.example/c" }),
					FinalizeCacheEntryUpload: () => json({ ok: false }),
				});
				const error = yield* Effect.flip(
					Effect.flatMap(ActionCache, (cache) => cache.save([file], "k")).pipe(Effect.provide(live(fetch, transfer))),
				);
				assert.strictEqual(blobs.size, 1, "the archive did arrive");
				assert.strictEqual(error.reason, "refused");
				assert.include(error.message, "FinalizeCacheEntryUpload");
			}),
		),
	);

	it.effect("distinguishes a transfer failure from a protocol failure", () =>
		withScratch((root) =>
			Effect.gen(function* () {
				const file = join(root, "f.txt");
				writeFileSync(file, "x");
				const failing: FileBlobTransfer = {
					uploadFile: () => Effect.fail(new BlobTransferError({ reason: "uploadFailed" })),
					downloadToFile: () => Effect.fail(new BlobTransferError({ reason: "downloadFailed" })),
				};
				const { fetch } = twirpFetch({
					CreateCacheEntry: () => json({ ok: true, signedUploadUrl: "https://blob.example/d" }),
				});
				const error = yield* Effect.flip(
					Effect.flatMap(ActionCache, (cache) => cache.save([file], "k")).pipe(Effect.provide(live(fetch, failing))),
				);
				assert.strictEqual(error.reason, "transferFailed");
			}),
		),
	);

	it.effect("names the variable that is missing outside a `uses:` step", () =>
		Effect.gen(function* () {
			const { transfer } = fileTransfer();
			const { fetch } = twirpFetch({});
			const error = yield* Effect.flip(
				Effect.flatMap(ActionCache, (cache) => cache.restore(["x"], "k")).pipe(
					Effect.provide(live(fetch, transfer, { ACTIONS_RESULTS_URL: "" })),
				),
			);
			assert.strictEqual(error.reason, "misconfigured");
			assert.include(error.message, "ACTIONS_RESULTS_URL");
		}),
	);

	describe("test double", () => {
		it.effect("an unstubbed member dies rather than reporting a miss", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(Effect.flatMap(ActionCache, (cache) => cache.restore(["x"], "k")));
				assert.strictEqual(exit._tag, "Failure");
			}).pipe(Effect.provide(ActionCache.layerTest())),
		);
	});
});
