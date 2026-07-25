import { LocalExec, Run } from "@effected/commands";
import type { Redacted } from "effect";
import { Context, Crypto, Effect, FileSystem, Layer, Option, Redacted as Red, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { IntegrityHash } from "./IntegrityHash.js";
import { NpmExecutor } from "./NpmExecutor.js";
import { PublishError } from "./PublishError.js";
import { classifyRegistry } from "./RegistryKind.js";

/** npm prints its transparency-log URL on this notice line. */
const PROVENANCE_URL = /https:\/\/search\.sigstore\.dev\/\?logIndex=\d+/;

/**
 * The npm config key that carries a registry's auth token.
 *
 * @remarks
 * npm "nerf-darts" the registry: scheme stripped, **trailing slash required**.
 * `//npm.pkg.github.com/:_authToken` matches; `//npm.pkg.github.com:_authToken`
 * never does, and the publish goes out unauthenticated with no diagnostic. A
 * registry path is preserved (`//host/artifactory/api/npm/repo/:_authToken`).
 */
const authTokenKey = (registry: string): string => {
	const withoutScheme = registry.replace(/^https?:/, "");
	const withSlash = withoutScheme.endsWith("/") ? withoutScheme : `${withoutScheme}/`;
	return `${withSlash}:_authToken`;
};

/** What `npm pack --json` reports for one tarball. */
const PackJsonEntry = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	filename: Schema.String,
	integrity: Schema.optionalKey(Schema.String),
	size: Schema.optionalKey(Schema.Number),
	unpackedSize: Schema.optionalKey(Schema.Number),
	entryCount: Schema.optionalKey(Schema.Number),
});

/** npm emits an array, one entry per packed package. */
const PackJson = Schema.Array(PackJsonEntry);

/**
 * A packed tarball and the two digests that describe it.
 *
 * @public
 */
export class PackedTarball extends Schema.Class<PackedTarball>("PackedTarball")({
	/** Absolute path to the tarball on disk. */
	tarballPath: Schema.String,
	/** Package name, as npm reported it. */
	name: Schema.String,
	/** Package version, as npm reported it. */
	version: Schema.String,
	/**
	 * npm's own integrity for the tarball (`sha512-<base64>`) — the value the
	 * registry stores as `dist.integrity`, so it compares directly against
	 * `NpmRegistry.version(...)`'s `integrity`.
	 */
	integrity: Schema.optionalKey(IntegrityHash),
	/**
	 * SHA-256 of the tarball bytes, lowercase hex, no prefix.
	 *
	 * @remarks
	 * **Not interchangeable with {@link PackedTarball.integrity}**: different
	 * algorithm, different encoding. This is the digest format the GitHub
	 * attestation APIs accept as a subject; comparing the two silently fails.
	 */
	sha256Hex: Schema.String,
	/** Tarball size in bytes. */
	packedSize: Schema.optionalKey(Schema.Number),
	/** Unpacked size in bytes. */
	unpackedSize: Schema.optionalKey(Schema.Number),
	/** Number of files in the tarball. */
	fileCount: Schema.optionalKey(Schema.Number),
}) {}

/**
 * What one publish produced.
 *
 * @public
 */
export interface PublishOutcome {
	/**
	 * npm's Sigstore transparency-log URL, when it published provenance.
	 * `None` for GitHub Packages, custom registries, and provenance-off runs.
	 */
	readonly provenanceUrl: Option.Option<string>;
}

/**
 * What a dry run reported.
 *
 * @remarks
 * `ok: false` is a **result**, not an error: "this package cannot pack" is a
 * valid answer to "would this publish?". The error channel is reserved for a
 * structural failure — npm could not be spawned, or its output was unreadable.
 * `npm pack --dry-run` never contacts a registry, so `ok: true` means the
 * package packs, **not** that a registry would accept it.
 *
 * @public
 */
export interface DryRunOutcome {
	readonly ok: boolean;
	readonly packedSize?: number | undefined;
	readonly unpackedSize?: number | undefined;
	readonly fileCount?: number | undefined;
	/** npm's output, for diagnostics. */
	readonly output: string;
}

/**
 * Options shared by the packing operations.
 *
 * @public
 */
export interface PackOptions {
	/** Which npm runs the command. Defaults to {@link NpmExecutor.ambient}. */
	readonly executor?: NpmExecutor | undefined;
}

