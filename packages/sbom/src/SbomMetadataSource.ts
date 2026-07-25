// Manifest → CycloneDX derivation.
//
// The predecessor's `infer-sbom-metadata.ts` was 282 lines doing three jobs.
// Two of them are gone rather than ported: `parseAuthor` is
// `@effected/package-json`'s `Person.FromValue`, and `parseRepository`'s
// four-substitution git-URL regex chain is `Repository.browseUrl` — both with
// wire fidelity the hand-roll lacked, and both serving consumers with no SBOM
// interest at all. What is left here is the part that is genuinely CycloneDX
// vocabulary: which manifest field becomes which external-reference type, how a
// supplier and publisher resolve, and what a purl looks like.
//
// The third job — layering an explicit config file over inferred values — is
// NOT here. Precedence is release policy and the config file is the consumer's;
// this module offers derivation and `merge`, and which side wins is the
// caller's call.
//
// Everything is total. Nothing reads an ambient clock or environment: a
// timestamp is an argument, and so is the copyright year.

import type { Package, Person } from "@effected/package-json";
import { Option } from "effect";
import type { ComponentType } from "./SbomDocument.js";
import { Component, Contact, ExternalReference, SbomMetadata, Supplier } from "./SbomDocument.js";

// ── Package URL ───────────────────────────────────────────────────────────
//
// For npm, an `@scope` is the purl NAMESPACE, not part of the name. The
// canonical form is `pkg:npm/%40angular/animation@12.3.1` — the `@`
// percent-encoded, the separating slash kept literal — which is the
// package-url spec's own roundtrip vector (`tests/types/npm-test.json`) and
// what its npm type definition states ("the npm scope @ sign prefix is always
// percent encoded"). The predecessor wrote `encodeURIComponent(name)`,
// collapsing that slash to `%2F`; the result parses back as a namespace-less
// name and is not a canonical purl.
//
// Versions pass through verbatim: every character semver permits
// (`0-9A-Za-z.+-`) is a legal RFC 3986 path character — `+` is a sub-delim — so
// encoding them would produce a longer string meaning the same thing and
// matching no published example.

/** The purl namespace and name segments for an npm package name. */
const purlSegments = (name: string): string => {
	const separator = name.lastIndexOf("/");
	if (!name.startsWith("@") || separator <= 0) return encodeURIComponent(name);
	return `${encodeURIComponent(name.slice(0, separator))}/${encodeURIComponent(name.slice(separator + 1))}`;
};

/**
 * The canonical npm package URL for a name and optional version.
 *
 * @remarks
 * The NTIA's "unique identifier" element, and the identifier an in-toto subject
 * names. Exposed because a caller assembling its own components — or a
 * statement subject — needs the same encoding this module applies.
 */
const npmPurl = (name: string, version?: string): string => {
	const path = purlSegments(name);
	return version === undefined ? `pkg:npm/${path}` : `pkg:npm/${path}@${version}`;
};

/**
 * What a manifest cannot supply, and the two places an explicit value wins.
 *
 * @remarks
 * A `package.json` says who wrote the software. It never says which
 * organization supplied it, who assembled the BOM, or when — so `supplier`,
 * `authors` and `timestamp` are explicit-only. Deriving them would fabricate
 * three of the seven NTIA minimum elements.
 *
 * @public
 */
export interface SbomMetadataOptions {
	/** The supplying organization — NTIA minimum element 1. */
	readonly supplier?: Supplier;
	/** Who assembled the BOM — NTIA minimum element 6. */
	readonly authors?: ReadonlyArray<Contact>;
	/** When it was assembled — NTIA minimum element 7, as an ISO 8601 string. */
	readonly timestamp?: string;
	/** The publishing entity. Falls back to the supplier, then the manifest's author. */
	readonly publisher?: string;
	/** A copyright statement; {@link SbomMetadataSource.formatCopyright} builds one. */
	readonly copyright?: string;
	/** The documentation URL, winning over the manifest's `homepage`. */
	readonly documentationUrl?: string;
	/** The root component's type. Defaults to `library`. */
	readonly type?: ComponentType;
}

