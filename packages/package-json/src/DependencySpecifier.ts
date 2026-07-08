/**
 * The single dependency-specifier concept: the {@link DependencySpecifier}
 * branded schema, the protocol {@link DependencySpecifier.protocolOf | taxonomy}
 * statics (merging v3's two drifting classifiers into one source of truth), a
 * typed {@link DependencySpecifier.decode | decode} helper, and the
 * {@link InvalidDependencySpecifierError} the concept raises.
 *
 * Range detection decodes `@effected/semver`'s `Range.FromString` **purely**
 * via {@link Schema.decodeUnknownExit} — no `Effect.runSync` inside a getter.
 *
 * @packageDocumentation
 */

import { Range } from "@effected/semver";
import type { Brand, Cause } from "effect";
import { Effect, Exit, Option, Schema } from "effect";

/**
 * Schema-generated base class backing {@link InvalidDependencySpecifierError}.
 * Not meant to be referenced directly — named and exported only so API
 * Extractor can resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const InvalidDependencySpecifierError_base: Schema.Class<
	InvalidDependencySpecifierError,
	Schema.TaggedStruct<"InvalidDependencySpecifierError", { readonly input: typeof Schema.String }>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<InvalidDependencySpecifierError>()("InvalidDependencySpecifierError", {
	/** The raw input string that failed validation. */
	input: Schema.String,
});

/**
 * Indicates that a string could not be parsed as a valid dependency specifier.
 *
 * Raised by {@link DependencySpecifier.decode}. The offending string is
 * preserved on `input`.
 *
 * @public
 */
export class InvalidDependencySpecifierError extends InvalidDependencySpecifierError_base {
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
const isCatalog = (value: string): boolean => value.startsWith("catalog:");
const isWorkspace = (value: string): boolean => value.startsWith("workspace:");
const isUrl = (value: string): boolean => value.startsWith("http://") || value.startsWith("https://");

// Pure Option-returning range parse: decode `Range.FromString` synchronously via
// an Exit, never running an Effect inside a getter.
const parseRange = (value: string): Option.Option<Range> => {
	const exit = Schema.decodeUnknownExit(Range.FromString)(value);
	return Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none();
};

const isRange = (value: string): boolean => Option.isSome(parseRange(value));

const protocolOf = (value: string): DependencyProtocol => {
	if (value.startsWith("catalog:")) return "catalog";
	if (value.startsWith("workspace:")) return "workspace";
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
export const isValidDependencySpecifier = (value: string): boolean => {
	if (value.length === 0) return false;
	if (
		value.startsWith("file:") ||
		value.startsWith("link:") ||
		value.startsWith("portal:") ||
		value.startsWith("git+") ||
		value.startsWith("git://") ||
		value.startsWith("github:") ||
		value.startsWith("gist:") ||
		value.startsWith("bitbucket:") ||
		value.startsWith("gitlab:") ||
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value.startsWith("npm:") ||
		value.startsWith("catalog:") ||
		value.startsWith("workspace:")
	) {
		return true;
	}
	// GitHub shorthand: user/repo or user/repo#ref
	if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(#.*)?$/.test(value)) return true;
	// Semver-ish: starts with a range-leading character
	if (/^[\d^~>=<*|xX]/.test(value)) return true;
	// Dist-tags: alphanumeric strings like "latest", "next", "beta"
	if (/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(value)) return true;
	return false;
};

/** Taxonomy statics attached to the {@link DependencySpecifier} schema value. */
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
 * A valid dependency version specifier, carrying the protocol
 * {@link DependencySpecifier.protocolOf | taxonomy} statics that classify any
 * specifier string. Use it as a schema for a specifier field and reach for the
 * statics to inspect a raw string.
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
} satisfies DependencySpecifierStatics);
