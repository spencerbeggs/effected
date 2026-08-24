import { Run } from "@effected/commands";
import type { Scope } from "effect";
import { Context, Crypto, Effect, Encoding, FileSystem, Layer, Option, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { IntegrityHash } from "./IntegrityHash.js";
import type { PublishedVersion } from "./NpmRegistry.js";

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
	 * and the failure that results is silent: a downstream reported an
	 * integrity mismatch being handled as a missing merge base, which
	 * downgraded a merge to a lossy algorithm and dropped a user's override on
	 * a run that reported success.
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
	 */
	readonly extract: (published: PublishedVersion) => Effect.Effect<string, TarballError, Scope.Scope>;
}

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
	const http = yield* HttpClient.HttpClient;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	const extract = Effect.fn("PackageTarball.extract")(function* (published: PublishedVersion) {
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

		const response = yield* http.get(url).pipe(Effect.mapError((cause) => fail("http", { cause })));

		// A non-2xx body must be caught BEFORE it reaches the disk: piping a 404
		// error page to `tar` surfaces as a misleading "could not extract"
		// instead of naming the real failure. A downstream paid for this one.
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
				const actual = `${expected.slice(0, expected.indexOf("-"))}-${Encoding.encodeBase64(digest)}`;
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
 * `PackagePublish` sends a tarball out, but nothing read a published one back.
 * The need is real and not served elsewhere — reading something out of a
 * published package **before any install has run**, which is what a tool
 * reproducing a package manager's config-dependency workflow has to do, since
 * its output is the input the install then consumes.
 *
 * Pair it with `resolveEntryPoint` from `@effected/package-json` to find
 * the package's entry file inside the extracted directory. Loading that file is
 * deliberately **not** part of this surface: a dynamic `import()` of a computed
 * path is compiled into a context module by bundlers, and a kit-level loader
 * would hand every bundling consumer that problem with no seam to fix it.
 *
 * **Extraction shells out to `tar`** through core's `ChildProcessSpawner`
 * rather than taking a tarball-reader dependency — which is a tier decision,
 * not a convenience: a non-core runtime dependency here would make this package
 * *integrated*, and that propagates to the pure packages that depend on it for
 * vocabulary. `tar` is on every CI runner image; a consumer off a runner needs
 * both a spawner and the binary.
 *
 * @example
 * ```ts
 * import { NpmRegistry, PackageTarball } from "@effected/npm";
 * import { resolveEntryPoint } from "@effected/package-json";
 * import { Effect, Option } from "effect";
 *
 * const read = Effect.gen(function* () {
 *   const registry = yield* NpmRegistry;
 *   const tarball = yield* PackageTarball;
 *   const found = yield* registry.version("some-config", "1.2.3");
 *   if (Option.isNone(found)) return Option.none();
 *   const directory = yield* tarball.extract(found.value);
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
	 * The live service, over core's filesystem, crypto, HTTP and process
	 * contracts.
	 */
	static readonly layer: Layer.Layer<
		PackageTarball,
		never,
		FileSystem.FileSystem | Crypto.Crypto | HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner
	> = Layer.effect(PackageTarball)(make());
}
