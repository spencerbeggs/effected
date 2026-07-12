import { Cause, Context, Duration, Effect, Layer, Ref, Schedule, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import {
	FileTreeResponse,
	TYPE_FILE_PATTERN,
	VersionsResponse,
	fileTreeUrl,
	fileUrl,
	packageJsonUrl,
	versionsUrl,
} from "./internal/jsdelivr.js";
import { MAX_TYPE_BYTES_PER_PACKAGE, MAX_TYPE_FILES_PER_PACKAGE } from "./internal/limits.js";
import type { PackageSpec } from "./PackageSpec.js";
import { emit } from "./RegistryEvent.js";

/**
 * Raised when an HTTP request or response fails at the jsDelivr boundary.
 *
 * @remarks
 * `kind` classifies the failure structurally — `transport` (connection,
 * timeout), `status` (non-2xx, with `status` populated), `body` (reading or
 * bounding the body) or `schema` (response validation) — and `status` is a
 * structured field, so classification consumers branch on typed data. v3
 * folded the HTTP status into a message string and substring-matched `"404"`
 * back out of it.
 *
 * @public
 */
export class FetchError extends Schema.TaggedErrorClass<FetchError>()("FetchError", {
	/** The request URL. */
	url: Schema.String,
	/** The HTTP status, when the failure has one. */
	status: Schema.optionalKey(Schema.Number),
	/** What failed, structurally. */
	kind: Schema.Literals(["transport", "status", "body", "schema"]),
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const statusPart = this.status !== undefined ? ` (HTTP ${this.status})` : "";
		return `Fetch ${this.kind} failure${statusPart} for ${this.url}`;
	}
}

/**
 * Raised when a pinned package version does not exist on the CDN (HTTP 404).
 *
 * @remarks
 * The 404 → `PackageNotFoundError` promotion happens on the typed
 * `FetchError` `status` field. Also raised by `TypeRegistry.getPackageVfs`
 * on a cache miss with `autoFetch: false`.
 *
 * @public
 */
export class PackageNotFoundError extends Schema.TaggedErrorClass<PackageNotFoundError>()("PackageNotFoundError", {
	/** The package name. */
	name: Schema.String,
	/** The version reference that was requested. */
	version: Schema.String,
}) {
	override get message(): string {
		return `Package ${this.name}@${this.version} was not found`;
	}
}

/**
 * Raised when local version resolution finds no published version matching
 * the requested reference.
 *
 * @remarks
 * Raised by `TypeRegistry.resolveVersion` — typed, with the requested ref and
 * bounded available-version context. v3 detected this case by
 * substring-matching CDN error prose.
 *
 * @public
 */
export class VersionNotFoundError extends Schema.TaggedErrorClass<VersionNotFoundError>()("VersionNotFoundError", {
	/** The package name. */
	name: Schema.String,
	/** The requested reference: a range, dist-tag or exact version. */
	ref: Schema.String,
	/** A bounded sample of the versions that ARE published. */
	available: Schema.Array(Schema.String),
}) {
	override get message(): string {
		return `No published version of ${this.name} matches "${this.ref}"`;
	}
}

/**
 * Version and dist-tag metadata for an npm package.
 *
 * @public
 */
export interface PackageVersions {
	/** Every published version string. */
	readonly versions: ReadonlyArray<string>;
	/** Dist-tags (`latest`, `next`, …) mapped to version strings. */
	readonly tags: { readonly [tag: string]: string };
}

/**
 * The lenient `package.json` subset the type resolver reads.
 *
 * @remarks
 * Deliberately NOT `@effected/package-json`: its schemas validate strictly
 * (branded names, SPDX licenses), and the manifests this package decodes come
 * off a CDN and include every historical malformation npm ever published.
 * Validation here is lenient and scoped to exactly the fields resolution
 * needs.
 *
 * @public
 */
export const PackageManifest = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	types: Schema.optionalKey(Schema.String),
	typings: Schema.optionalKey(Schema.String),
	main: Schema.optionalKey(Schema.String),
	module: Schema.optionalKey(Schema.String),
	// A string, a conditions/subpath record, or a Node fallback ARRAY — arrays
	// are legal at the top level and nested (nested ones arrive through the
	// Unknown record values).
	exports: Schema.optionalKey(
		Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown), Schema.Array(Schema.Unknown)]),
	),
	typesVersions: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Record(Schema.String, Schema.Union([Schema.Array(Schema.String), Schema.String])),
		),
	),
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/**
 * The decoded form of {@link (PackageManifest:variable)}.
 *
 * @public
 */
export type PackageManifest = typeof PackageManifest.Type;

/**
 * The service shape {@link PackageFetcher} provides.
 *
 * @public
 */