/**
 * Options for uploading a tarball.
 *
 * @public
 */
export interface PublishOptions extends PackOptions {
	/** The registry to publish to. Required — a defaulted registry is how packages land in the wrong place. */
	readonly registry: string;
	/** dist-tag to apply. */
	readonly tag?: string | undefined;
	/** Access level for a scoped package. */
	readonly access?: "public" | "restricted" | undefined;
	/** Request npm's native provenance. */
	readonly provenance?: boolean | undefined;
	/**
	 * Force classic `_authToken` auth by blanking the Actions OIDC environment.
	 *
	 * @remarks
	 * npm attempts tokenless trusted publishing whenever the OIDC variables are
	 * present and does **not** fall back to a configured `_authToken` when that
	 * attempt fails. Required for GitHub Packages, and as the bootstrap path for
	 * a package with no trusted publisher configured yet.
	 */
	readonly tokenAuth?: boolean | undefined;
}

/**
 * The {@link PackagePublish} service shape.
 *
 * @public
 */
export interface PackagePublishShape {
	/**
	 * Write a registry auth token into an npmrc.
	 *
	 * @remarks
	 * The token goes to the file, **never to argv** — redaction protects this
	 * kit's error messages, not the operating system's process table. Masking
	 * the token in a CI log is the **caller's** job; this package takes a
	 * `Redacted` and has no opinion about log output.
	 */
	readonly setupAuth: (options: {
		readonly registry: string;
		readonly token: Redacted.Redacted<string>;
		readonly npmrcPath: string;
	}) => Effect.Effect<void, PublishError>;
	/** `npm pack --json` — writes the tarball and reports both digests. */
	readonly pack: (packageDir: string, options?: PackOptions) => Effect.Effect<PackedTarball, PublishError>;
	/** `npm publish <tarball>` — uploads bytes packed earlier, never re-packs. */
	readonly publishTarball: (
		tarballPath: string,
		options: PublishOptions,
	) => Effect.Effect<PublishOutcome, PublishError>;
	/** `npm pack --dry-run --json` — packability and sizing only. */
	readonly dryRun: (packageDir: string, options?: PackOptions) => Effect.Effect<DryRunOutcome, PublishError>;
}

