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

const stripGitSuffix = (value: string): string => (value.endsWith(".git") ? value.slice(0, -4) : value);

/**
 * The browsable `https://host/path` form of a repository reference, or none
 * when the value is not one this model recognizes.
 *
 * Total by construction: `repository` is caller data, and a value we cannot
 * interpret is a missing answer rather than a failure.
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
	// browse at `https://github.com/o/n` — the hand-rolled predecessor handled
	// the second and left the first with its scheme intact.
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

/** The wire value a repository or bugs entry was decoded from. */
type FieldWire = string | { readonly [k: string]: unknown };

const repositoryWires = new WeakMap<Repository, FieldWire>();
const bugsWires = new WeakMap<Bugs, FieldWire>();

const KNOWN_REPOSITORY_KEYS: ReadonlySet<string> = new Set(["type", "url", "directory"]);
const KNOWN_BUGS_KEYS: ReadonlySet<string> = new Set(["url", "email"]);

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
 * // "effected/kit" → https://github.com/effected/kit
 * // "git@github.com:effected/kit.git" → https://github.com/effected/kit
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

	/** The canonical https clone URL, or none when it cannot be derived. */
	get gitUrl(): Option.Option<string> {
		return Option.map(this.browseUrl, (url) => `${url}.git`);
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
					if (typeof wire === "string" && wire === repository.url) return wire;
					if (wire !== undefined && typeof wire !== "string") return wire;
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
					if (typeof wire === "string" && wire === bugs.url && bugs.email === undefined) return wire;
					if (wire !== undefined && typeof wire !== "string") return wire;
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
