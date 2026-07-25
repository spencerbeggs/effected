import { Schema } from "effect";

/**
 * Which well-known registry a URL points at.
 *
 * @remarks
 * The distinction is behavioral, not cosmetic: npm's `--provenance` is
 * meaningful only on the public npm registry, GitHub Packages needs classic
 * `_authToken` auth rather than a trusted-publisher exchange, and JSR is not
 * an npm-protocol registry at all — a JSR target must be routed away from the
 * npm publish path entirely.
 *
 * @public
 */
export const RegistryKind = Schema.Literals(["npm", "github-packages", "jsr", "custom"]);

/**
 * The decoded type of {@link (RegistryKind:variable)}.
 *
 * @public
 */
export type RegistryKind = typeof RegistryKind.Type;

/** The hostname of a registry URL, or `undefined` when it does not parse. */
const hostnameOf = (registry: string): string | undefined => {
	try {
		return new URL(registry).hostname.toLowerCase();
	} catch {
		// A bare host (`registry.npmjs.org/`) is not a URL; try again with a
		// scheme before giving up, because npm config values are written both ways.
		try {
			return new URL(`https://${registry}`).hostname.toLowerCase();
		} catch {
			return undefined;
		}
	}
};

/**
 * Whether `hostname` is `domain` or a subdomain of it.
 *
 * @remarks
 * The leading dot is load-bearing: a bare `endsWith(domain)` would classify
 * `evil-npmjs.org` as the public npm registry, and that classification decides
 * whether a token is sent and whether provenance is requested.
 */
const matchesDomain = (hostname: string | undefined, domain: string): boolean =>
	hostname !== undefined && (hostname === domain || hostname.endsWith(`.${domain}`));

/**
 * Classify a registry URL.
 *
 * @remarks
 * An absent registry classifies as `"npm"`: no registry configured means the
 * public npm registry, which is every npm client's default and this package's
 * {@link DEFAULT_REGISTRY}.
 *
 * This replaces the v3 helpers `isNpmRegistry` / `isGitHubPackagesRegistry` /
 * `isJsrRegistry` / `isCustomRegistry` with **one** classification, so a
 * consumer `switch`es exhaustively instead of composing four booleans that can
 * disagree — v3 had one call site asking two of them in sequence and another
 * negating a third to mean "everything else".
 *
 * @example
 * ```ts
 * const kind = classifyRegistry(target.registry);
 * if (kind === "jsr") return skipJsrTarget(target);
 * const provenance = kind === "npm";
 * ```
 *
 * @public
 */
export const classifyRegistry = (registry: string | undefined): RegistryKind => {
	if (registry === undefined || registry === "") return "npm";
	const hostname = hostnameOf(registry);
	if (matchesDomain(hostname, "npmjs.org")) return "npm";
	if (matchesDomain(hostname, "pkg.github.com")) return "github-packages";
	if (matchesDomain(hostname, "jsr.io")) return "jsr";
	return "custom";
};