/**
 * The fields a dependency contributes to its component entry.
 *
 * @public
 */
export interface ComponentInput {
	/** The package name, scope included. */
	readonly name: string;
	/** Its resolved version. Absent produces a component with no version and no purl version segment. */
	readonly version?: string;
	/** An SPDX identifier or expression. */
	readonly license?: string;
	/** A short description. */
	readonly description?: string;
	/** The component type. Defaults to `library`. */
	readonly type?: ComponentType;
}

/** The years a copyright statement spans. */
export interface CopyrightYears {
	/** The first year of the range. Omit for a single-year statement. */
	readonly startYear?: number;
	/** The year the statement is current through — the caller's clock read, never ours. */
	readonly year: number;
}

const contactOf = (person: Person): Contact =>
	Contact.make({
		name: person.name,
		...(person.email !== undefined && { email: person.email }),
	});

/** The manifest's authors: its maintainers, or its lone author when it lists none. */
const authorsOf = (pkg: Package): ReadonlyArray<Contact> | undefined => {
	if (pkg.maintainers !== undefined && pkg.maintainers.length > 0) return pkg.maintainers.map(contactOf);
	return pkg.author === undefined ? undefined : [contactOf(pkg.author)];
};

/** The supplier's first URL, which becomes a `website` reference when it says something new. */
const supplierUrl = (options: SbomMetadataOptions | undefined): string | undefined => options?.supplier?.url?.[0];

const documentationUrl = (pkg: Package, options: SbomMetadataOptions | undefined): string | undefined =>
	options?.documentationUrl ?? pkg.homepage;

/**
 * The manifest's outward links, as CycloneDX external references.
 *
 * @remarks
 * Four of the specification's 43 types, one per manifest field: `vcs` ←
 * `repository`, `issue-tracker` ← `bugs`, `documentation` ← `homepage`,
 * `website` ← the supplier's first URL.
 *
 * A `repository` value the package-json model cannot interpret produces **no**
 * reference rather than a passed-through string: CycloneDX's
 * `externalReference.url` is a URL, and emitting `owner/name` there is a
 * document that validates and misleads.
 */
const externalReferences = (pkg: Package, options?: SbomMetadataOptions): ReadonlyArray<ExternalReference> => {
	const references: Array<ExternalReference> = [];

	const vcs = pkg.repository === undefined ? Option.none<string>() : pkg.repository.browseUrl;
	if (Option.isSome(vcs)) references.push(ExternalReference.make({ type: "vcs", url: vcs.value }));

	// An email-only `bugs` entry is legal npm and carries no URL to point at.
	if (pkg.bugs?.url !== undefined) {
		references.push(ExternalReference.make({ type: "issue-tracker", url: pkg.bugs.url }));
	}

	const documentation = documentationUrl(pkg, options);
	if (documentation !== undefined) {
		references.push(ExternalReference.make({ type: "documentation", url: documentation }));
	}

	const website = supplierUrl(options);
	if (website !== undefined && website !== documentation) {
		references.push(ExternalReference.make({ type: "website", url: website }));
	}

	return references;
};

/**
 * A component entry for one resolved dependency.
 *
 * @remarks
 * The caller assembles the component list — the kit has no second merge rule
 * for sibling packages released in the same wave, because which versions are
 * in flight is release planning and `@effected/workspaces` already knows it.
 * This is the mapping that would otherwise be re-derived at every call site.
 */
const componentFor = (input: ComponentInput): Component =>
	Component.make({
		type: input.type ?? "library",
		name: input.name,
		...(input.version !== undefined && { version: input.version }),
		purl: npmPurl(input.name, input.version),
		bomRef: input.version === undefined ? input.name : `${input.name}@${input.version}`,
		...(input.description !== undefined && { description: input.description }),
		...(input.license !== undefined && { licenses: [input.license] }),
	});

/**
 * The root component the BOM is about, derived from its own manifest.
 *
 * @remarks
 * `publisher` resolves explicit → supplier name → the manifest's author, which
 * is what lets NTIA element 6 be satisfied from a manifest alone.
 */
