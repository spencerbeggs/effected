import { Run } from "@effected/commands";
import type { Scope } from "effect";
import { Context, Crypto, Effect, FileSystem, Layer, Option, Redacted, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { IntegrityHash } from "./IntegrityHash.js";
import type { PublishedVersion } from "./NpmRegistry.js";
import type { RegistryCredential, RegistryCredentialLookup } from "./RegistryCredential.js";

/**
 * Raised when a published tarball cannot be fetched, verified or extracted.
 *
 * @public
 */
export class TarballError extends Schema.TaggedError<TarballError>()("TarballError", {
	/**
	 * `notFound` — the registry recorded no tarball for this version, or the
	 * tarball URL answered 404. `http` — any other transport or non-2xx
	 * failure. `integrityMismatch` — the bytes did not match the integrity the
	 * registry vouched for. `extractFailed` — the bytes could not be written or
	 * unpacked.
	 *
	 * **The `notFound` split is load-bearing, not cosmetic.** A consumer that
	 * cannot tell "this version legitimately does not exist" from "something
	 * went wrong fetching a version that does" has to treat both the same way,
	 * and the failure that results is silent: an integrity mismatch handled as
	 * a missing version can send a caller down a lossy fallback on a run that
	 * still reports success. Branch on `reason`.
	 *
	 * `integrityUnverifiable` — the registry vouched for an integrity but no
	 * digest could be computed to check it, so nothing was compared.
	 */
	reason: Schema.Literals(["notFound", "http", "integrityMismatch", "integrityUnverifiable", "extractFailed"]),
	/** The package being fetched. */
	package: Schema.String,
	/** The version being fetched. */
	version: Schema.String,
	/** The HTTP status, for `reason: "http"` and a 404 `notFound`. */
	status: Schema.optionalKey(Schema.Number),
	/** The integrity the registry vouched for, for `reason: "integrityMismatch"`. */
	expected: Schema.optionalKey(Schema.String),
	/** The integrity the downloaded bytes actually have. */
	actual: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const what = `${this.package}@${this.version}`;
		switch (this.reason) {
			case "notFound":
				return `No published tarball for ${what}`;
			case "http":
				return `Could not download the tarball for ${what}${this.status === undefined ? "" : ` (HTTP ${this.status})`}`;
			case "integrityMismatch":
				return `The tarball for ${what} did not match the integrity the registry published (expected ${this.expected ?? "unknown"}, got ${this.actual ?? "unknown"})`;
			case "integrityUnverifiable":
				return `Could not compute a digest to verify ${what}, so its integrity was never checked (expected ${this.expected ?? "unknown"})`;
			default:
				return `Could not extract the tarball for ${what}`;
		}
	}
}

/**
 * Options for {@link PackageTarballShape.extract}.
 *
 * @public
 */
export interface PackageTarballExtractOptions {
	/**
	 * Where the credential for the download comes from. Asked once, for the
	 * tarball's own URL, as npm asks: pass an `NpmConfig` as it stands. With
	 * none, or when it answers `None`, the download is sent unauthenticated.
	 *
	 * @remarks
	 * A lookup rather than a credential, on purpose. A tarball is often served
	 * from another host than the registry that listed it, and a bare
	 * credential carries no URL, so the easy call would be to pass the
	 * registry's token, which then goes to the CDN. The lookup is keyed by
	 * the URL actually being requested, so a registry token reaches a tarball
	 * only when the tarball lives under the registry's own host and path.
	 */
	readonly credentials?: RegistryCredentialLookup | undefined;
}

/**
 * The {@link PackageTarball} service shape.
 *
 * @public
 */
export interface PackageTarballShape {
	/**
	 * Download, verify and extract one published version, answering the
	 * directory its `package/` root was unpacked into.
	 *
	 * @remarks
	 * **Scoped**: the temporary directory is removed when the calling scope
	 * closes, so a caller reads what it needs and never owns the cleanup.
	 *
	 * **Authenticated by the tarball's URL, never the registry's.** With
	 * `options.credentials`, the download carries the credential that lookup
	 * answers for `published.tarball`. No match is not an error: the download
	 * goes out unauthenticated, as npm sends it, and a registry that wanted a
	 * credential answers 401 or 403, which fails `reason: "http"` with that
	 * `status`.
	 *
	 * Redirects are followed (up to ten). A redirect to another origin (a
	 * different scheme, host or port) drops the `Authorization` header before
	 * the next request, so a signed-URL hop to a storage host never receives
	 * the registry's credential; a same-origin redirect keeps it.
	 */
	readonly extract: (
		published: PublishedVersion,
		options?: PackageTarballExtractOptions,
	) => Effect.Effect<string, TarballError, Scope.Scope>;
}

/**
 * The `Authorization` header for a credential, or none at all.
 *
 * @remarks
 * `Bearer` for a token and `Basic` for an `_auth` blob, as `NpmRegistry`
 * sends them. Any other kind (a publish-only workload credential from a
 * lookup that cast past the type) sends nothing: a read never spends a
 * publish credential.
 */
const authorizationHeader = (credential: RegistryCredential | undefined): Record<string, string> => {
	const kind: string | undefined = credential?.kind;
	if (credential === undefined || (kind !== "token" && kind !== "basic")) return {};
	return credential.kind === "token"
		? { authorization: `Bearer ${Redacted.value(credential.token)}` }
		: { authorization: `Basic ${Redacted.value(credential.encoded)}` };
};

/** Map an SRI algorithm name onto core's digest algorithm spelling. */
const digestAlgorithmOf = (algorithm: string): Crypto.DigestAlgorithm | undefined => {
	switch (algorithm) {
		case "sha1":
			return "SHA-1";
		case "sha256":
			return "SHA-256";
		case "sha384":
			return "SHA-384";
		case "sha512":
			return "SHA-512";
		default:
			return undefined;
	}
};

/** An SRI value without its base64 padding, for a padding-insensitive compare. */
const unpadded = (value: string): string => value.replace(/=+$/, "");

/** Builds the service over already-resolved platform services. */
const make = Effect.fnUntraced(function* () {
	const fs = yield* FileSystem.FileSystem;
	const crypto = yield* Crypto.Crypto;
	// Redirects are followed here rather than left to the client, so the
	// origin-change rule (core drops `authorization`, `proxy-authorization`
	// and `cookie`) holds for every client a consumer provides. A client that
	// already follows redirects (fetch by default) never returns a 3xx, so this
	// adds nothing there.
	const http = HttpClient.followRedirects(yield* HttpClient.HttpClient);
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	const extract = Effect.fn("PackageTarball.extract")(function* (
		published: PublishedVersion,
		options?: PackageTarballExtractOptions,
	) {
		const name = published.name;
		const version = published.version;
		const fail = (
			reason: "notFound" | "http" | "integrityMismatch" | "integrityUnverifiable" | "extractFailed",
			extra: { status?: number; expected?: string; actual?: string; cause?: unknown } = {},
		): TarballError => new TarballError({ reason, package: name, version, ...extra });

		const url = published.tarball;
		if (url === undefined) {
			return yield* Effect.fail(fail("notFound"));
		}

		// Looked up by the TARBALL's URL, never the registry's: npm scopes the
		// credential to the request URL's host and path, and a tarball on a CDN
		// host gets none unless that host has its own entry. The header is never
		// logged or annotated onto the span; core's client serializes requests
		// without headers.
		const credential = options?.credentials?.credentialFor(url);
		const headers = authorizationHeader(
			credential === undefined || Option.isNone(credential) ? undefined : credential.value,
		);

		const response = yield* http.get(url, { headers }).pipe(Effect.mapError((cause) => fail("http", { cause })));

		// A non-2xx body must be caught BEFORE it reaches the disk: piping a 404
		// error page to `tar` surfaces as a misleading "could not extract"
		// instead of naming the real failure.
		if (Math.floor(response.status / 100) !== 2) {
			return yield* Effect.fail(fail(response.status === 404 ? "notFound" : "http", { status: response.status }));
		}

		const bytes = yield* response.arrayBuffer.pipe(
			Effect.map((buffer) => new Uint8Array(buffer)),
			Effect.mapError((cause) => fail("http", { cause })),
		);

		// Verification happens BEFORE extraction and before anything reads the
		// contents: a poisoned intermediary (CDN edge, proxy, mirror) serving
		// different bytes than the registry vouched for must never reach `tar`.
		const expected = published.integrity;
		if (expected === undefined) {
			yield* Effect.logDebug(
				`PackageTarball: the registry published no integrity for ${name}@${version}; the download is unverified`,
			);
		} else {
			const algorithm = Option.flatMap(IntegrityHash.algorithmOf(expected), (found) =>
				Option.fromUndefinedOr(digestAlgorithmOf(found)),
			);
			if (!IntegrityHash.isSri(expected) || Option.isNone(algorithm)) {
				// Not a form this can check (the yarn form names no algorithm).
				// Saying so is the point: a silent skip here is indistinguishable
				// from a passed verification.
				yield* Effect.logWarning(
					`PackageTarball: cannot verify ${name}@${version} — "${expected}" is not an integrity form this can check`,
				);
			} else {
				const digest = yield* crypto
					.digest(algorithm.value, bytes)
					// NOT integrityMismatch: nothing was compared. See the reason
					// docstring — a failure to verify presented as a measured
					// mismatch is the exact class this package fixes elsewhere.
					.pipe(Effect.mapError((cause) => fail("integrityUnverifiable", { expected, cause })));
				const actual = `${expected.slice(0, expected.indexOf("-"))}-${Base64.encode(digest)}`;
				// Compared without base64 padding: the SRI grammar permits an
				// unpadded value, and a padding difference is not a byte
				// difference. Refusing a valid tarball over one would be the
				// worse failure of the two.
				if (unpadded(actual) !== unpadded(expected)) {
					return yield* Effect.fail(fail("integrityMismatch", { expected, actual }));
				}
			}
		}

		const directory = yield* fs
			.makeTempDirectoryScoped({ prefix: "effected-tarball-" })
			.pipe(Effect.mapError((cause) => fail("extractFailed", { cause })));

		const archive = `${directory}/package.tgz`;
		yield* fs.writeFile(archive, bytes).pipe(Effect.mapError((cause) => fail("extractFailed", { cause })));

		const unpacked = yield* Run.succeeds(ChildProcess.make("tar", ["-xzf", archive, "-C", directory])).pipe(
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
		);
		if (!unpacked) {
			return yield* Effect.fail(fail("extractFailed"));
		}

		// npm tarballs unpack to a fixed `package/` root.
		return `${directory}/package`;
	});

	return { extract } satisfies PackageTarballShape;
});

/**
 * Fetch, verify and extract a published tarball.
 *
 * @remarks
 * The inbound half of the registry surface: `NpmRegistry` reads *metadata* and
 * `PackagePublish` sends a tarball out, while this service reads a published
 * tarball back. Use it to read something out of a published package **before
 * any install has run**, such as a tool reproducing a package manager's
 * config-dependency workflow, whose output is the input the install then
 * consumes.
 *
 * Pair it with `resolveEntryPoint` from `@effected/package-json` to find
 * the package's entry file inside the extracted directory. Loading that file is
 * deliberately **not** part of this surface: a dynamic `import()` of a computed
 * path is compiled into a context module by bundlers, and a kit-level loader
 * would hand every bundling consumer that problem with no seam to fix it.
 *
 * **Extraction shells out to `tar`** through core's `ChildProcessSpawner`
 * rather than taking a tarball-reader dependency, so the package keeps its
 * core-only dependency footprint. `tar` is on every CI runner image; a consumer
 * off a runner needs both a spawner and the `tar` binary.
 *
 * For a private registry, pass the `NpmConfig` the metadata read used as
 * `credentials`: the tarball is authenticated by its own URL, so a registry
 * token never follows the download to a CDN host it was not configured for.
 *
 * @example
 * ```ts
 * import { NpmConfig, NpmRegistry, PackageTarball } from "@effected/npm";
 * import { Effect, Option } from "effect";
 *
 * const read = Effect.gen(function* () {
 *   const config = yield* NpmConfig.load({ cwd: process.cwd(), env: process.env });
 *   const registry = yield* NpmRegistry;
 *   const tarball = yield* PackageTarball;
 *   const found = yield* registry.version("@acme/config", "1.2.3", config.targetFor("@acme/config"));
 *   if (Option.isNone(found)) return Option.none();
 *   const directory = yield* tarball.extract(found.value, { credentials: config });
 *   return Option.some(directory);
 * }).pipe(Effect.scoped);
 * ```
 *
 * @public
 */
export class PackageTarball extends Context.Service<PackageTarball, PackageTarballShape>()(
	"@effected/npm/PackageTarball",
) {
	/**
	 * The live service, over core's `FileSystem`, `Crypto`, `HttpClient` and
	 * `ChildProcessSpawner`. Pair it with {@link NpmRegistry.layer} to obtain the
	 * {@link PublishedVersion} that `extract` takes.
	 */
	static readonly layer: Layer.Layer<
		PackageTarball,
		never,
		FileSystem.FileSystem | Crypto.Crypto | HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner
	> = Layer.effect(PackageTarball)(make());
}