/** Builds the service over already-resolved platform services. */
const make = Effect.fnUntraced(function* () {
	const fs = yield* FileSystem.FileSystem;
	const crypto = yield* Crypto.Crypto;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const local = yield* LocalExec;

	/**
	 * Discharges the two services the command path needs, once, here.
	 *
	 * @remarks
	 * `Run.collect` requires `ChildProcessSpawner` and `NpmExecutor.command`
	 * requires `LocalExec`. Resolving both at construction is what keeps every
	 * method's `R` at `never` — the `@effected/git` shape — so a consumer wires
	 * this service once and its methods compose anywhere.
	 */
	const discharge = <A, E>(
		effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | LocalExec>,
	): Effect.Effect<A, E> =>
		effect.pipe(
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
			Effect.provideService(LocalExec, local),
		);

	const hex = (bytes: Uint8Array): string =>
		Array.from(bytes)
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");

	/** Runs an npm invocation, mapping a command failure onto `kind`. */
	const npm = (
		args: ReadonlyArray<string>,
		options: {
			readonly executor: NpmExecutor;
			readonly cwd?: string | undefined;
			readonly env?: Record<string, string> | undefined;
			readonly kind: "pack" | "publish";
			readonly subject: string;
			readonly registry?: string | undefined;
		},
	) =>
		discharge(
			options.executor.command(args).pipe(
				Effect.map((command) => {
					const withCwd = options.cwd === undefined ? command : ChildProcess.setCwd(command, options.cwd);
					return options.env === undefined ? withCwd : ChildProcess.setEnv(withCwd, options.env);
				}),
				Effect.flatMap((command) => Run.collect(command)),
				Effect.catch((cause) =>
					Effect.fail(
						new PublishError({
							kind: options.kind,
							subject: options.subject,
							...(options.registry === undefined ? {} : { registry: options.registry }),
							cause,
						}),
					),
				),
			),
		);

	const parsePackJson = (stdout: string, subject: string) =>
		Effect.try({
			try: () => JSON.parse(stdout) as unknown,
			catch: (cause) => new PublishError({ kind: "output", subject, cause }),
		}).pipe(
			Effect.flatMap((parsed) =>
				Schema.decodeUnknownEffect(PackJson)(parsed).pipe(
					Effect.catch((cause) => Effect.fail(new PublishError({ kind: "output", subject, cause }))),
				),
			),
			Effect.flatMap((entries) => {
				const entry = entries[0];
				return entry === undefined
					? Effect.fail(new PublishError({ kind: "output", subject, output: stdout }))
					: Effect.succeed(entry);
			}),
		);

	const setupAuth = Effect.fn("PackagePublish.setupAuth")(function* (options: {
		readonly registry: string;
		readonly token: Redacted.Redacted<string>;
		readonly npmrcPath: string;
	}) {
		yield* Effect.annotateCurrentSpan({ registry: options.registry, npmrc: options.npmrcPath });
		const existing = yield* fs.readFileString(options.npmrcPath).pipe(Effect.catch(() => Effect.succeed("")));
		const line = `${authTokenKey(options.registry)}=${Red.value(options.token)}`;
		const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
		yield* fs
			.writeFileString(options.npmrcPath, `${existing}${separator}${line}\n`)
			.pipe(
				Effect.catch((cause) => Effect.fail(new PublishError({ kind: "auth", registry: options.registry, cause }))),
			);
	});

	const pack = Effect.fn("PackagePublish.pack")(function* (packageDir: string, options?: PackOptions) {
		yield* Effect.annotateCurrentSpan({ packageDir });
		const output = yield* npm(["pack", "--json"], {
			executor: options?.executor ?? NpmExecutor.ambient,
			cwd: packageDir,
			kind: "pack",
			subject: packageDir,
		});
		if (!output.succeeded) {
			return yield* Effect.fail(
				new PublishError({
					kind: "pack",
					subject: packageDir,
					exitCode: output.exitCode,
					output: output.stderr === "" ? output.stdout : output.stderr,
				}),
			);
		}
		const entry = yield* parsePackJson(output.stdout, packageDir);
		const tarballPath = `${packageDir}/${entry.filename}`;
		// The sha256 is computed from the tarball's own bytes, not from npm's
		// report: it is a different digest for a different consumer (attestation
		// subjects), and deriving it from the file is what makes it verifiable.
		const bytes = yield* fs
			.readFile(tarballPath)
			.pipe(Effect.catch((cause) => Effect.fail(new PublishError({ kind: "digest", subject: tarballPath, cause }))));
		const digest = yield* crypto
			.digest("SHA-256", bytes)
			.pipe(Effect.catch((cause) => Effect.fail(new PublishError({ kind: "digest", subject: tarballPath, cause }))));
		return PackedTarball.make({
			tarballPath,
			name: entry.name,
			version: entry.version,
			...integrityField(entry.integrity),
			sha256Hex: hex(digest),
			...(entry.size === undefined ? {} : { packedSize: entry.size }),
			...(entry.unpackedSize === undefined ? {} : { unpackedSize: entry.unpackedSize }),
			...(entry.entryCount === undefined ? {} : { fileCount: entry.entryCount }),
		});
	});

	const publishTarball = Effect.fn("PackagePublish.publishTarball")(function* (
		tarballPath: string,
		options: PublishOptions,
	) {
		yield* Effect.annotateCurrentSpan({ tarball: tarballPath, registry: options.registry });
		// Provenance is an npm-registry feature. Passing `--provenance` to GitHub
		// Packages or a custom registry fails the publish outright, so a caller
		// who asks for it against a non-npm target gets the publish without it
		// rather than a failed release — the v3 behavior, kept because a release
		// pipeline publishing to three registries should not lose two of them to
		// one flag.
		const provenance = options.provenance === true && classifyRegistry(options.registry) === "npm";
		const args = [
			"publish",
			tarballPath,
			"--registry",
			options.registry,
			...(options.tag === undefined ? [] : ["--tag", options.tag]),
			...(options.access === undefined ? [] : ["--access", options.access]),
			...(provenance ? ["--provenance"] : []),
		];
		const output = yield* npm(args, {
			executor: options.executor ?? NpmExecutor.ambient,
			kind: "publish",
			subject: tarballPath,
			registry: options.registry,
			// Blanking rather than deleting: `CommandOptions.env` is an overlay on
			// the inherited environment, so an empty value is how a variable is
			// suppressed without replacing the whole environment.
			...(options.tokenAuth === true
				? { env: { ACTIONS_ID_TOKEN_REQUEST_URL: "", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" } }
				: {}),
		});
		if (!output.succeeded) {
			return yield* Effect.fail(
				new PublishError({
					kind: "publish",
					subject: tarballPath,
					registry: options.registry,
					exitCode: output.exitCode,
					output: output.stderr === "" ? output.stdout : output.stderr,
				}),
			);
		}
		const printed = `${output.stdout}\n${output.stderr}`;
		return { provenanceUrl: Option.fromUndefinedOr(PROVENANCE_URL.exec(printed)?.[0]) } satisfies PublishOutcome;
	});

	const dryRun = Effect.fn("PackagePublish.dryRun")(function* (packageDir: string, options?: PackOptions) {
		yield* Effect.annotateCurrentSpan({ packageDir });
		const output = yield* npm(["pack", "--dry-run", "--json"], {
			executor: options?.executor ?? NpmExecutor.ambient,
			cwd: packageDir,
			kind: "pack",
			subject: packageDir,
		});
		if (!output.succeeded) {
			// A package that will not pack is an ANSWER, not a failure.
			return {
				ok: false,
				output: output.stderr === "" ? output.stdout : output.stderr,
			} satisfies DryRunOutcome;
		}
		const entry = yield* parsePackJson(output.stdout, packageDir);
		return {
			ok: true,
			output: output.stdout,
			...(entry.size === undefined ? {} : { packedSize: entry.size }),
			...(entry.unpackedSize === undefined ? {} : { unpackedSize: entry.unpackedSize }),
			...(entry.entryCount === undefined ? {} : { fileCount: entry.entryCount }),
		} satisfies DryRunOutcome;
	});

	return { setupAuth, pack, publishTarball, dryRun } satisfies PackagePublishShape;
});

/** The `integrity` field, present only when npm's value classifies. */
const integrityField = (raw: string | undefined): { integrity?: typeof IntegrityHash.Type } =>
	raw === undefined
		? {}
		: Option.match(Schema.decodeUnknownOption(IntegrityHash)(raw), {
				onNone: () => ({}),
				onSome: (integrity) => ({ integrity }),
			});

/** The default for an unstubbed {@link PackagePublish.makeTest} member. */
const notStubbed = (method: string) => () =>
	Effect.die(
		new Error(
			`PackagePublish.makeTest: ${method}() was called but not stubbed — no honest default exists for a test double; pass a \`${method}\` override.`,
		),
	);

/**
 * The npm publish workflow, run through `@effected/commands`.
 *
 * @remarks
 * Every invocation goes through `Run`, so a non-zero npm exit arrives as a
 * typed failure and npm's `--json` output is schema-decoded rather than cast.
 * The service deliberately does **not** own: masking (the caller's job, so no
 * Actions edge lives in a publish library), the npmrc location (caller-supplied
 * — resolving `~` needs `node:os`, which a boundary package may not import),
 * or a fused probe-then-publish (v3's `publishIdempotent`, deprecated in its
 * own source for hardcoding the wrong registry).
 *
 * @public
 */
export class PackagePublish extends Context.Service<PackagePublish, PackagePublishShape>()(
	"@effected/npm/PackagePublish",
) {
	/** Resolves its platform dependencies once at construction. */
	static readonly layer: Layer.Layer<
		PackagePublish,
		never,
		FileSystem.FileSystem | Crypto.Crypto | ChildProcessSpawner.ChildProcessSpawner | LocalExec
	> = Layer.effect(this, make());

	/**
	 * An in-memory double: stub only what the test exercises; every other member
	 * **dies** with a defect naming itself.
	 */
	static readonly makeTest = (overrides: Partial<PackagePublishShape> = {}): PackagePublishShape => ({
		setupAuth: notStubbed("setupAuth"),
		pack: notStubbed("pack"),
		publishTarball: notStubbed("publishTarball"),
		dryRun: notStubbed("dryRun"),
		...overrides,
	});

	/**
	 * {@link PackagePublish.makeTest} behind `Layer.succeed`.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh reference per call and layers
	 * memoize by reference — bind the result to a `const`.
	 */
	static readonly layerTest = (overrides: Partial<PackagePublishShape> = {}): Layer.Layer<PackagePublish> =>
		Layer.succeed(PackagePublish, PackagePublish.makeTest(overrides));
}