const rootComponent = (pkg: Package, options?: SbomMetadataOptions): Component => {
	const version = pkg.version.toString();
	const references = externalReferences(pkg, options);
	const authors = authorsOf(pkg);
	const publisher = options?.publisher ?? options?.supplier?.name ?? pkg.author?.name;

	return Component.make({
		type: options?.type ?? "library",
		name: pkg.name,
		version,
		purl: npmPurl(pkg.name, version),
		bomRef: `${pkg.name}@${version}`,
		...(pkg.description !== undefined && { description: pkg.description }),
		...(pkg.license !== undefined && { licenses: [pkg.license] }),
		...(references.length > 0 && { externalReferences: references }),
		...(pkg.keywords !== undefined && pkg.keywords.length > 0 && { tags: pkg.keywords }),
		...(authors !== undefined && { authors }),
		...(publisher !== undefined && { publisher }),
		...(options?.copyright !== undefined && { copyright: options.copyright }),
	});
};

/**
 * Document-level metadata for a manifest.
 *
 * @remarks
 * The root component is **not** on the returned value: `Sbom.generate` threads
 * its `root` argument onto the metadata itself, so setting it here would only
 * be overwritten. Build the root with {@link SbomMetadataSource.rootComponent}
 * and pass both.
 *
 * When the caller supplies a supplier with no contacts, the manifest's
 * maintainers fill them — the one derivation that crosses from manifest
 * vocabulary into supplier vocabulary, and only where the caller left a hole.
 */
const fromPackage = (pkg: Package, options?: SbomMetadataOptions): SbomMetadata => {
	const supplier = options?.supplier;
	const contacts = supplier?.contact ?? authorsOf(pkg);
	const resolved =
		supplier === undefined
			? undefined
			: Supplier.make({
					name: supplier.name,
					...(supplier.url !== undefined && { url: supplier.url }),
					...(contacts !== undefined && { contact: contacts }),
				});

	return SbomMetadata.make({
		...(options?.timestamp !== undefined && { timestamp: options.timestamp }),
		...(options?.authors !== undefined && { authors: options.authors }),
		...(resolved !== undefined && { supplier: resolved }),
	});
};

/**
 * A copyright statement for a holder and a year, or a span of years.
 *
 * @remarks
 * The year is an **argument**. The predecessor defaulted it to
 * `new Date().getFullYear()`, which made its output untestable and its purity a
 * claim rather than a property; the ambient read belongs at the caller's edge.
 */
const formatCopyright = (holder: string, years: CopyrightYears): string =>
	years.startYear === undefined || years.startYear === years.year
		? `Copyright ${years.year} ${holder}`
		: `Copyright ${years.startYear}-${years.year} ${holder}`;

/**
 * Field-wise metadata merge: every field the override carries wins.
 *
 * @remarks
 * A helper, not a policy. Which side is the override — a config file over
 * inferred values, or the reverse — is the consumer's precedence rule, and a
 * library that decided it would be encoding one repository's release policy.
 */
const merge = (base: SbomMetadata, override: SbomMetadata): SbomMetadata => {
	const timestamp = override.timestamp ?? base.timestamp;
	const authors = override.authors ?? base.authors;
	const component = override.component ?? base.component;
	const supplier = override.supplier ?? base.supplier;
	return SbomMetadata.make({
		...(timestamp !== undefined && { timestamp }),
		...(authors !== undefined && { authors }),
		...(component !== undefined && { component }),
		...(supplier !== undefined && { supplier }),
	});
};

/**
 * Derivation of CycloneDX metadata from a `package.json` manifest.
 *
 * @example
 * ```ts
 * import { Sbom, SbomMetadataSource } from "@effected/sbom";
 *
 * const root = SbomMetadataSource.rootComponent(pkg, { supplier });
 * const metadata = SbomMetadataSource.fromPackage(pkg, { supplier, timestamp });
 * const document = Sbom.generate({ root, components, metadata });
 * ```
 *
 * @public
 */
export const SbomMetadataSource = {
	npmPurl,
	componentFor,
	rootComponent,
	externalReferences,
	fromPackage,
	formatCopyright,
	merge,
} as const;
