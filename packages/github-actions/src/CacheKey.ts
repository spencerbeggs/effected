import { createHash } from "node:crypto";
import { GlobSet } from "@effected/glob";
import { Effect, FileSystem, Option, Path, Schema } from "effect";

/**
 * Raised when a cache key cannot be derived from the filesystem.
 *
 * @public
 */
export class CacheKeyError extends Schema.TaggedErrorClass<CacheKeyError>()("CacheKeyError", {
	/**
	 * `readFailed` — a file or directory that was going to be hashed could not be
	 * read. `badPattern` — a glob pattern would not compile. Key *derivation*
	 * itself is pure and total once the bytes are in hand, so these are the only
	 * two things that can go wrong.
	 */
	reason: Schema.Literals(["readFailed", "badPattern"]),
	/** The path being read when it went wrong. */
	path: Schema.optionalKey(Schema.String),
	/** The pattern that would not compile. */
	pattern: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return this.reason === "readFailed"
			? `Could not read "${this.path}" while deriving a cache key`
			: `"${this.pattern}" is not a usable glob pattern`;
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
 * One explicit rung: how many leading segments it keeps. The upper bound is
 * cross-field (`segments.length - 1`) and lives on the class schema.
 */
const RestoreDepth = Schema.Number.check(
	Schema.isInt(),
	Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);

/**
 * The explicit ladder: possibly empty, because **zero rungs is a policy** —
 * exact-match-only restores, spelled by {@link CacheKey.withoutRestoreKeys}.
 * Only *absence* means the default every-prefix ladder.
 */
const RestoreDepths = Schema.Array(RestoreDepth);

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
 * By default every prefix is a rung. When some segments must never be dropped
 * — a rung without a version digest resurrects stale cross-version caches —
 * give the key an explicit ladder policy with
 * {@link CacheKey.withRestoreDepths}, or none at all with
 * {@link CacheKey.withoutRestoreKeys}, instead of bypassing the typed key.
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
export class CacheKey extends Schema.Class<CacheKey>("CacheKey")(
	Schema.Struct({
		/** The components, most general first. */
		segments: Segments,
		/**
		 * The explicit ladder policy, when one was given: how many leading
		 * segments each rung keeps, in the order the rungs are tried. Absent for
		 * the default every-prefix ladder; **empty for no ladder at all** —
		 * exact-match-only. See {@link CacheKey.withRestoreDepths} and
		 * {@link CacheKey.withoutRestoreKeys}.
		 */
		restoreDepths: Schema.optionalKey(RestoreDepths),
	}).check(
		Schema.makeFilter((key) =>
			key.restoreDepths === undefined || key.restoreDepths.every((depth) => depth <= key.segments.length - 1)
				? undefined
				: "every restore depth must be between 1 and segments.length - 1 — a rung keeping every segment would just repeat the primary key",
		),
	),
) {
	/** The primary key: every segment, joined. */
	get key(): string {
		return this.segments.join(SEPARATOR);
	}

	/**
	 * The restore keys, most specific first.
	 *
	 * @remarks
	 * By default each rung drops the last segment and keeps the trailing
	 * separator, so a three-segment key falls back to two prefixes and a
	 * one-segment key falls back to nothing — there is no rung that would match
	 * every cache in the repository.
	 *
	 * **The default ladder is every prefix**, which is wrong for a key whose
	 * later segments must never be dropped alone: a
	 * `platform-arch-versionHash-branchHash-lockfileHash` key derives rungs
	 * without the version digest, and those resurrect stale cross-version
	 * caches. A key built with {@link CacheKey.withRestoreDepths} carries its
	 * own ladder instead, and this getter answers exactly that ladder — so
	 * `ActionCache.restore` picks the policy up through the same typed-key
	 * path, no hand-built restore-key list required. An **empty** policy
	 * ({@link CacheKey.withoutRestoreKeys}) answers no rungs at all: only
	 * *absence* selects the default ladder, so "none" is never mistaken for
	 * "every prefix".
	 */
	get restoreKeys(): ReadonlyArray<string> {
		const rung = (length: number): string => `${this.segments.slice(0, length).join(SEPARATOR)}${SEPARATOR}`;
		if (this.restoreDepths !== undefined) {
			return this.restoreDepths.map(rung);
		}
		const rungs: Array<string> = [];
		for (let length = this.segments.length - 1; length >= 1; length -= 1) {
			rungs.push(rung(length));
		}
		return rungs;
	}

	/**
	 * A copy of this key carrying an explicit restore-key ladder policy.
	 *
	 * @remarks
	 * Each depth is the number of **leading segments** the rung keeps, and the
	 * rungs are emitted in exactly the order given — GitHub tries restore keys
	 * in order, so the order IS the policy. Descending depths (most specific
	 * first) are what a fallback ladder almost always wants; that convention is
	 * recommended rather than enforced, because rung ordering is the consumer's
	 * policy where commas, newlines and the length limit are the runner's
	 * protocol. A depth outside `1..segments.length - 1` is refused at
	 * construction: `0` would match every cache in the repository, and
	 * `segments.length` would just repeat the primary key.
	 *
	 * @example
	 * ```ts
	 * import { CacheKey } from "@effected/github-actions";
	 *
	 * const key = CacheKey.of("Linux", "X64", "v1hash", "main", "lockhash").withRestoreDepths([4, 3]);
	 * key.restoreKeys; // ["Linux-X64-v1hash-main-", "Linux-X64-v1hash-"]
	 * ```
	 */
	withRestoreDepths(depths: readonly [number, ...Array<number>]): CacheKey {
		return CacheKey.make({ segments: this.segments, restoreDepths: depths });
	}

	/**
	 * A copy of this key that restores from its **exact key only** — no ladder.
	 *
	 * @remarks
	 * The third point in the policy space, and the one the typed key had no
	 * spelling for: absence of a policy means the default every-prefix ladder,
	 * so exact-match-only restores (a cache-bust mode, where a stale partial
	 * hit is worse than a cold start) previously forced the caller back to the
	 * string form. This is the same `restoreDepths` field carrying **zero
	 * rungs** — an honest value, not a sentinel: `ActionCache.restore` sends no
	 * `restore_keys` at all, so the backend answers this key or a miss.
	 *
	 * @example
	 * ```ts
	 * import { CacheKey } from "@effected/github-actions";
	 *
	 * const key = CacheKey.of("Linux", "pnpm-store", "abc123").withoutRestoreKeys();
	 * key.key;          // "Linux-pnpm-store-abc123"
	 * key.restoreKeys;  // []
	 * ```
	 */
	withoutRestoreKeys(): CacheKey {
		return CacheKey.make({ segments: this.segments, restoreDepths: [] });
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

	/**
	 * Every file under `workspace` that the pattern set matches.
	 *
	 * @remarks
	 * Discovery and matching are **two different jobs**, and separating them is
	 * what makes this testable and correct. The walk is core
	 * `FileSystem.readDirectory(recursive)`; the matching is `@effected/glob`'s
	 * full minimatch dialect — the same dialect `@actions/glob` uses, so a workflow
	 * author's `!**\/node_modules/**` behaves here exactly as it does in every
	 * other cache step in the same workflow. `node:fs.globSync` would have welded
	 * the two together behind one non-stubbable call *and* changed the dialect,
	 * and a dialect divergence surfaces as a silent cache-key difference — the
	 * worst failure mode a cache key has.
	 *
	 * Candidates are matched by their path **relative to the workspace**, which
	 * is what makes "never hash a file outside the workspace" structural rather
	 * than a rule someone has to remember. Directories are excluded: a directory
	 * called `notes.txt` matches `**\/*.txt` and is not a file, and hashing it
	 * would fail rather than being ignored.
	 *
	 * The answer is sorted, so a caller cannot make its key depend on the order
	 * the filesystem happened to report.
	 */
	static readonly matchingFiles = Effect.fn("CacheKey.matchingFiles")(function* (options: {
		/** The directory to walk. Nothing outside it is ever considered. */
		readonly workspace: string;
		/** Include patterns, with a leading `!` marking an exclusion. */
		readonly patterns: ReadonlyArray<string>;
	}) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const set = yield* GlobSet.compile(options.patterns).pipe(
			Effect.mapError((cause) => new CacheKeyError({ reason: "badPattern", pattern: cause.pattern, cause })),
		);
		const entries = yield* fs
			.readDirectory(options.workspace, { recursive: true })
			.pipe(Effect.mapError((cause) => new CacheKeyError({ reason: "readFailed", path: options.workspace, cause })));

		const matched: Array<string> = [];
		for (const entry of entries) {
			// The walk reports platform separators; the dialect is posix. A Windows
			// runner would otherwise match nothing at all.
			if (!set.matches(entry.replaceAll("\\", "/"))) {
				continue;
			}
			const absolute = path.join(options.workspace, entry);
			const info = yield* fs
				.stat(absolute)
				.pipe(Effect.mapError((cause) => new CacheKeyError({ reason: "readFailed", path: absolute, cause })));
			if (info.type === "File") {
				matched.push(absolute);
			}
		}
		return matched.sort() as ReadonlyArray<string>;
	});

	/**
	 * Hash every file under `workspace` that the pattern set matches.
	 *
	 * @remarks
	 * {@link CacheKey.matchingFiles} into {@link CacheKey.hashFiles}, which is
	 * the pairing every consumer writes by hand — and the pairing whose two
	 * halves have to agree about ordering and about what counts as a file for the
	 * digest to match anything anyone else computed.
	 *
	 * `Option.none()` when nothing matched, for the same reason `hashFiles` gives:
	 * "no files" is not a digest, it is the signal that the patterns are wrong,
	 * and folding it into a key silently caches against a constant.
	 *
	 * @example
	 * ```ts
	 * import { CacheKey } from "@effected/github-actions";
	 * import { Effect, Option } from "effect";
	 *
	 * const key = Effect.gen(function* () {
	 *   const hash = yield* CacheKey.hashMatching({
	 *     workspace: "/home/runner/work/repo/repo",
	 *     patterns: ["**\/pnpm-lock.yaml", "!**\/node_modules/**"],
	 *   });
	 *   return CacheKey.of("Linux", "pnpm-store", Option.getOrElse(hash, () => "empty"));
	 * });
	 * ```
	 */
	static readonly hashMatching = Effect.fn("CacheKey.hashMatching")(function* (options: {
		readonly workspace: string;
		readonly patterns: ReadonlyArray<string>;
	}) {
		return yield* CacheKey.hashFiles(yield* CacheKey.matchingFiles(options));
	});
}
