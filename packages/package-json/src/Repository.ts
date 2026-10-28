// The `repository` and `bugs` field models: where a package lives, and where
// to report problems with it.
//
// Both accept npm's two encodings — a shorthand string or an object — and both
// hold the same wire-fidelity requirement the `Person` model does: a formatter
// must not rewrite one legal encoding into another, so a value read from the
// string form re-encodes to that exact string. The mechanism is `Person`'s: a
// WeakMap of provenance, because the wire form is provenance rather than data —
// it must not appear in the encoded output, must not affect structural
// equality, and must not survive being copied into a hand-built value.
//
// Normalization is exposed as DERIVED GETTERS over a verbatim `url`, never by
// rewriting the field. A caller that wants a browsable link asks for one; a
// caller that wants the bytes it read keeps them.

import { Option, Schema, SchemaTransformation } from "effect";

/** The shorthand hosts npm resolves without a scheme. */
const SHORTHAND_HOSTS: ReadonlyMap<string, string> = new Map([
	["github", "https://github.com"],
	["gitlab", "https://gitlab.com"],
	["bitbucket", "https://bitbucket.org"],
]);

/** `owner/name`, the bare GitHub shorthand. Deliberately strict about segment shape. */
const BARE_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

/** `github:owner/name`, `gist:id`, … */
const PREFIXED_SHORTHAND = /^([a-z]+):(.+)$/;

/** The scp-like form git accepts: `git@host:owner/name.git`. */
const SCP_LIKE = /^(?:([\w.-]+)@)?([\w.-]+):(.+)$/;

/**
 * How each known forge spells "browse this subdirectory". `HEAD` is used
 * rather than a branch name because the default branch is not knowable from a
 * manifest, and every one of these hosts resolves `HEAD` to it.
 */
const DIRECTORY_PATHS: ReadonlyMap<string, string> = new Map([
	["github.com", "tree/HEAD"],
	// GitLab routes repository browsing under `/-/` to keep it clear of group
	// and project namespaces, which can otherwise collide with `tree`.
	["gitlab.com", "-/tree/HEAD"],
	["bitbucket.org", "src/HEAD"],
]);

const stripGitSuffix = (value: string): string => (value.endsWith(".git") ? value.slice(0, -4) : value);

/**
 * The browsable `https://host/path` form of a repository reference, or none
 * when the value is not one this model recognizes.
 *
 * Total by construction: `repository` is caller data, and a value that cannot
 * be interpreted is a missing answer rather than a failure.
 */
const browseUrlOf = (raw: string): Option.Option<string> => {
	const url = raw.trim();
	if (url === "") return Option.none();

	// `owner/name` — GitHub is npm's default host for the bare form.
	if (BARE_SHORTHAND.test(url)) return Option.some(`https://github.com/${url}`);

	const prefixed = PREFIXED_SHORTHAND.exec(url);
	if (prefixed !== null) {
		const [, scheme, rest] = prefixed;
		// `gist:id` resolves to a different host than the code-forge shorthands.
		if (scheme === "gist") return Option.some(`https://gist.github.com/${stripGitSuffix(rest ?? "")}`);
		const host = SHORTHAND_HOSTS.get(scheme ?? "");
		if (host !== undefined) return Option.some(`${host}/${stripGitSuffix(rest ?? "")}`);
	}

	// Anything with a scheme: normalize the transport away and keep host + path.
	// `git+ssh://git@github.com/o/n.git` and `git://github.com/o/n.git` both
	// browse at `https://github.com/o/n`.
	const withoutGitPlus = url.startsWith("git+") ? url.slice(4) : url;
	const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(withoutGitPlus);
	if (schemeMatch !== null) {
		const authorityAndPath = schemeMatch[2] ?? "";
		// Drop any `user@` credential prefix — it is transport, not identity.
		const withoutCredentials = authorityAndPath.replace(/^[^/@]+@/, "");
		return withoutCredentials === "" ? Option.none() : Option.some(`https://${stripGitSuffix(withoutCredentials)}`);
	}

	// The scp-like form has no scheme: `git@github.com:owner/name.git`.
	const scp = SCP_LIKE.exec(withoutGitPlus);
	if (scp !== null) {
		const [, , host, path] = scp;
		if (host !== undefined && path !== undefined && path !== "") {
			return Option.some(`https://${host}/${stripGitSuffix(path)}`);
		}
	}

	return Option.none();
};