export interface PackageFetcherShape {
	/** Fetch every published version and dist-tag for a package name. */
	readonly getVersions: (name: string) => Effect.Effect<PackageVersions, FetchError>;
	/** List the file paths a pinned package version publishes (leading `/` stripped). */
	readonly getFileTree: (pkg: PackageSpec) => Effect.Effect<ReadonlyArray<string>, FetchError | PackageNotFoundError>;
	/** Download one file's contents from the CDN. */
	readonly downloadFile: (pkg: PackageSpec, path: string) => Effect.Effect<string, FetchError | PackageNotFoundError>;
	/** Download and leniently decode a pinned version's `package.json`. */
	readonly getPackageJson: (pkg: PackageSpec) => Effect.Effect<PackageManifest, FetchError | PackageNotFoundError>;
	/**
	 * Download every declaration file a pinned version publishes, keyed by
	 * tree path.
	 *
	 * @remarks
	 * Concurrency 10, bounded by the materialization budget: more than the
	 * per-package file cap, or a cumulative body size past the byte cap, fails
	 * typed (`FetchError`, `kind: "body"`) rather than exhausting memory.
	 */
	readonly getTypeFiles: (
		pkg: PackageSpec,
	) => Effect.Effect<ReadonlyMap<string, string>, FetchError | PackageNotFoundError>;
}

const retrySchedule = Schedule.exponential(Duration.millis(100));

