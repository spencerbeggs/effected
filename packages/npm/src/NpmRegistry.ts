import { HttpRedaction } from "@effected/crypto";
import { Context, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import type { HttpClientError } from "effect/http";
import { HttpClient } from "effect/http";
import { IntegrityHash } from "./IntegrityHash.js";
import type { RegistryCredential } from "./RegistryCredential.js";
import { classifyRegistry } from "./RegistryKind.js";

/**
 * The public npm registry, used when a read names no other.
 *
 * @public
 */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * Which registry to read from, and how to authenticate.
 *
 * @remarks
 * **Per call, never baked into the layer.** A publish flow probes two
 * registries for one package inside a single program, so a layer-scoped
 * registry cannot express what consumers actually do — and a test double
 * keyed without the registry could not express it either.
 *
 * @public
 */
export interface RegistryTarget {
	/** Registry base URL. Defaults to {@link DEFAULT_REGISTRY}. */
	readonly registry?: string | undefined;
	/**
	 * Superseded by {@link RegistryTarget.credential}.
	 *
	 * @deprecated Use `credential: { kind: "token", token }`. This field is
	 * typed `never` **as a tripwire, not as an alias**:
	 * removing it outright would be a SILENT break rather than a loud one.
	 * Callers commonly pass it through a conditional spread —
	 * `...(token !== null ? { token } : {})` — and a spread of a no-longer-known
	 * property is not an excess-property error, so the field would simply vanish
	 * and an authenticated probe would become an anonymous one. Against a private
	 * registry that answers 401, `NpmRegistry.version` reads that as "not
	 * published", and a publish flow acting on it republishes a version that
	 * already exists. Typed `never`, the same spread fails to compile.
	 */
	readonly token?: never;
	/**
	 * How to authenticate, for a registry that requires auth to read.
	 *
	 * @remarks
	 * The same token/basic union `PackagePublish.setupAuth` writes into an
	 * npmrc, so the read probe and the publish cannot disagree about the
	 * scheme for one registry — a bearer probe against a basic-auth registry
	 * answers 401 and reads as "not published". The publish-only
	 * `WorkloadCredential` is deliberately not accepted here: it fails to
	 * compile, and a read that is handed one through a cast fails
	 * {@link RegistryReadError} with kind `"credential"` before any request.
	 */
	readonly credential?: RegistryCredential | undefined;
}

/**
 * One published version of one package, on one registry.
 *
 * @public
 */
export class PublishedVersion extends Schema.Class<PublishedVersion>("PublishedVersion")({
	/** The package name as the registry reports it. */
	name: Schema.String,
	/** The version as the registry reports it. */
	version: Schema.String,
	/** The published integrity, when the registry recorded one. */
	integrity: Schema.optionalKey(IntegrityHash),
	/** The tarball URL, when the registry recorded one. */
	tarball: Schema.optionalKey(Schema.String),
}) {}

/**
 * The dependency-shaped fields of one published version's manifest, as the
 * registry serves them.
 *
 * @remarks
 * What a resolver needs to ask of a candidate version before it picks one —
 * its peers above all — read through the same registry, auth and routing as
 * {@link NpmRegistryShape.version}, so the version list and the peer table can
 * never come from two registry paths that disagree. A separate class rather
 * than more fields on {@link PublishedVersion}: a version probe does not pay
 * to validate dependency records it never reads, and a malformed record in an
 * old version cannot turn a "is this published?" answer into a failure.
 *
 * Every field but `name` and `version` is absent when the document does not
 * carry it, never an empty record: "declares no peers" and "the registry did
 * not say" are the same answer on the wire, and an `{}` here would claim more
 * than the document did.
 *
 * The class is also the decoder: `Schema.decodeUnknownEffect(VersionManifest)`
 * over a version document (from a packument's `versions` map or the
 * per-version endpoint) is exactly what {@link NpmRegistryShape.manifest}
 * runs, apart from `engines` (see the field). Unknown keys are ignored.
 *
 * @public
 */
export class VersionManifest extends Schema.Class<VersionManifest>("VersionManifest")({
	/** The package name as the version document reports it. */
	name: Schema.String,
	/** The version as the version document reports it. */
	version: Schema.String,
	/** `dependencies`: package name → specifier. */
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	/** `peerDependencies`: package name → range. */
	peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	/** `optionalDependencies`: package name → specifier. */
	optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	/** `peerDependenciesMeta`: peer name → its metadata (`optional`). Other keys a publisher wrote are dropped. */
	peerDependenciesMeta: Schema.optionalKey(
		Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
	),
	/**
	 * `engines`: engine name → range.
	 *
	 * @remarks
	 * {@link NpmRegistryShape.manifest} keeps this only when the document holds
	 * a string → string record and otherwise omits it: old publishes carry the
	 * legacy array form (`["node >= 0.8"]`), and an advisory field in a form
	 * nothing reads must not fail the peer read of a version that resolves
	 * fine. The four dependency fields get no such leniency — a malformed one
	 * fails the read with kind `"decode"`, because reading it as absent would
	 * answer "no peers" for a version that has them.
	 */
	engines: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}) {}

/**
 * When one version of a package was published.
 *
 * @remarks
 * A class rather than a bare `version → timestamp` record because the
 * registry's `time` object mixes per-version entries with two non-version keys
 * (`created`, `modified`), and every consumer that reads it raw has to
 * re-derive that exclusion.
 *
 * @public
 */
export class PublishTime extends Schema.Class<PublishTime>("PublishTime")({
	/** The version this timestamp belongs to. */
	version: Schema.String,
	/** When it was published. */
	publishedAt: Schema.DateTimeUtc,
}) {}

/**
 * A registry read failed.
 *
 * @remarks
 * `kind` is the routing surface: `"transport"` (the request never produced a
 * response), `"status"` (the registry answered, unsuccessfully — `status`
 * carries the code), `"decode"` (the body was not what the registry protocol
 * says it is), `"credential"` (the target carried a publish-only workload
 * credential, refused before any request was sent). **A 404 is not here**:
 * an absent package or version is `Option.none()`, extending the
 * `None`-is-success convention this package's resolver contracts already use.
 *
 * @public
 */
export class RegistryReadError extends Schema.TaggedError<RegistryReadError>()("RegistryReadError", {
	/** Why the read failed. */
	kind: Schema.Literals(["transport", "status", "decode", "credential"]),
	/** The package that was being read. */
	package: Schema.String,
	/** The registry that was being read from, with any userinfo and credential query values redacted. */
	registry: Schema.String,
	/** The HTTP status, for `kind: "status"`. */
	status: Schema.optionalKey(Schema.Number),
	/** The underlying failure. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const where = `${this.package} on ${this.registry}`;
		// One arm per kind, no catch-all: a new kind must get its own text rather
		// than silently reading as the last arm's.
		return this.kind === "transport"
			? `Could not reach the registry for ${where}`
			: this.kind === "status"
				? `Registry read for ${where} failed with status ${this.status ?? "unknown"}`
				: this.kind === "decode"
					? `Registry read for ${where} returned an unreadable body`
					: `Registry read for ${where} refused a workload credential: it is publish-only, pass a token or basic credential to read`;
	}
}

/**
 * The `Authorization` header for a credential, or none at all.
 *
 * @remarks
 * The scheme follows the credential's kind rather than being fixed, matching
 * what npm sends for the same npmrc entry: a `_authToken` goes out as `Bearer`
 * and an `_auth` blob as `Basic`, used verbatim with no re-encoding.
 */
const authorizationHeader = (credential: RegistryCredential | undefined): Record<string, string> => {
	if (credential === undefined) return {};
	switch (credential.kind) {
		case "token":
			return { authorization: `Bearer ${Redacted.value(credential.token)}` };
		case "basic":
			return { authorization: `Basic ${Redacted.value(credential.encoded)}` };
	}
};

/**
 * Fails a read whose target carries a workload credential, before any request.
 *
 * @remarks
 * The type already refuses one — `RegistryTarget.credential` is the
 * token/basic union — so this is for a caller that cast past it or is not
 * type-checked. The kind is widened to `string` on purpose: compared at its
 * declared type, `"workload"` has no overlap and the check would not compile.
 * Shared by the live service and the seeded double, so the two cannot diverge.
 */
const refuseWorkload = (
	target: RegistryTarget | undefined,
	name: string,
	registry: string,
): Effect.Effect<void, RegistryReadError> => {
	const kind: string | undefined = target?.credential?.kind;
	return kind === "workload"
		? Effect.fail(new RegistryReadError({ kind: "credential", package: name, registry: HttpRedaction.url(registry) }))
		: Effect.void;
};

/** The version-document fields `version` reads. Unknown keys are ignored. */
const VersionDocument = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	dist: Schema.optionalKey(
		Schema.Struct({
			integrity: Schema.optionalKey(Schema.String),
			tarball: Schema.optionalKey(Schema.String),
		}),
	),
});

/**
 * The version-document fields `manifest` reads: {@link VersionManifest}'s, with
 * `engines` taken as-is so its legacy array form is dropped rather than fatal.
 */
const ManifestDocument = Schema.Struct({ ...VersionManifest.fields, engines: Schema.optionalKey(Schema.Unknown) });

/** The only `engines` form {@link VersionManifest} keeps. */
const isEnginesRecord = Schema.is(Schema.Record(Schema.String, Schema.String));

/**
 * The packument fields this package reads. Unknown keys are ignored.
 *
 * @remarks
 * `time` values are `Unknown` because the map is not all timestamps: a fully
 * unpublished package carries `time.unpublished` as an object (`{ time,
 * versions }`), and a strict string record would fail that packument's every
 * read as `"decode"` instead of answering "known, no versions".
 */
const Packument = Schema.Struct({
	"dist-tags": Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	versions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
	time: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

/** The two `time` keys that are not versions. */
const NON_VERSION_TIME_KEYS = new Set(["created", "modified"]);

/**
 * The `integrity` field for a `PublishedVersion`, present only when the raw
 * value is a valid integrity hash.
 *
 * @remarks
 * Validated through the brand's own schema rather than cast: a registry that
 * serves an integrity this package cannot classify yields *no* integrity, not
 * a lie and not a failed read. Returns a spreadable object so the caller never
 * passes an explicit `undefined` to an `optionalKey` field (which v4
 * constructors reject).
 */
const integrityField = (raw: string | undefined): { integrity?: typeof IntegrityHash.Type } =>
	raw === undefined
		? {}
		: Option.match(Schema.decodeUnknownOption(IntegrityHash)(raw), {
				onNone: () => ({}),
				onSome: (integrity) => ({ integrity }),
			});

/** `https://host` + `/@scope%2Fname` — the slash in a scoped name must be encoded. */
const packageUrl = (registry: string, name: string, version?: string): string => {
	const base = registry.endsWith("/") ? registry.slice(0, -1) : registry;
	const encoded = encodeURIComponent(name);
	return version === undefined ? `${base}/${encoded}` : `${base}/${encoded}/${encodeURIComponent(version)}`;
};

/**
 * The {@link NpmRegistry} service shape.
 *
 * @public
 */
export interface NpmRegistryShape {
	/**
	 * One published version, or `None` when that version is not on that registry.
	 *
	 * @remarks
	 * A `github-packages` target is read through the packument (GitHub Packages
	 * answers the per-version endpoint with 405 regardless of credentials); any
	 * other registry answering 405 on the per-version path is retried the same
	 * way.
	 */
	readonly version: (
		name: string,
		version: string,
		target?: RegistryTarget,
	) => Effect.Effect<Option.Option<PublishedVersion>, RegistryReadError>;
	/**
	 * One published version's dependency fields — `dependencies`,
	 * `peerDependencies`, `optionalDependencies`, `peerDependenciesMeta` and
	 * `engines` — or `None` when that version is not on that registry.
	 *
	 * @remarks
	 * Read by the same route as {@link NpmRegistryShape.version}: the
	 * per-version endpoint, the packument for a `github-packages` target, and
	 * the packument again after a 405 from any other registry. A malformed
	 * dependency record fails with kind `"decode"`; an `engines` value that is
	 * not a string record is omitted (see {@link VersionManifest}).
	 *
	 * For parity with `pnpm view` behind a proxy or a private CA, run this
	 * service over `NpmHttpClient.layer` from `@effected/npm/node`, with
	 * `packageManager: "pnpm"` in its options; over a plain fetch client the
	 * npmrc's transport settings are not applied.
	 */
	readonly manifest: (
		name: string,
		version: string,
		target?: RegistryTarget,
	) => Effect.Effect<Option.Option<VersionManifest>, RegistryReadError>;
	/**
	 * Every published version, or `None` when the package is not on that
	 * registry.
	 *
	 * @remarks
	 * `None` is the registry answering 404 for the packument: the package does
	 * not exist there, or the target cannot see it. `Some([])` is a package the
	 * registry knows that lists no versions, such as a fully unpublished one. A
	 * caller that treats an unknown package as an error matches on the `Option`
	 * (`Effect.fromOption`, `Option.match`), not on the list's length.
	 */
	readonly versions: (
		name: string,
		target?: RegistryTarget,
	) => Effect.Effect<Option.Option<ReadonlyArray<string>>, RegistryReadError>;
	/**
	 * The dist-tag map (`latest`, `next`, …), or `None` when the package is not
	 * on that registry.
	 *
	 * @remarks
	 * `Some({})` is a package the registry knows with no tags.
	 */
	readonly distTags: (
		name: string,
		target?: RegistryTarget,
	) => Effect.Effect<Option.Option<Record<string, string>>, RegistryReadError>;
	/**
	 * Per-version publish timestamps, from the packument's `time` map (without
	 * its `created` / `modified` keys), or `None` when the package is not on that
	 * registry.
	 *
	 * @remarks
	 * `Some([])` is a package the registry knows with no readable per-version
	 * timestamps.
	 */
	readonly publishTimes: (
		name: string,
		target?: RegistryTarget,
	) => Effect.Effect<Option.Option<ReadonlyArray<PublishTime>>, RegistryReadError>;
}

/** Builds the service over an already-resolved `HttpClient`. */
const make = Effect.fnUntraced(function* () {
	// Redirects are followed here rather than left to the client, so the
	// origin-change rule (core drops `authorization`, `proxy-authorization`
	// and `cookie` on a redirect to another origin) holds for every client a
	// consumer provides, the same rule `PackageTarball` applies. A client that
	// already follows redirects (fetch by default) never returns a 3xx, so this
	// adds nothing there.
	const client = HttpClient.followRedirects(yield* HttpClient.HttpClient);

	/**
	 * Fetches and decodes one registry document, mapping absence to `None`.
	 *
	 * @remarks
	 * The 404-is-absence rule is applied on the **status**, structurally, rather
	 * than by matching the wording of a CLI's stderr.
	 */
	const read = <A, I>(
		schema: Schema.Codec<A, I>,
		url: string,
		name: string,
		registry: string,
		target: RegistryTarget | undefined,
	): Effect.Effect<Option.Option<A>, RegistryReadError> =>
		Effect.andThen(
			refuseWorkload(target, name, registry),
			// Lazily, after the refusal: the header is built from the credential,
			// and a refused credential must never reach a request.
			() => fetchDocument(schema, url, name, registry, target),
		);

	/** The request and its mapping, for a target `read` has already vetted. */
	const fetchDocument = <A, I>(
		schema: Schema.Codec<A, I>,
		url: string,
		name: string,
		registry: string,
		target: RegistryTarget | undefined,
	): Effect.Effect<Option.Option<A>, RegistryReadError> =>
		client
			.get(url, {
				headers: authorizationHeader(target?.credential),
			})
			.pipe(
				Effect.catch((cause: HttpClientError.HttpClientError) =>
					// Redacted where it is kept: core's error holds the live request,
					// `authorization` header included, as a readable field.
					Effect.fail(
						new RegistryReadError({
							kind: "transport",
							package: name,
							registry: HttpRedaction.url(registry),
							cause: HttpRedaction.cause(cause),
						}),
					),
				),
				Effect.flatMap((response) => {
					if (response.status === 404) return Effect.succeed(Option.none<A>());
					if (response.status < 200 || response.status >= 300) {
						return Effect.fail(
							new RegistryReadError({
								kind: "status",
								package: name,
								registry: HttpRedaction.url(registry),
								status: response.status,
							}),
						);
					}
					return response.json.pipe(
						Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body)),
						Effect.map(Option.some),
						Effect.catch((cause) =>
							Effect.fail(
								new RegistryReadError({
									kind: "decode",
									package: name,
									registry: HttpRedaction.url(registry),
									cause: HttpRedaction.cause(cause),
								}),
							),
						),
					);
				}),
			);

	const packument = (name: string, target: RegistryTarget | undefined) => {
		const registry = target?.registry ?? DEFAULT_REGISTRY;
		return read(Packument, packageUrl(registry, name), name, registry, target);
	};

	/**
	 * Resolves one version document by reading the whole packument and
	 * selecting it.
	 *
	 * @remarks
	 * The read path for registries that do not implement the per-version
	 * endpoint — GitHub Packages answers it with 405 regardless of credentials,
	 * so `versionDocument` routes here up front for that kind, and falls back
	 * here on a 405 from any other registry.
	 */
	const versionFromPackument = <A, I>(
		schema: Schema.Codec<A, I>,
		name: string,
		versionNumber: string,
		registry: string,
		target: RegistryTarget | undefined,
	): Effect.Effect<Option.Option<A>, RegistryReadError> =>
		read(Packument, packageUrl(registry, name), name, registry, target).pipe(
			Effect.flatMap((document) => {
				if (Option.isNone(document)) return Effect.succeed(Option.none<A>());
				const published = document.value.versions;
				// `hasOwn` rather than a bare index: the version number is caller
				// input, and a key like `constructor` must not read the prototype.
				if (published === undefined || !Object.hasOwn(published, versionNumber)) {
					return Effect.succeed(Option.none<A>());
				}
				return Schema.decodeUnknownEffect(schema)(published[versionNumber]).pipe(
					Effect.map(Option.some),
					Effect.catch((cause) =>
						Effect.fail(
							new RegistryReadError({ kind: "decode", package: name, registry: HttpRedaction.url(registry), cause }),
						),
					),
				);
			}),
		);

	/**
	 * One version's document, decoded with `schema`, through the one routing
	 * rule every per-version read shares: a `github-packages` target reads the
	 * packument up front, any other registry tries the per-version endpoint and
	 * falls back to the packument on a 405.
	 *
	 * @remarks
	 * `version` and `manifest` both go through here, so the two cannot reach one
	 * version by different paths. The caller has already opened the span.
	 */
	const versionDocument = <A, I>(
		schema: Schema.Codec<A, I>,
		name: string,
		versionNumber: string,
		target: RegistryTarget | undefined,
	): Effect.Effect<Option.Option<A>, RegistryReadError> => {
		const registry = target?.registry ?? DEFAULT_REGISTRY;
		return classifyRegistry(registry) === "github-packages"
			? versionFromPackument(schema, name, versionNumber, registry, target)
			: read(schema, packageUrl(registry, name, versionNumber), name, registry, target).pipe(
					Effect.catch((error) =>
						error.kind === "status" && error.status === 405
							? versionFromPackument(schema, name, versionNumber, registry, target)
							: Effect.fail(error),
					),
				);
	};

	const version = Effect.fn("NpmRegistry.version")(function* (
		name: string,
		versionNumber: string,
		target?: RegistryTarget,
	) {
		yield* Effect.annotateCurrentSpan({
			package: name,
			version: versionNumber,
			registry: HttpRedaction.url(target?.registry ?? DEFAULT_REGISTRY),
		});
		const document = yield* versionDocument(VersionDocument, name, versionNumber, target);
		return Option.map(document, (found) =>
			PublishedVersion.make({
				name: found.name,
				version: found.version,
				...integrityField(found.dist?.integrity),
				...(found.dist?.tarball === undefined ? {} : { tarball: found.dist.tarball }),
			}),
		);
	});

	const manifest = Effect.fn("NpmRegistry.manifest")(function* (
		name: string,
		versionNumber: string,
		target?: RegistryTarget,
	) {
		yield* Effect.annotateCurrentSpan({
			package: name,
			version: versionNumber,
			registry: HttpRedaction.url(target?.registry ?? DEFAULT_REGISTRY),
		});
		const document = yield* versionDocument(ManifestDocument, name, versionNumber, target);
		return Option.map(document, ({ engines, ...fields }) =>
			VersionManifest.make({ ...fields, ...(isEnginesRecord(engines) ? { engines } : {}) }),
		);
	});

	const versions = Effect.fn("NpmRegistry.versions")(function* (name: string, target?: RegistryTarget) {
		yield* Effect.annotateCurrentSpan({
			package: name,
			registry: HttpRedaction.url(target?.registry ?? DEFAULT_REGISTRY),
		});
		const document = yield* packument(name, target);
		return Option.map(document, (found): ReadonlyArray<string> => Object.keys(found.versions ?? {}));
	});

	const distTags = Effect.fn("NpmRegistry.distTags")(function* (name: string, target?: RegistryTarget) {
		yield* Effect.annotateCurrentSpan({
			package: name,
			registry: HttpRedaction.url(target?.registry ?? DEFAULT_REGISTRY),
		});
		const document = yield* packument(name, target);
		return Option.map(document, (found): Record<string, string> => ({ ...(found["dist-tags"] ?? {}) }));
	});

	const publishTimes = Effect.fn("NpmRegistry.publishTimes")(function* (name: string, target?: RegistryTarget) {
		yield* Effect.annotateCurrentSpan({
			package: name,
			registry: HttpRedaction.url(target?.registry ?? DEFAULT_REGISTRY),
		});
		const document = yield* packument(name, target);
		return Option.map(document, (found): ReadonlyArray<PublishTime> => {
			const entries: Array<PublishTime> = [];
			for (const [key, value] of Object.entries(found.time ?? {})) {
				if (NON_VERSION_TIME_KEYS.has(key) || typeof value !== "string") continue;
				// An unparseable timestamp drops the entry rather than failing the
				// read: the caller's question is "when were these published", and
				// one malformed row is not a reason to answer nothing.
				const parsed = DateTime.make(value);
				if (Option.isNone(parsed)) continue;
				entries.push(PublishTime.make({ version: key, publishedAt: parsed.value }));
			}
			return entries;
		});
	});

	return { version, manifest, versions, distTags, publishTimes } satisfies NpmRegistryShape;
});

/** The default for an unstubbed {@link NpmRegistry.makeTest} member. */
const notStubbed = (method: string) => () =>
	Effect.die(
		new Error(
			`NpmRegistry.makeTest: ${method}() was called but not stubbed — no honest default exists for a test double; pass a \`${method}\` override, or use NpmRegistry.layerSeeded.`,
		),
	);

/**
 * One seeded version's registry-visible facts.
 *
 * @public
 */
export interface SeededVersion {
	/** Published integrity, if any. */
	readonly integrity?: string | undefined;
	/** Tarball URL, if any. */
	readonly tarball?: string | undefined;
	/** Publish timestamp as an ISO-8601 string, if any. */
	readonly publishedAt?: string | undefined;
	/** `dependencies`, for `manifest`. */
	readonly dependencies?: Readonly<Record<string, string>> | undefined;
	/** `peerDependencies`, for `manifest`. */
	readonly peerDependencies?: Readonly<Record<string, string>> | undefined;
	/** `optionalDependencies`, for `manifest`. */
	readonly optionalDependencies?: Readonly<Record<string, string>> | undefined;
	/** `peerDependenciesMeta`, for `manifest`. */
	readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>> | undefined;
	/** `engines`, for `manifest`. */
	readonly engines?: Readonly<Record<string, string>> | undefined;
}

/**
 * A whole fake registry world, keyed the way real reads are.
 *
 * @remarks
 * `registries[registry][name][version]` — all three axes, so one seed can serve
 * two versions of one package and two registries for one version (a mixed
 * publish/recover run). Registry keys are matched exactly against
 * `RegistryTarget.registry`; a read with no registry uses {@link DEFAULT_REGISTRY}.
 *
 * @public
 */
export interface RegistrySeed {
	/** registry → package → version → facts. */
	readonly registries: Record<string, Record<string, Record<string, SeededVersion>>>;
	/** package → dist-tag map, when a test asserts on tags. */
	readonly distTags?: Record<string, Record<string, string>> | undefined;
}

/**
 * Reads package metadata from an npm-protocol registry over core `HttpClient`:
 * one version, one version's dependency fields, every version, dist-tags and
 * per-version publish times.
 *
 * @remarks
 * No `npm view` subprocess is involved. The registry is a **per-call**
 * argument, and a 404 is `Option.none()` rather than an error on every read,
 * so an unknown package is never confused with one that has no versions or
 * tags; and `integrity` is typed as this package's own {@link IntegrityHash}
 * rather than a bare string. Failures are {@link RegistryReadError}. The live
 * {@link NpmRegistry.layer} requires `HttpClient`; tests use
 * {@link NpmRegistry.layerSeeded} or {@link NpmRegistry.layerTest}.
 *
 * Redirects are followed (up to ten) by the service itself, whichever client
 * is provided. A redirect to another origin (a different scheme, host or
 * port) drops the `Authorization` header before the next request, so a
 * registry that hands a read off to a mirror or CDN never forwards the
 * credential; a same-origin redirect keeps it. A failure's `cause` is a
 * redacted copy of core's `HttpClientError`: method, URL, status and
 * response headers survive, the credential does not.
 *
 * **Proxies and TLS trust are the client's, not this service's.** The service
 * applies no npmrc transport setting (the proxies, the bypass lists,
 * `strict-ssl`, the CA and client-certificate settings, top-level or per
 * registry), because it owns no connection: every request goes through the
 * `HttpClient` the caller provides. With core's `FetchHttpClient.layer`, a
 * registry reachable only through a proxy, or signed by an internal CA,
 * fails every read as kind `"transport"`, where `npm view` or `pnpm view`
 * succeeds. On Node, provide `NpmHttpClient.layer` from `@effected/npm/node`
 * instead, with the config and the environment: it applies the npmrc's
 * proxy, bypass, CA, `strict-ssl` and client-certificate settings by npm's
 * rules or, with `packageManager: "pnpm"`, by pnpm's, which differ. A
 * runtime without `@effect/platform-node` (Cloudflare Workers) keeps a fetch
 * client and has no proxy or custom CA support.
 *
 * @example
 * ```ts
 * import { NpmRegistry } from "@effected/npm";
 * import { Effect, Option } from "effect";
 * import { FetchHttpClient } from "effect/http";
 *
 * const program = Effect.gen(function* () {
 *   const registry = yield* NpmRegistry;
 *   const found = yield* registry.version("effect", "4.0.0");
 *   return Option.map(found, (published) => published.tarball);
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(NpmRegistry.layer), Effect.provide(FetchHttpClient.layer)));
 * ```
 *
 * @public
 */
export class NpmRegistry extends Context.Service<NpmRegistry, NpmRegistryShape>()("@effected/npm/NpmRegistry") {
	/** The live service. Resolves `HttpClient` once at construction, so every method's `R` is `never`. */
	static readonly layer: Layer.Layer<NpmRegistry, never, HttpClient.HttpClient> = Layer.effect(this, make());

	/**
	 * An in-memory double: stub only the members the test exercises; every other
	 * member **dies** with a defect naming itself.
	 *
	 * @remarks
	 * No member has an honest default — a fabricated version list or integrity
	 * would leak into consumer logic as fact. For a test that wants a working
	 * registry rather than a stub, use {@link NpmRegistry.layerSeeded}.
	 */
	static readonly makeTest = (overrides: Partial<NpmRegistryShape> = {}): NpmRegistryShape => ({
		version: notStubbed("version"),
		manifest: notStubbed("manifest"),
		versions: notStubbed("versions"),
		distTags: notStubbed("distTags"),
		publishTimes: notStubbed("publishTimes"),
		...overrides,
	});

	/**
	 * {@link NpmRegistry.makeTest} behind `Layer.succeed`.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh reference per call and layers
	 * memoize by reference — bind the result to a `const` rather than calling it
	 * at each composition site.
	 */
	static readonly layerTest = (overrides: Partial<NpmRegistryShape> = {}): Layer.Layer<NpmRegistry> =>
		Layer.succeed(NpmRegistry, NpmRegistry.makeTest(overrides));

	/** A fully-working in-memory double over a {@link RegistrySeed}. */
	static readonly makeSeeded = (seed: RegistrySeed): NpmRegistryShape => {
		// `hasOwn` throughout: registry, package and version names are caller
		// input, and a key like `constructor` must not read the prototype as a
		// seeded entry.
		const own = <V>(record: Record<string, V> | undefined, key: string): V | undefined =>
			record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
		const at = (target: RegistryTarget | undefined): Record<string, Record<string, SeededVersion>> =>
			own(seed.registries, target?.registry ?? DEFAULT_REGISTRY) ?? {};
		/** The package's seeded versions on the target, or `None` when it is not seeded there. */
		const seeded = (name: string, target: RegistryTarget | undefined) => Option.fromUndefinedOr(own(at(target), name));
		// Every seeded member refuses a workload credential exactly as the live
		// `read` does, so a double cannot pass a read that production refuses.
		const guarded = <A>(name: string, target: RegistryTarget | undefined, answer: () => A) =>
			Effect.map(refuseWorkload(target, name, target?.registry ?? DEFAULT_REGISTRY), () => answer());
		return {
			version: (name, version, target) =>
				guarded(name, target, () => {
					const found = own(own(at(target), name), version);
					return found === undefined
						? Option.none()
						: Option.some(
								PublishedVersion.make({
									name,
									version,
									...integrityField(found.integrity),
									...(found.tarball === undefined ? {} : { tarball: found.tarball }),
								}),
							);
				}),
			manifest: (name, version, target) =>
				guarded(name, target, () => {
					const found = own(own(at(target), name), version);
					if (found === undefined) return Option.none();
					// Conditional spreads: an unseeded field stays absent, never an
					// explicit `undefined`, which the constructor rejects.
					const { dependencies, peerDependencies, optionalDependencies, peerDependenciesMeta, engines } = found;
					return Option.some(
						VersionManifest.make({
							name,
							version,
							...(dependencies === undefined ? {} : { dependencies }),
							...(peerDependencies === undefined ? {} : { peerDependencies }),
							...(optionalDependencies === undefined ? {} : { optionalDependencies }),
							...(peerDependenciesMeta === undefined ? {} : { peerDependenciesMeta }),
							...(engines === undefined ? {} : { engines }),
						}),
					);
				}),
			versions: (name, target) =>
				guarded(name, target, () =>
					Option.map(seeded(name, target), (versions): ReadonlyArray<string> => Object.keys(versions)),
				),
			// A package with seeded tags exists for `distTags` on every registry,
			// because the `distTags` seed is not keyed by registry.
			distTags: (name, target) =>
				guarded(name, target, () => {
					const tags = own(seed.distTags, name);
					return tags !== undefined
						? Option.some({ ...tags })
						: Option.map(seeded(name, target), (): Record<string, string> => ({}));
				}),
			publishTimes: (name, target) =>
				guarded(name, target, () =>
					Option.map(
						seeded(name, target),
						(versions): ReadonlyArray<PublishTime> =>
							Object.entries(versions).flatMap(([version, facts]) => {
								if (facts.publishedAt === undefined) return [];
								const parsed = DateTime.make(facts.publishedAt);
								return Option.isNone(parsed) ? [] : [PublishTime.make({ version, publishedAt: parsed.value })];
							}),
					),
				),
		};
	};

	/** {@link NpmRegistry.makeSeeded} behind `Layer.succeed`. */
	static readonly layerSeeded = (seed: RegistrySeed): Layer.Layer<NpmRegistry> =>
		Layer.succeed(NpmRegistry, NpmRegistry.makeSeeded(seed));
}