/**
 * The forges whose repository paths are exactly `owner/name`. Any other host
 * (GitLab, a self-hosted forge) may nest groups, so the owner there is every
 * segment before the last.
 */
const TWO_SEGMENT_HOSTS: ReadonlySet<string> = new Set(["github.com", "bitbucket.org"]);

/** One path segment of an owner or repository name. */
const SLUG_SEGMENT = /^[\w.-]+$/;

/**
 * The `{ host, owner, name }` a repository reference names, or none.
 *
 * @remarks
 * Derived from {@link browseUrlOf} so the two can never disagree about which
 * forms are recognized: anything with a browse URL whose path is an owner and
 * a name has a slug. A `#ref` or `?query` suffix and a `.git` suffix are
 * dropped; anything else on the path (`/tree/main`, a gist id with no owner)
 * means the reference does not name a repository by owner and name.
 */
const slugOf = (raw: string): Option.Option<RepositorySlug> =>
	Option.flatMap(browseUrlOf(raw), (url) => {
		const match = /^https:\/\/([^/]+)\/(.*)$/.exec(url);
		const authority = match?.[1];
		const rawPath = match?.[2];
		if (authority === undefined || rawPath === undefined) return Option.none();
		const cut = rawPath.search(/[#?]/);
		const path = stripGitSuffix((cut === -1 ? rawPath : rawPath.slice(0, cut)).replace(/\/+$/, ""));
		const segments = path.split("/");
		if (segments.some((segment) => !SLUG_SEGMENT.test(segment) || segment === "." || segment === "..")) {
			return Option.none();
		}
		const host = authority.toLowerCase();
		if (TWO_SEGMENT_HOSTS.has(host) ? segments.length !== 2 : segments.length < 2) return Option.none();
		return Option.some(
			RepositorySlug.make({
				host,
				owner: segments.slice(0, -1).join("/"),
				name: segments[segments.length - 1] ?? "",
			}),
		);
	});

/**
 * A repository named by its forge host, owner and name: what
 * {@link Repository.slug} answers.
 *
 * @remarks
 * `owner` is every path segment before the last, so a GitLab subgroup
 * repository (`gitlab.com/group/sub/project`) reads as owner `group/sub` and
 * name `project`. On GitHub and Bitbucket, whose paths are exactly two
 * segments, `owner` is a single segment. `host` is lower-cased; the owner and
 * name keep the case the manifest wrote.
 *
 * @public
 */
export class RepositorySlug extends Schema.Class<RepositorySlug>("RepositorySlug")({
	/** The forge host, lower-cased: `github.com`, `gitlab.com`, `git.example.com`. */
	host: Schema.String,
	/** The owning user, organization or (on GitLab) group path. */
	owner: Schema.String,
	/** The repository name, without any `.git` suffix. */
	name: Schema.String,
}) {
	/** `owner/name`, the form GitHub's API and most forges' URLs use. */
	get path(): string {
		return `${this.owner}/${this.name}`;
	}
}

/** The wire value a repository or bugs entry was decoded from. */
type FieldWire = string | { readonly [k: string]: unknown };

const repositoryWires = new WeakMap<Repository, FieldWire>();
const bugsWires = new WeakMap<Bugs, FieldWire>();

const KNOWN_REPOSITORY_KEYS: ReadonlySet<string> = new Set(["type", "url", "directory"]);
const KNOWN_BUGS_KEYS: ReadonlySet<string> = new Set(["url", "email"]);

// A remembered OBJECT wire is replayed only while it still describes the value
// faithfully — the same discipline `Person` already applies, and for the same
// reason. An unguarded replay hands back the bytes that were read, so a value
// edited after decoding re-encodes as the stale original and the edit is
// silently lost. `Person` guarded this; `Repository` and `Bugs` did not.
const sameRest = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** The keys of `wire` outside the documented set, which is what `rest` holds. */
const restOf = (wire: { readonly [k: string]: unknown }, known: ReadonlySet<string>): Record<string, unknown> => {
	const rest: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(wire)) {
		if (!known.has(key)) rest[key] = value;
	}
	return rest;
};

/**
 * Whether the shorthand string can still carry everything this value holds.
 *
 * @remarks
 * A shorthand is only a `url` — it has no syntax for `type`, `directory` or an
 * unknown key. So a repository decoded from a string that later GAINS one of
 * those is no longer described by the wire it remembers, and replaying that
 * wire drops the addition silently. This is the same stale-provenance class the
 * object branch guards, reached through the one field the shorthand cannot
 * express, and `Person.isShorthandExpressible` / `Funding.isStringExpressible`
 * already gate their own string branches this way.
 *
 * `directory` is the live case: this package ships `Repository.directoryUrl`,
 * so a consumer reading a bare-string `repository` and making it a monorepo
 * member is the natural mutator.
 */
const isStringExpressibleRepository = (repository: Repository): boolean =>
	repository.type === undefined &&
	repository.directory === undefined &&
	Object.keys(repository.rest ?? {}).length === 0;

/** Whether the bare URL string can still carry everything this `bugs` entry holds. */
const isStringExpressibleBugs = (bugs: Bugs): boolean =>
	bugs.email === undefined && Object.keys(bugs.rest ?? {}).length === 0;

const isFaithfulRepository = (wire: { readonly [k: string]: unknown }, repository: Repository): boolean =>
	(wire.url as unknown) === repository.url &&
	(wire.type as unknown) === repository.type &&
	(wire.directory as unknown) === repository.directory &&
	sameRest(restOf(wire, KNOWN_REPOSITORY_KEYS), repository.rest);

const isFaithfulBugs = (wire: { readonly [k: string]: unknown }, bugs: Bugs): boolean =>
	(wire.url as unknown) === bugs.url &&
	(wire.email as unknown) === bugs.email &&
	sameRest(restOf(wire, KNOWN_BUGS_KEYS), bugs.rest);

/**
 * Where a package's source lives.
 *
 * @remarks
 * `url` is **verbatim** — exactly the string the manifest carried, shorthand
 * and all. Normalization is offered through {@link Repository.browseUrl} and
 * {@link Repository.gitUrl}, so reading a manifest never rewrites it and a
 * caller that wants the original still has it.
 *
 * @example
 * ```ts
 * import { Repository } from "@effected/package-json";
 * import { Schema } from "effect";
 *
 * const repo = Schema.decodeUnknownSync(Repository.FromValue)("effected/kit");
 * repo.url; // => "effected/kit"
 * repo.browseUrl; // => Option.some("https://github.com/effected/kit")
 * // "git@github.com:effected/kit.git" browses to the same URL
 * ```
 *
 * @public
 */
export class Repository extends Schema.Class<Repository>("Repository")({
	/** The `type` field, when the object form carried one (`"git"`, …). */
	type: Schema.optionalKey(Schema.String),
	/** The reference exactly as written: a shorthand, a git URL, or an https URL. */
	url: Schema.String,
	/** The subdirectory within the repository, for a monorepo member. */
	directory: Schema.optionalKey(Schema.String),
	/** Keys outside the documented set, preserved so encoding does not drop them. */
	rest: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {
	/**
	 * The browsable `https://` URL, or `Option.none()` when `url` is not a form
	 * this model recognizes.
	 */
	get browseUrl(): Option.Option<string> {
		return browseUrlOf(this.url);
	}

	/**
	 * The forge host, owner and name this repository names, or `Option.none()`
	 * when `url` does not name one.
	 *
	 * @remarks
	 * Every form {@link Repository.browseUrl} recognizes counts, and that
	 * includes the **bare `owner/name` shorthand**, which npm resolves to
	 * GitHub: `"effected/kit"` answers `github.com`, `effected`, `kit`, exactly
	 * as `"github:effected/kit"`, `"git+https://github.com/effected/kit.git"`,
	 * `"git@github.com:effected/kit.git"` and the object form's `url` do. A
	 * caller that must not treat a bare shorthand as GitHub has to test `url`
	 * itself; this getter follows npm.
	 *
	 * A `#ref` or `?query` suffix and a `.git` suffix are dropped. A reference
	 * that browses to a deeper path (`https://github.com/o/n/tree/main`), to a
	 * gist (`gist:id`, which has no owner) or to a host-only URL has no slug.
	 * `directory` plays no part: the slug names the repository, not the
	 * package inside it.
	 *
	 * @example
	 * ```ts
	 * import { Repository } from "@effected/package-json";
	 * import { Option, Schema } from "effect";
	 *
	 * const repo = Schema.decodeUnknownSync(Repository.FromValue)("git@github.com:effected/kit.git");
	 * const slug = Option.getOrThrow(repo.slug);
	 * console.log(slug.host, slug.path);
	 * // => github.com effected/kit
	 * ```
	 */
	get slug(): Option.Option<RepositorySlug> {
		return slugOf(this.url);
	}

	/** The canonical https clone URL, or none when it cannot be derived. */
	get gitUrl(): Option.Option<string> {
		return Option.map(this.browseUrl, (url) => `${url}.git`);
	}

	/**
	 * The browsable URL of **this package** — {@link Repository.browseUrl}
	 * descended into `directory` when the package is a monorepo
	 * member.
	 *
	 * @remarks
	 * Prefer this over `browseUrl` whenever the question is "where does this
	 * package live". For a monorepo, `browseUrl` answers with the repository
	 * root, so every member of the repository reports the same location — which
	 * matters because that URL is exactly what a consumer (a docs site's
	 * structured data, say) uses to tell two packages apart.
	 *
	 * The three outcomes are deliberately distinct:
	 *
	 * - **No `directory`** — the package *is* the repository root, so this is
	 *   `browseUrl`. A correct answer, not a missing one.
	 * - **`directory` on a host this model knows** (GitHub, GitLab, Bitbucket) —
	 *   the descended URL.
	 * - **`directory` on any other host** — `Option.none()`. The path convention
	 *   for browsing a subdirectory is per-forge and cannot be guessed, and
	 *   fabricating one would produce a URL that resolves to nothing while
	 *   looking authoritative.
	 *
	 * What to do with that `none` is a policy this getter deliberately leaves to
	 * the caller, because it depends on what is being filled in. Falling back to
	 * {@link Repository.browseUrl} is reasonable wherever a less precise answer
	 * beats no answer — the repository root is a *true* location for the package,
	 * merely one that does not distinguish it from its siblings. Omit the value
	 * instead wherever that lack of distinction is the whole point. What is never
	 * reasonable is inventing a subdirectory path for a host this model does not
	 * recognize, which is the case this `none` exists to prevent.
	 *
	 * A `directory` that escapes the repository (any `..` segment) is refused the
	 * same way. One that resolves to the root itself (`"."`, `"/"`) is the root.
	 *
	 * @example
	 * ```ts
	 * import { Repository } from "@effected/package-json";
	 * import { Schema } from "effect";
	 *
	 * const repo = Schema.decodeUnknownSync(Repository.FromValue)({
	 *   url: "effected/kit",
	 *   directory: "packages/spdx",
	 * });
	 * repo.directoryUrl;
	 * // => Option.some("https://github.com/effected/kit/tree/HEAD/packages/spdx")
	 * ```
	 */
	get directoryUrl(): Option.Option<string> {
		const directory = this.directory;
		if (directory === undefined) return this.browseUrl;

		const segments = directory
			.split("/")
			.map((segment) => segment.trim())
			.filter((segment) => segment !== "" && segment !== ".");
		// `..` would climb out of the repository the manifest names.
		if (segments.some((segment) => segment === "..")) return Option.none();
		// `"."`, `"/"`, `""` — the member is the root after all.
		if (segments.length === 0) return this.browseUrl;

		return Option.flatMap(this.browseUrl, (url) => {
			const host = /^https:\/\/([^/]+)/.exec(url)?.[1];
			const path = host === undefined ? undefined : DIRECTORY_PATHS.get(host);
			if (path === undefined) return Option.none();
			return Option.some(`${url}/${path}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`);
		});
	}

	/**
	 * The `repository` field: the shorthand string or the object form, always
	 * decoded to a {@link Repository}, and always re-encoded in the form it was
	 * read from.
	 */
	static readonly FromValue: Schema.Codec<Repository, string | { readonly [k: string]: unknown }> = Schema.Union([
		Schema.Record(Schema.String, Schema.Unknown),
		Schema.String,
	]).pipe(
		Schema.decodeTo(
			Schema.instanceOf(Repository),
			SchemaTransformation.transform({
				decode: (input: string | { readonly [k: string]: unknown }): Repository => {
					if (typeof input === "string") {
						const repository = Repository.make({ url: input });
						repositoryWires.set(repository, input);
						return repository;
					}
					const rest: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(input)) {
						if (!KNOWN_REPOSITORY_KEYS.has(key)) rest[key] = value;
					}
					const repository = Repository.make({
						url: typeof input.url === "string" ? input.url : "",
						...(typeof input.type === "string" && { type: input.type }),
						...(typeof input.directory === "string" && { directory: input.directory }),
						...(Object.keys(rest).length > 0 && { rest }),
					});
					repositoryWires.set(repository, input);
					return repository;
				},
				encode: (repository: Repository): string | { readonly [k: string]: unknown } => {
					const wire = repositoryWires.get(repository);
					// Replay the shorthand only while it still describes this value —
					// an edited url must not re-encode as the stale original.
					if (typeof wire === "string" && wire === repository.url && isStringExpressibleRepository(repository))
						return wire;
					if (wire !== undefined && typeof wire !== "string" && isFaithfulRepository(wire, repository)) return wire;
					return {
						...(repository.type !== undefined && { type: repository.type }),
						url: repository.url,
						...(repository.directory !== undefined && { directory: repository.directory }),
						...repository.rest,
					};
				},
			}),
		),
	);
}

/**
 * Where to report problems with a package.
 *
 * @remarks
 * npm permits a bare URL string, or an object with `url`, `email`, or both —
 * an email-only entry is legal, which is why `url` is optional.
 *
 * @public
 */
export class Bugs extends Schema.Class<Bugs>("Bugs")({
	/** The issue-tracker URL. */
	url: Schema.optionalKey(Schema.String),
	/** The address to mail instead of, or alongside, filing an issue. */
	email: Schema.optionalKey(Schema.String),
	/** Keys outside the documented set, preserved so encoding does not drop them. */
	rest: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {
	/** The `bugs` field: a URL string or the object form. */
	static readonly FromValue: Schema.Codec<Bugs, string | { readonly [k: string]: unknown }> = Schema.Union([
		Schema.Record(Schema.String, Schema.Unknown),
		Schema.String,
	]).pipe(
		Schema.decodeTo(
			Schema.instanceOf(Bugs),
			SchemaTransformation.transform({
				decode: (input: string | { readonly [k: string]: unknown }): Bugs => {
					if (typeof input === "string") {
						const bugs = Bugs.make({ url: input });
						bugsWires.set(bugs, input);
						return bugs;
					}
					const rest: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(input)) {
						if (!KNOWN_BUGS_KEYS.has(key)) rest[key] = value;
					}
					const bugs = Bugs.make({
						...(typeof input.url === "string" && { url: input.url }),
						...(typeof input.email === "string" && { email: input.email }),
						...(Object.keys(rest).length > 0 && { rest }),
					});
					bugsWires.set(bugs, input);
					return bugs;
				},
				encode: (bugs: Bugs): string | { readonly [k: string]: unknown } => {
					const wire = bugsWires.get(bugs);
					if (typeof wire === "string" && wire === bugs.url && isStringExpressibleBugs(bugs)) return wire;
					if (wire !== undefined && typeof wire !== "string" && isFaithfulBugs(wire, bugs)) return wire;
					return {
						...(bugs.url !== undefined && { url: bugs.url }),
						...(bugs.email !== undefined && { email: bugs.email }),
						...bugs.rest,
					};
				},
			}),
		),
	);
}
