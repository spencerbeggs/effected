import { Context, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import type { HttpClientError } from "effect/unstable/http";
import { HttpClient } from "effect/unstable/http";
import { IntegrityHash } from "./IntegrityHash.js";

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
 * keyed without the registry cannot express it either, which is how the v3
 * double silently answered the same integrity for two different registries.
 *
 * @public
 */
export interface RegistryTarget {
	/** Registry base URL. Defaults to {@link DEFAULT_REGISTRY}. */
	readonly registry?: string | undefined;
	/** Bearer token, for a registry that requires auth to read. */
	readonly token?: Redacted.Redacted<string> | undefined;
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
 * When one version of a package was published.
 *
 * @remarks
 * A class rather than a bare `version → timestamp` record because the
 * registry's `time` object mixes per-version entries with two non-version keys
 * (`created`, `modified`), and every consumer that reads it raw re-derives that
 * exclusion — including, before this package, silk-update-action's release-age
 * filter.
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
 * says it is). **A 404 is not here**: an absent package or version is
 * `Option.none()`, extending the `None`-is-success convention this package's
 * resolver contracts already use.
 *
 * @public
 */
export class RegistryReadError extends Schema.TaggedErrorClass<RegistryReadError>()("RegistryReadError", {
	/** Why the read failed. */
	kind: Schema.Literals(["transport", "status", "decode"]),
	/** The package that was being read. */
	package: Schema.String,
	/** The registry that was being read from. */
	registry: Schema.String,
	/** The HTTP status, for `kind: "status"`. */
	status: Schema.optionalKey(Schema.Number),
	/** The underlying failure. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const where = `${this.package} on ${this.registry}`;
		switch (this.kind) {
			case "transport":
				return `Could not reach the registry for ${where}`;
			case "status":
				return `Registry read for ${where} failed with status ${this.status ?? "unknown"}`;
			default:
				return `Registry read for ${where} returned an unreadable body`;
		}
	}
}

/** The version-manifest fields this package reads. Unknown keys are ignored. */
const VersionManifest = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	dist: Schema.optionalKey(
		Schema.Struct({
			integrity: Schema.optionalKey(Schema.String),
			tarball: Schema.optionalKey(Schema.String),
		}),
	),
});

/** The packument fields this package reads. Unknown keys are ignored. */
const Packument = Schema.Struct({
	"dist-tags": Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	versions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
	time: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
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
	/** One published version, or `None` when that version is not on that registry. */
	readonly version: (
		name: string,
		version: string,
		target?: RegistryTarget,
	) => Effect.Effect<Option.Option<PublishedVersion>, RegistryReadError>;
	/** Every published version. Empty when the package is not on that registry. */
	readonly versions: (name: string, target?: RegistryTarget) => Effect.Effect<ReadonlyArray<string>, RegistryReadError>;
	/** The dist-tag map (`latest`, `next`, …). Empty when the package is absent. */
	readonly distTags: (
		name: string,
		target?: RegistryTarget,
	) => Effect.Effect<Record<string, string>, RegistryReadError>;
	/** Per-version publish timestamps — the endpoint that replaces `npm view <pkg> time --json`. */
	readonly publishTimes: (
		name: string,
		target?: RegistryTarget,
	) => Effect.Effect<ReadonlyArray<PublishTime>, RegistryReadError>;
}

/** Builds the service over an already-resolved `HttpClient`. */
const make = Effect.fnUntraced(function* () {
	const client = yield* HttpClient.HttpClient;

	/**
	 * Fetches and decodes one registry document, mapping absence to `None`.
	 *
	 * @remarks
	 * The 404-is-absence rule is applied on the **status**, structurally — the
	 * v3 layer matched `npm error code E404` on the CLI's stderr, which broke
	 * whenever npm reworded it (it did, between `npm ERR!` and `npm error`).
	 */
	const read = <A, I>(
		schema: Schema.Codec<A, I>,
		url: string,
		name: string,
		registry: string,
		target: RegistryTarget | undefined,
	): Effect.Effect<Option.Option<A>, RegistryReadError> =>
		client
			.get(url, {
				headers: target?.token === undefined ? {} : { authorization: `Bearer ${Redacted.value(target.token)}` },
			})
			.pipe(
				Effect.catch((cause: HttpClientError.HttpClientError) =>
					Effect.fail(new RegistryReadError({ kind: "transport", package: name, registry, cause })),
				),
				Effect.flatMap((response) => {
					if (response.status === 404) return Effect.succeed(Option.none<A>());
					if (response.status < 200 || response.status >= 300) {
						return Effect.fail(
							new RegistryReadError({ kind: "status", package: name, registry, status: response.status }),
						);
					}
					return response.json.pipe(
						Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body)),
						Effect.map(Option.some),
						Effect.catch((cause) =>
							Effect.fail(new RegistryReadError({ kind: "decode", package: name, registry, cause })),
						),
					);
				}),
			);

	const packument = (name: string, target: RegistryTarget | undefined) => {
		const registry = target?.registry ?? DEFAULT_REGISTRY;
		return read(Packument, packageUrl(registry, name), name, registry, target);
	};

	const version = Effect.fn("NpmRegistry.version")(function* (
		name: string,
		versionNumber: string,
		target?: RegistryTarget,
	) {
		const registry = target?.registry ?? DEFAULT_REGISTRY;
		yield* Effect.annotateCurrentSpan({ package: name, version: versionNumber, registry });
		const manifest = yield* read(VersionManifest, packageUrl(registry, name, versionNumber), name, registry, target);
		return Option.map(manifest, (found) =>
			PublishedVersion.make({
				name: found.name,
				version: found.version,
				...integrityField(found.dist?.integrity),
				...(found.dist?.tarball === undefined ? {} : { tarball: found.dist.tarball }),
			}),
		);
	});

	const versions = Effect.fn("NpmRegistry.versions")(function* (name: string, target?: RegistryTarget) {
		yield* Effect.annotateCurrentSpan({ package: name, registry: target?.registry ?? DEFAULT_REGISTRY });
		const document = yield* packument(name, target);
		return Option.match(document, {
			onNone: () => [] as ReadonlyArray<string>,
			onSome: (found) => Object.keys(found.versions ?? {}),
		});
	});

	const distTags = Effect.fn("NpmRegistry.distTags")(function* (name: string, target?: RegistryTarget) {
		yield* Effect.annotateCurrentSpan({ package: name, registry: target?.registry ?? DEFAULT_REGISTRY });
		const document = yield* packument(name, target);
		return Option.match(document, {
			onNone: () => ({}) as Record<string, string>,
			onSome: (found) => ({ ...(found["dist-tags"] ?? {}) }),
		});
	});

	const publishTimes = Effect.fn("NpmRegistry.publishTimes")(function* (name: string, target?: RegistryTarget) {
		yield* Effect.annotateCurrentSpan({ package: name, registry: target?.registry ?? DEFAULT_REGISTRY });
		const document = yield* packument(name, target);
		return Option.match(document, {
			onNone: () => [] as ReadonlyArray<PublishTime>,
			onSome: (found) => {
				const entries: Array<PublishTime> = [];
				for (const [key, value] of Object.entries(found.time ?? {})) {
					if (NON_VERSION_TIME_KEYS.has(key)) continue;
					// An unparseable timestamp drops the entry rather than failing the
					// read: the caller's question is "when were these published", and
					// one malformed row is not a reason to answer nothing.
					const parsed = DateTime.make(value);
					if (Option.isNone(parsed)) continue;
					entries.push(PublishTime.make({ version: key, publishedAt: parsed.value }));
				}
				return entries;
			},
		});
	});

	return { version, versions, distTags, publishTimes } satisfies NpmRegistryShape;
});