/** Retry only failures that can be transient: transport errors and timeouts. */
const isTransient = (error: unknown): boolean =>
	Cause.isTimeoutError(error) || (HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError");

const make: Effect.Effect<PackageFetcherShape, never, HttpClient.HttpClient> = Effect.gen(function* () {
	const http = yield* HttpClient.HttpClient;

	// Fetch a response and fail fast on a non-2xx status. jsDelivr returns a
	// plain-text error body (e.g. "Couldn't find version …") for 404s; without
	// this check that text would reach the JSON decoder and surface as an
	// opaque schema failure. Non-2xx responses are not transient and are not
	// retried; transport/timeout failures are, with exponential back-off.
	const fetchOk = (url: string): Effect.Effect<HttpClientResponse.HttpClientResponse, FetchError> =>
		http.get(url).pipe(
			Effect.timeout(Duration.seconds(30)),
			Effect.retry({ schedule: retrySchedule, times: 3, while: isTransient }),
			Effect.mapError((cause) => new FetchError({ url, kind: "transport", cause })),
			Effect.flatMap((response) =>
				response.status >= 200 && response.status < 300
					? Effect.succeed(response)
					: response.text.pipe(
							// The status IS the failure (kind stays "status"); the body is
							// diagnostic. When even reading it fails, carry that read
							// failure as the cause instead of pretending the body was empty.
							Effect.match({
								onFailure: (readFailure) => ({ bodySnippet: "", cause: readFailure as unknown }),
								onSuccess: (body) => {
									const bodySnippet = body.slice(0, 200);
									return { bodySnippet, cause: bodySnippet as unknown };
								},
							}),
							Effect.flatMap(({ bodySnippet, cause }) =>
								emit({ _tag: "FetchFailed", url, status: response.status, bodySnippet }).pipe(
									Effect.andThen(Effect.fail(new FetchError({ url, status: response.status, kind: "status", cause }))),
								),
							),
						),
			),
		);

	const fetchText = (url: string): Effect.Effect<string, FetchError> =>
		fetchOk(url).pipe(
			Effect.flatMap((response) =>
				Effect.mapError(response.text, (cause) => new FetchError({ url, kind: "body", cause })),
			),
		);

	const fetchJson = <S extends Schema.Top & { readonly DecodingServices: never }>(
		url: string,
		schema: S,
	): Effect.Effect<S["Type"], FetchError> =>
		fetchOk(url).pipe(
			Effect.flatMap((response) =>
				Effect.mapError(response.json, (cause) => new FetchError({ url, kind: "body", cause })),
			),
			Effect.flatMap((data) =>
				Schema.decodeUnknownEffect(schema)(data).pipe(
					// SchemaError is normalized to the domain error at this boundary,
					// with the schema failure as structured cause — never leaked.
					Effect.mapError((cause) => new FetchError({ url, kind: "schema", cause })),
				),
			),
		);

	/** Promote a typed 404 into the package-level not-found error. */
	const promote404 =
		(pkg: PackageSpec) =>
		(error: FetchError): FetchError | PackageNotFoundError =>
			error.status === 404 ? new PackageNotFoundError({ name: pkg.name, version: pkg.version }) : error;

	/** The decoded flat tree, with names normalized and per-file sizes kept. */
	const fetchTree = (pkg: PackageSpec) =>
		fetchJson(fileTreeUrl(pkg), FileTreeResponse).pipe(
			Effect.mapError(promote404(pkg)),
			Effect.map((tree) =>
				tree.files.map((file) => ({
					name: file.name.replace(/^\/+/, ""),
					size: file.size,
				})),
			),
		);

	const getFileTree = Effect.fn("PackageFetcher.getFileTree")(function* (pkg: PackageSpec) {
		const tree = yield* fetchTree(pkg);
		return tree.map((file) => file.name);
	});

	const downloadFile = Effect.fn("PackageFetcher.downloadFile")(function* (pkg: PackageSpec, filePath: string) {
		return yield* fetchText(fileUrl(pkg, filePath)).pipe(Effect.mapError(promote404(pkg)));
	});

	const getPackageJson = Effect.fn("PackageFetcher.getPackageJson")(function* (pkg: PackageSpec) {
		return yield* fetchJson(packageJsonUrl(pkg), PackageManifest).pipe(Effect.mapError(promote404(pkg)));
	});

	const getVersions = Effect.fn("PackageFetcher.getVersions")(function* (name: string) {
		return yield* fetchJson(versionsUrl(name), VersionsResponse);
	});

	const overBudget = (pkg: PackageSpec, detail: string): FetchError =>
		new FetchError({ url: fileTreeUrl(pkg), kind: "body", cause: new Error(detail) });

	const getTypeFiles = Effect.fn("PackageFetcher.getTypeFiles")(function* (pkg: PackageSpec) {
		const tree = yield* fetchTree(pkg);
		const typeFiles = tree.filter((file) => TYPE_FILE_PATTERN.test(file.name));
		if (typeFiles.length > MAX_TYPE_FILES_PER_PACKAGE) {
			return yield* Effect.fail(
				overBudget(
					pkg,
					`package publishes ${typeFiles.length} declaration files, over the ${MAX_TYPE_FILES_PER_PACKAGE}-file budget`,
				),
			);
		}
		// Pre-check: the tree carries per-file sizes, so a package whose
		// declared declaration bytes already exceed the budget is rejected
		// before a single download starts.
		const declaredBytes = typeFiles.reduce((total, file) => total + (file.size ?? 0), 0);
		if (declaredBytes > MAX_TYPE_BYTES_PER_PACKAGE) {
			return yield* Effect.fail(
				overBudget(pkg, `declared declaration files total ${declaredBytes} bytes, over the byte budget`),
			);
		}
		// Backstop: cumulative accounting of ACTUAL bytes (UTF-8, not UTF-16
		// code units) as downloads land, in case the declared sizes lie. The
		// check runs after each body is read, so the budget can transiently
		// overshoot by at most concurrency × one body before the batch fails —
		// full streaming enforcement is deliberately out of scope.
		const encoder = new TextEncoder();
		const budget = yield* Ref.make(0);
		const entries = yield* Effect.forEach(
			typeFiles,
			(file) =>
				downloadFile(pkg, file.name).pipe(
					Effect.tap((content) =>
						Ref.updateAndGet(budget, (total) => total + encoder.encode(content).length).pipe(
							Effect.flatMap((total) =>
								total > MAX_TYPE_BYTES_PER_PACKAGE
									? Effect.fail(
											overBudget(pkg, `declaration files exceed the ${MAX_TYPE_BYTES_PER_PACKAGE}-byte budget`),
										)
									: Effect.void,
							),
						),
					),
					Effect.map((content) => [file.name, content] as const),
				),
			{ concurrency: 10 },
		);
		return new Map(entries) as ReadonlyMap<string, string>;
	});

	return {
		getVersions,
		getFileTree,
		downloadFile,
		getPackageJson,
		getTypeFiles,
	} satisfies PackageFetcherShape;
});

/**
 * The jsDelivr CDN client.
 *
 * @remarks
 * Requests time out after 30 seconds; transport and timeout failures retry
 * up to 3 times with exponential back-off (starting at 100 ms). Non-2xx
 * responses fail fast with a typed status and emit a `FetchFailed` event
 * carrying the status and a body snippet. If a second registry backend ever
 * appears it arrives as another layer for this service — the service seam is
 * the extension point.
 *
 * @public
 */
export class PackageFetcher extends Context.Service<PackageFetcher, PackageFetcherShape>()(
	"@effected/ts-vfs/PackageFetcher",
) {
	/** The jsDelivr-backed layer; requires an `HttpClient`. */
	static readonly layer: Layer.Layer<PackageFetcher, never, HttpClient.HttpClient> = Layer.effect(PackageFetcher, make);
}
