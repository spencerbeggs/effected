// The single dependency-specifier concept, relocated from `@effected/package-json`.
//
// Two forms sit side by side and share one classifier:
//   - the branded `DependencySpecifier` schema + its protocol taxonomy statics
//     (`DependencySpecifier.protocolOf` and friends, classifying eleven
//     protocols), the fine-grained view package-json's `Dependency` reads; and
//   - a coarse tagged union (`catalog | workspace | range | dist-tag | raw`)
//     that resolvers and lockfile importers pattern-match on, reached through
//     the `DependencySpecifier.FromString` codec.
//
// The union is *decoded from the brand*: `FromString.decode` validates a string
// through the same taxonomy the brand uses, then groups the eleven protocols
// into the five resolver-relevant cases. Every case stores the original `raw`
// string, so `FromString.encode` returns the input byte-for-byte — the
// exact-string round-trip guarantee brownfield consumers rely on.
//
// Range detection decodes `@effected/semver`'s `Range.FromString` purely via
// `Schema.decodeUnknownExit` — no `Effect.runSync` inside a getter. The
// `@effected/semver` edge is pure-to-pure, so this package stays pure tier.

import { Range } from "@effected/semver";
import type { Brand } from "effect";
import { Effect, Exit, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";

/**
 * Indicates that a string could not be parsed as a valid dependency specifier.
 *
 * Raised by {@link DependencySpecifier.decode}. The offending string is
 * preserved on `input`.
 *
 * @public
 */
export class InvalidDependencySpecifierError extends Schema.TaggedErrorClass<InvalidDependencySpecifierError>()(
	"InvalidDependencySpecifierError",
	{
		/** The raw input string that failed validation. */
		input: Schema.String,
	},
) {
	override get message(): string {
		return `Invalid dependency specifier "${this.input}": not a recognized specifier`;
	}
}

/**
 * The classification of a dependency specifier's protocol.
 *
 * @public
 */
export type DependencyProtocol =
	| "range"
	| "tag"
	| "git"
	| "url"
	| "npm"
	| "file"
	| "link"
	| "portal"
	| "catalog"
	| "workspace"
	| "unknown";

const CATALOG_PREFIX = "catalog:";
const WORKSPACE_PREFIX = "workspace:";

const isBarePath = (value: string): boolean =>
	value.startsWith("./") || value.startsWith("../") || value.startsWith("~/") || value.startsWith("/");

// Bare GitHub shorthand `user/repo[#ref]`, excluding local-path-looking strings.
const isGitHubShorthand = (value: string): boolean =>
	!value.startsWith(".") &&
	!value.startsWith("~") &&
	!value.startsWith("/") &&
	/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(#.*)?$/.test(value);

const isGit = (value: string): boolean =>
	value.startsWith("git+") ||
	value.startsWith("git://") ||
	value.startsWith("github:") ||
	value.startsWith("gist:") ||
	value.startsWith("bitbucket:") ||
	value.startsWith("gitlab:") ||
	isGitHubShorthand(value);

const isLocal = (value: string): boolean =>
	value.startsWith("file:") || value.startsWith("link:") || value.startsWith("portal:") || isBarePath(value);

const isLink = (value: string): boolean => value.startsWith("link:");
const isPortal = (value: string): boolean => value.startsWith("portal:");
const isCatalog = (value: string): boolean => value.startsWith(CATALOG_PREFIX);
const isWorkspace = (value: string): boolean => value.startsWith(WORKSPACE_PREFIX);
const isUrl = (value: string): boolean => value.startsWith("http://") || value.startsWith("https://");

// Pure Option-returning range parse: decode `Range.FromString` synchronously via
// an Exit, never running an Effect inside a getter.
const parseRange = (value: string): Option.Option<Range> => {
	const exit = Schema.decodeUnknownExit(Range.FromString)(value);
	return Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none();
};

const isRange = (value: string): boolean => Option.isSome(parseRange(value));

const protocolOf = (value: string): DependencyProtocol => {
	if (value.startsWith(CATALOG_PREFIX)) return "catalog";
	if (value.startsWith(WORKSPACE_PREFIX)) return "workspace";
	if (value.startsWith("link:")) return "link";
	if (value.startsWith("portal:")) return "portal";
	if (value.startsWith("file:") || isBarePath(value)) return "file";
	if (value.startsWith("npm:")) return "npm";
	if (isGit(value)) return "git";
	if (isUrl(value)) return "url";
	if (isRange(value)) return "range";
	if (/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(value)) return "tag";
	return "unknown";
};

const isTag = (value: string): boolean => protocolOf(value) === "tag";

/**
 * Whether a string is a recognized dependency specifier: a semver range, exact
 * version, dist-tag, URL, git ref, GitHub shorthand, file path, or an
 * `npm:` / `catalog:` / `workspace:` protocol.
 *
 * @public
 */
export const isValidDependencySpecifier = (value: string): boolean =>
	value.length > 0 && protocolOf(value) !== "unknown";

/**
 * A `catalog:` reference. `name` carries the catalog name, or `Option.none()`
 * for the default catalog (`catalog:`).
 *
 * @public
 */
export class CatalogSpecifier extends Schema.TaggedClass<CatalogSpecifier>()("catalog", {
	/** The original specifier string. */
	raw: Schema.String,
	/** The catalog name, or `Option.none()` for the default catalog. */
	name: Schema.Option(Schema.String),
}) {}

/**
 * A `workspace:` reference. `range` carries the part after `workspace:` — a
 * range modifier (`*`, `^`, `~`), a concrete range, or an alias form.
 *
 * @public
 */
export class WorkspaceSpecifier extends Schema.TaggedClass<WorkspaceSpecifier>()("workspace", {
	/** The original specifier string. */
	raw: Schema.String,
	/** The part after `workspace:` (e.g. `*`, `^1.2.3`, or an alias form). */
	range: Schema.String,
}) {}

/**
 * A plain semver range or exact version (e.g. `^1.2.3`, `1.x`, `>=1 <2`).
 *
 * @public
 */
export class RangeSpecifier extends Schema.TaggedClass<RangeSpecifier>()("range", {
	/** The original specifier string. */
	raw: Schema.String,
}) {}

/**
 * A bare dist-tag (e.g. `latest`, `next`).
 *
 * @public
 */
export class DistTagSpecifier extends Schema.TaggedClass<DistTagSpecifier>()("dist-tag", {
	/** The original specifier string (also the tag name). */
	raw: Schema.String,
}) {}

/**
 * The honest fallback for `file:` / `link:` / `portal:` / git / URL / `npm:`
 * forms this concept does not further interpret.
 *
 * @public
 */
export class RawSpecifier extends Schema.TaggedClass<RawSpecifier>()("raw", {
	/** The original specifier string. */
	raw: Schema.String,
}) {}

/**
 * A dependency specifier classified into one of the five resolver-relevant
 * cases. Decoded from a string by {@link DependencySpecifier.FromString};
 * every case preserves the original `raw` string.
 *
 * @public
 */
export type ClassifiedSpecifier =
	| CatalogSpecifier
	| WorkspaceSpecifier
	| RangeSpecifier
	| DistTagSpecifier
	| RawSpecifier;

const Classified = Schema.Union([CatalogSpecifier, WorkspaceSpecifier, RangeSpecifier, DistTagSpecifier, RawSpecifier]);

// Group a *valid* specifier into one of the five coarse cases, reusing the
// taxonomy predicates above. Order matters: catalog/workspace prefixes first,
// then a parseable range, then a bare tag, with everything else (git, url,
// file, link, portal, npm) preserved as `raw`.
const classify = (value: string): ClassifiedSpecifier => {
	if (isCatalog(value)) {
		const rest = value.slice(CATALOG_PREFIX.length);
		return CatalogSpecifier.make({ raw: value, name: rest.length === 0 ? Option.none() : Option.some(rest) });
	}
	if (isWorkspace(value)) {
		return WorkspaceSpecifier.make({ raw: value, range: value.slice(WORKSPACE_PREFIX.length) });
	}
	if (isRange(value)) return RangeSpecifier.make({ raw: value });
	if (isTag(value)) return DistTagSpecifier.make({ raw: value });
	return RawSpecifier.make({ raw: value });
};

const fromString: Schema.Codec<ClassifiedSpecifier, string> = Schema.String.pipe(
	Schema.decodeTo(
		Classified,
		SchemaTransformation.transformOrFail({
			decode: (input: string) =>
				isValidDependencySpecifier(input)
					? Effect.succeed(classify(input))
					: Effect.fail(
							new SchemaIssue.InvalidValue(Option.some(input), {
								message: `Invalid dependency specifier: "${input}"`,
							}),
						),
			encode: (classified: ClassifiedSpecifier) => Effect.succeed(classified.raw),
		}),
	),
);

/** Taxonomy statics attached to the `DependencySpecifier` schema value. */
interface DependencySpecifierStatics {
	/** Classify a specifier into a single protocol; `"unknown"` for unrecognized input. */
	readonly protocolOf: (value: string) => DependencyProtocol;
	/** Parse the specifier as a semver `Range`, `None` when it is not a range. Pure. */
	readonly parseRange: (value: string) => Option.Option<Range>;
	/** Whether the specifier is a parseable semver range. */
	readonly isRange: (value: string) => boolean;
	/** Whether the specifier is a dist-tag (`latest`, `next`, ...). */
	readonly isTag: (value: string) => boolean;
	/** Whether the specifier resolves to a git source (URLs and hosted-git shorthands). */
	readonly isGit: (value: string) => boolean;
	/** Whether the specifier is an HTTP(S) URL. */
	readonly isUrl: (value: string) => boolean;
	/** Whether the specifier points to a local path (`file:`/`link:`/`portal:` or a bare path). */
	readonly isLocal: (value: string) => boolean;
	/** Whether the specifier uses the `link:` protocol. */
	readonly isLink: (value: string) => boolean;
	/** Whether the specifier uses the `portal:` protocol. */
	readonly isPortal: (value: string) => boolean;
	/** Whether the specifier uses the `catalog:` protocol. */
	readonly isCatalog: (value: string) => boolean;
	/** Whether the specifier uses the `workspace:` protocol. */
	readonly isWorkspace: (value: string) => boolean;
	/** Whether the string is a valid dependency specifier. */
	readonly isValid: (value: string) => boolean;
	/** Validate a string, failing with a typed {@link InvalidDependencySpecifierError}. */
	readonly decode: (input: string) => Effect.Effect<DependencySpecifierBrand, InvalidDependencySpecifierError>;
	/**
	 * Codec between a specifier string and a {@link ClassifiedSpecifier} tagged
	 * union. Decoding classifies; encoding returns the original `raw` string
	 * byte-for-byte.
	 */
	readonly FromString: Schema.Codec<ClassifiedSpecifier, string>;
}

/**
 * The branded dependency-specifier type: any string `DependencySpecifier`
 * validates.
 *
 * @public
 */
export type DependencySpecifierBrand = string & Brand.Brand<"DependencySpecifier">;

const brandedSpecifier = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			isValidDependencySpecifier(value) ? undefined : "Expected a valid dependency specifier",
		),
	),
	Schema.brand("DependencySpecifier"),
);

const decode = (input: string): Effect.Effect<DependencySpecifierBrand, InvalidDependencySpecifierError> =>
	Schema.decodeUnknownEffect(brandedSpecifier)(input).pipe(
		Effect.mapError(() => new InvalidDependencySpecifierError({ input })),
	);

/**
 * A valid dependency version specifier, carrying the protocol taxonomy statics
 * (`DependencySpecifier.protocolOf` and friends) that classify any specifier
 * string, plus the {@link (DependencySpecifier:variable).FromString} codec that
 * decodes a string into a {@link ClassifiedSpecifier} tagged union. Use it as a
 * schema for a specifier field and reach for the statics to inspect a raw
 * string.
 *
 * @public
 */
export const DependencySpecifier = Object.assign(brandedSpecifier, {
	protocolOf,
	parseRange,
	isRange,
	isTag,
	isGit,
	isUrl,
	isLocal,
	isLink,
	isPortal,
	isCatalog,
	isWorkspace,
	isValid: isValidDependencySpecifier,
	decode,
	FromString: fromString,
} satisfies DependencySpecifierStatics);
