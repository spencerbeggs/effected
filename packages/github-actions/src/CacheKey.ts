import { createHash } from "node:crypto";
import { Effect, FileSystem, Option, Schema } from "effect";

/**
 * Raised when a cache key cannot be derived from the filesystem.
 *
 * @public
 */
export class CacheKeyError extends Schema.TaggedErrorClass<CacheKeyError>()("CacheKeyError", {
	/**
	 * `readFailed` — a file that was going to be hashed could not be read. There
	 * is deliberately only one reason: key *derivation* is pure and total once
	 * the bytes are in hand, so the only thing that can go wrong is the reading.
	 */
	reason: Schema.Literals(["readFailed"]),
	/** The path being read when it went wrong. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return `Could not read "${this.path}" while deriving a cache key`;
	}
}

/**
 * The separator between key segments.
 *
 * @remarks
 * `-` is not arbitrary: it is what every published Actions cache recipe uses,
 * and a restore key is a **prefix match**, so the separator is what makes a
 * partial key a meaningful boundary rather than a coincidence.
 */
const SEPARATOR = "-";

/** GitHub refuses a cache key longer than this. */
const MAX_KEY_LENGTH = 512;

/**
 * One component of a cache key.
 *
 * @remarks
 * Commas and newlines are refused because the runner uses both to delimit the
 * restore-key list — a segment carrying one would silently become two keys.
 */
const Segment = Schema.String.check(Schema.isPattern(/^[^,\n\r]+$/));

const Segments = Schema.NonEmptyArray(Segment).check(
	Schema.makeFilter((values) => values.join(SEPARATOR).length <= MAX_KEY_LENGTH, {
		title: `a cache key of at most ${MAX_KEY_LENGTH} characters`,
	}),
);

/**
 * A GitHub Actions cache key and the restore-key ladder that goes with it.
 *
 * @remarks
 * The ladder is the part every consumer re-derives and gets subtly wrong. A
 * restore key is a **prefix match** on GitHub's side, so `Linux-pnpm` would
 * also match `Linux-pnpm-store-…` from an unrelated cache; every rung here
 * therefore ends in the separator. Deriving the rungs from the segments makes
 * the primary key and its fallbacks impossible to drift apart, which is the
 * failure that produces a cache that never hits and never says why.
 *
 * @example
 * ```ts
 * import { CacheKey } from "@effected/github-actions";
 *
 * const key = CacheKey.of("Linux", "pnpm-store", "abc123");
 * key.key;          // "Linux-pnpm-store-abc123"
 * key.restoreKeys;  // ["Linux-pnpm-store-", "Linux-"]
 * ```
 *
 * @public
 */
export class CacheKey extends Schema.Class<CacheKey>("CacheKey")({
	/** The components, most general first. */
	segments: Segments,
}) {
	/** The primary key: every segment, joined. */
	get key(): string {
		return this.segments.join(SEPARATOR);
	}

	/**
	 * The restore keys, most specific first.
	 *
	 * @remarks
	 * Each rung drops the last segment and keeps the trailing separator, so a
	 * three-segment key falls back to two prefixes and a one-segment key falls
	 * back to nothing — there is no rung that would match every cache in the
	 * repository.
	 */
	get restoreKeys(): ReadonlyArray<string> {
		const rungs: Array<string> = [];
		for (let length = this.segments.length - 1; length >= 1; length -= 1) {
			rungs.push(`${this.segments.slice(0, length).join(SEPARATOR)}${SEPARATOR}`);
		}
		return rungs;
	}

	/** Build a key from its segments. */
	static of(...segments: readonly [string, ...ReadonlyArray<string>]): CacheKey {
		return CacheKey.make({ segments });
	}

	/**
	 * A branch-aware key.
	 *
	 * @remarks
	 * Ordering the segments `os → scope → branch → hash` is what makes the
	 * derived ladder do the right thing: the first rung falls back to any earlier
	 * cache **on this branch**, and only the next one reaches across branches. The
	 * reverse order would make the first fallback jump branches, which is how a
	 * feature branch ends up warming its cache from `main` and never noticing its
	 * own.
	 *
	 * Every part is an explicit argument rather than read from the environment,
	 * so a key is reproducible outside a runner and a test needs no ambient
	 * state.
	 */
	static forBranch(options: {
		/** What is being cached, e.g. `"pnpm-store"`. */
		readonly scope: string;
		/** The short ref, e.g. `GITHUB_REF_NAME`. */
		readonly branch: string;
		/** The runner OS, e.g. `RUNNER_OS`. Included first when given. */
		readonly os?: string;
		/** The content hash, e.g. from {@link CacheKey.hashFiles}. Included last when given. */
		readonly hash?: string;
	}): CacheKey {
		const segments: Array<string> = [];
		if (options.os !== undefined) {
			segments.push(options.os);
		}
		segments.push(options.scope, options.branch);
		if (options.hash !== undefined) {
			segments.push(options.hash);
		}
		return CacheKey.make({ segments: segments as [string, ...Array<string>] });
	}

	/**
	 * Hash a set of files into a single digest.
	 *
	 * @remarks
	 * **Byte-compatible with `@actions/glob`'s `hashFiles`**, and the three
	 * details that make it so are all easy to get wrong: the paths are sorted, each
	 * file is hashed on its own, and the per-file digest is fed into the
	 * accumulator as **binary** rather than hex. A hex-fed accumulator produces a
	 * perfectly plausible digest that simply never matches a cache entry written
	 * by any other action.
	 *
	 * Sorting and de-duplication happen here rather than at the call site, so a
	 * caller cannot accidentally make its key depend on the order it discovered
	 * files in.
	 *
	 * `Option.none()` for an empty set, because "nothing matched" is not a
	 * digest — it is the signal that the pattern is wrong, and a caller that
	 * folds it into a key silently caches against a constant.
	 */
	static readonly hashFiles = Effect.fn("CacheKey.hashFiles")(function* (files: ReadonlyArray<string>) {
		const fs = yield* FileSystem.FileSystem;
		const ordered = [...new Set(files)].sort();
		if (ordered.length === 0) {
			return Option.none<string>();
		}
		const accumulator = createHash("sha256");
		for (const path of ordered) {
			const bytes = yield* fs
				.readFile(path)
				.pipe(Effect.mapError((cause) => new CacheKeyError({ reason: "readFailed", path, cause })));
			accumulator.update(createHash("sha256").update(bytes).digest());
		}
		return Option.some(accumulator.digest("hex"));
	});
}