/** The default for an unstubbed {@link NpmRegistry.makeTest} member. */
const notStubbed = (method: string) => () =>
	Effect.die(
		new Error(
			`NpmRegistry.makeTest: ${method}() was called but not stubbed — no honest default exists for a test double; pass a \`${method}\` override, or use NpmRegistry.layerSeeded.`,
		),
	);

/** One seeded version's registry-visible facts. */
export interface SeededVersion {
	/** Published integrity, if any. */
	readonly integrity?: string | undefined;
	/** Tarball URL, if any. */
	readonly tarball?: string | undefined;
	/** Publish timestamp as an ISO-8601 string, if any. */
	readonly publishedAt?: string | undefined;
}

/**
 * A whole fake registry world, keyed the way real reads are.
 *
 * @remarks
 * `registries[registry][name][version]` — all three axes, because the v3 double
 * had none of them: it keyed by package name alone, so it could not serve two
 * versions of one package (silk-update-action's three-way merge) nor two
 * registries for one version (silk-release-action's mixed publish/recover run).
 * Both call sites hand-rolled a replacement stub; this shape is what they were
 * hand-rolling.
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
 * Registry reads over core `HttpClient`.
 *
 * @remarks
 * Replaces every shelled `npm view`. The registry is a **per-call** argument,
 * a 404 is `Option.none()` rather than an error, and `integrity` is typed as
 * this package's own {@link IntegrityHash} rather than a bare string.
 *
 * @public
 */
export class NpmRegistry extends Context.Service<NpmRegistry, NpmRegistryShape>()("@effected/npm/NpmRegistry") {
	/** Resolves `HttpClient` once at construction, so every method's `R` is `never`. */
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

	/** A fully-working double over a {@link RegistrySeed}. */
	static readonly makeSeeded = (seed: RegistrySeed): NpmRegistryShape => {
		const at = (target: RegistryTarget | undefined): Record<string, Record<string, SeededVersion>> =>
			seed.registries[target?.registry ?? DEFAULT_REGISTRY] ?? {};
		return {
			version: (name, version, target) => {
				const found = at(target)[name]?.[version];
				return Effect.succeed(
					found === undefined
						? Option.none()
						: Option.some(
								PublishedVersion.make({
									name,
									version,
									...integrityField(found.integrity),
									...(found.tarball === undefined ? {} : { tarball: found.tarball }),
								}),
							),
				);
			},
			versions: (name, target) => Effect.succeed(Object.keys(at(target)[name] ?? {})),
			distTags: (name) => Effect.succeed({ ...(seed.distTags?.[name] ?? {}) }),
			publishTimes: (name, target) =>
				Effect.succeed(
					Object.entries(at(target)[name] ?? {}).flatMap(([version, facts]) => {
						if (facts.publishedAt === undefined) return [];
						const parsed = DateTime.make(facts.publishedAt);
						return Option.isNone(parsed) ? [] : [PublishTime.make({ version, publishedAt: parsed.value })];
					}),
				),
		};
	};

	/** {@link NpmRegistry.makeSeeded} behind `Layer.succeed`. */
	static readonly layerSeeded = (seed: RegistrySeed): Layer.Layer<NpmRegistry> =>
		Layer.succeed(NpmRegistry, NpmRegistry.makeSeeded(seed));
}
