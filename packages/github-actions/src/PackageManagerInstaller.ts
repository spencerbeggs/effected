import { createHash } from "node:crypto";
import type { PackageManagerPin } from "@effected/npm";
import { PackageManagerPinName } from "@effected/npm";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ActionEnvironment } from "./ActionEnvironment.js";
import type { ToolInstallerError } from "./ToolInstaller.js";
import { ToolInstaller } from "./ToolInstaller.js";

/**
 * Raised when a package manager cannot be provisioned on the runner.
 *
 * @public
 */
export class PackageManagerInstallerError extends Schema.TaggedErrorClass<PackageManagerInstallerError>()(
	"PackageManagerInstallerError",
	{
		/**
		 * `downloadFailed`, `extractFailed` and `cacheFailed` mirror the
		 * {@link ToolInstallerError} that caused them, preserved on `cause`.
		 * `integrityMismatch` — the downloaded artifact does not hash to what the
		 * pin declares; nothing was cached. `integrityMissing` — the pin carries no
		 * integrity and the caller asked for `requireIntegrity`.
		 * `unsupportedPlatform` — bun publishes no build for this runner's
		 * OS/architecture pair. `layoutUnexpected` — the artifact extracted, but
		 * its contents are not shaped like the package manager it claims to be.
		 */
		reason: Schema.Literals([
			"downloadFailed",
			"extractFailed",
			"integrityMismatch",
			"integrityMissing",
			"unsupportedPlatform",
			"layoutUnexpected",
			"cacheFailed",
		]),
		/** The package manager being installed. */
		name: PackageManagerPinName,
		/** The exact version being installed, in string form. */
		version: Schema.String,
		/** What was being worked on — a url, a path, or an OS/arch pair. */
		subject: Schema.optionalKey(Schema.String),
		/** The integrity the pin declares (`<algo>.<hex>`), on a mismatch. */
		expected: Schema.optionalKey(Schema.String),
		/** The integrity the artifact actually hashed to, on a mismatch. */
		actual: Schema.optionalKey(Schema.String),
		/** The underlying failure, preserved structurally. */
		cause: Schema.optionalKey(Schema.Defect()),
	},
) {
	override get message(): string {
		const pin = `${this.name}@${this.version}`;
		switch (this.reason) {
			case "downloadFailed":
				return `Could not download ${pin}${this.subject === undefined ? "" : ` from ${this.subject}`}`;
			case "extractFailed":
				return `Could not extract ${pin}${this.subject === undefined ? "" : ` (${this.subject})`}`;
			case "integrityMismatch":
				return `Integrity mismatch for ${pin}: expected ${this.expected}, got ${this.actual}`;
			case "integrityMissing":
				return `The pin for ${pin} carries no integrity hash and requireIntegrity is set`;
			case "unsupportedPlatform":
				return `No ${pin} build is published for ${this.subject}`;
			case "layoutUnexpected":
				return `The ${pin} artifact does not have the expected layout${this.subject === undefined ? "" : `: ${this.subject}`}`;
			default:
				return `Could not cache ${pin} into the tool cache`;
		}
	}
}

/**
 * How {@link PackageManagerInstallerShape.install} should behave.
 *
 * @public
 */
export interface PackageManagerInstallOptions {
	/**
	 * Fail with `integrityMissing` when the pin carries no integrity hash,
	 * instead of proceeding with a logged warning. Off by default, because
	 * in-the-wild `devEngines` pins routinely carry no integrity.
	 */
	readonly requireIntegrity?: boolean | undefined;
	/**
	 * The npm registry host the npm, pnpm and yarn tarballs download from.
	 * Defaults to `https://registry.npmjs.org`; a corporate mirror that serves
	 * the standard `/<name>/-/<basename>-<version>.tgz` tarball routes works
	 * unchanged. bun does not ship through a registry — its per-platform zip
	 * always comes from GitHub releases.
	 */
	readonly registry?: string | undefined;
}

/**
 * An installed package manager: where it landed and how to invoke it.
 *
 * @remarks
 * A `Schema.Class` rather than a plain record so a `pre` phase can persist it
 * through `ActionState` for `main` to read back.
 *
 * `bins` maps each bin name the manager publishes to the path that invokes it.
 * For a `tool-cache` install the values are absolute paths into the cached
 * directory — the npm-registry managers' entries are scripts to run with
 * `node` (`bin/npm-cli.js`, `bin/pnpm.cjs`, `bin/yarn.js`), bun's is the
 * native binary itself. For an `ambient` install the values are bare command
 * names resolved through `PATH`. Putting a cached bin on `PATH` is
 * deliberately not this service's job — a consumer that wants that calls
 * `ActionOutputs.addPath` itself.
 *
 * @public
 */
export class InstalledPackageManager extends Schema.Class<InstalledPackageManager>("InstalledPackageManager")({
	/** The package-manager name (`npm`, `pnpm`, `yarn` or `bun`). */
	name: PackageManagerPinName,
	/** The exact installed version, in string form. */
	version: Schema.String,
	/**
	 * Where the answer came from: `ambient` — the runner's own toolchain
	 * already had this exact version, nothing was downloaded; `tool-cache` —
	 * the manager lives in the runner's tool cache (found there, or installed
	 * into it by this call).
	 */
	source: Schema.Literals(["ambient", "tool-cache"]),
	/** The cached directory. Absent for an `ambient` answer, which has none. */
	directory: Schema.optionalKey(Schema.String),
	/** Bin name → the path (or ambient command name) that invokes it. */
	bins: Schema.Record(Schema.String, Schema.String),
}) {}

/**
 * The {@link PackageManagerInstaller} service shape.
 *
 * @public
 */
export interface PackageManagerInstallerShape {
	/**
	 * Provision the exact package-manager version a pin names, answering with
	 * where it landed and how to invoke it.
	 */
	readonly install: (
		pin: PackageManagerPin,
		options?: PackageManagerInstallOptions,
	) => Effect.Effect<InstalledPackageManager, PackageManagerInstallerError>;
}

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * The bun release asset name for a runner platform, or `None` when bun
 * publishes no build for it.
 *
 * Asset names verified against the `bun-v1.3.14` release: `bun-{linux,darwin,
 * windows}-{x64,aarch64}.zip`, with the runner's `RUNNER_OS` values mapped to
 * bun's spelling (`macOS` → `darwin`) and Node's `process.arch` to bun's
 * (`arm64` → `aarch64`).
 */
const bunTarget = (runnerOs: string, arch: string): Option.Option<string> => {
	const os =
		runnerOs.toLowerCase() === "linux"
			? "linux"
			: runnerOs.toLowerCase() === "macos"
				? "darwin"
				: runnerOs.toLowerCase() === "windows"
					? "windows"
					: undefined;
	const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "aarch64" : undefined;
	return os === undefined || cpu === undefined ? Option.none() : Option.some(`bun-${os}-${cpu}`);
};

/**
 * The registry tarball url for an npm-registry-distributed manager.
 *
 * The yarn split is corepack's own: `<2.0.0` is the `yarn` package, `>=2.0.0`
 * (Berry) ships as `@yarnpkg/cli-dist` — a scoped package, whose tarball
 * basename drops the scope (`/@yarnpkg/cli-dist/-/cli-dist-<v>.tgz`).
 */
const registryTarballUrl = (name: "npm" | "pnpm" | "yarn", version: string, major: number, registry: string): string =>
	name === "yarn" && major >= 2
		? `${registry}/@yarnpkg/cli-dist/-/cli-dist-${version}.tgz`
		: `${registry}/${name}/-/${name}-${version}.tgz`;

/** Normalize a package.json `bin` value into name → relative path entries. */
const normalizeBins = (bin: unknown, fallbackName: string): Option.Option<Record<string, string>> => {
	if (typeof bin === "string") {
		return Option.some({ [fallbackName]: bin.replace(/^\.\//, "") });
	}
	if (typeof bin !== "object" || bin === null) {
		return Option.none();
	}
	const entries: Record<string, string> = {};
	for (const [name, value] of Object.entries(bin)) {
		if (typeof value !== "string") {
			return Option.none();
		}
		entries[name] = value.replace(/^\.\//, "");
	}
	return Object.keys(entries).length === 0 ? Option.none() : Option.some(entries);
};

const make = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const installer = yield* ToolInstaller;

	// Resolved once, at construction — the platform comes from `RUNNER_OS`, the
	// runner's own answer, per the ToolInstaller precedent. `process.arch` is
	// the one spelling the tool-cache layout already uses.
	const runnerOs = yield* Effect.map(env.getOptional("RUNNER_OS"), (found) => Option.getOrElse(found, () => ""));
	const windows = runnerOs.toLowerCase() === "windows";
	const bunBinaryName = windows ? "bun.exe" : "bun";

	const errorFor =
		(pin: PackageManagerPin) =>
		(fields: {
			readonly reason: PackageManagerInstallerError["reason"];
			readonly subject?: string;
			readonly expected?: string;
			readonly actual?: string;
			readonly cause?: unknown;
		}): PackageManagerInstallerError =>
			new PackageManagerInstallerError({ name: pin.name, version: pin.version.toString(), ...fields });

	/** Map a ToolInstaller failure onto this surface; the reasons line up 1:1. */
	const fromInstaller =
		(pin: PackageManagerPin) =>
		(cause: ToolInstallerError): PackageManagerInstallerError =>
			errorFor(pin)({
				reason: cause.reason,
				...(cause.subject === undefined ? {} : { subject: cause.subject }),
				cause,
			});

	/** The hex digest of a file's bytes, streamed rather than buffered. */
	const hashFile = (
		pin: PackageManagerPin,
		file: string,
		algorithm: string,
	): Effect.Effect<string, PackageManagerInstallerError> =>
		Effect.suspend(() => {
			// The pin grammar admits sha1/sha256/sha384/sha512 only, all of which
			// `node:crypto` supports — `createHash` cannot throw here.
			const digest = createHash(algorithm);
			return fs.stream(file).pipe(
				Stream.runForEach((chunk) =>
					Effect.sync(() => {
						digest.update(chunk);
					}),
				),
				Effect.map(() => digest.digest("hex")),
				Effect.mapError((cause) => errorFor(pin)({ reason: "integrityMismatch", subject: file, cause })),
			);
		});

	/**
	 * Verify a downloaded artifact against the pin's integrity, fail-closed.
	 *
	 * A pin with no integrity proceeds with a logged warning — in-the-wild
	 * `devEngines` pins routinely carry none, and the opt-in strictness lives in
	 * `requireIntegrity`, checked before anything is downloaded.
	 */
	const verifyIntegrity = (pin: PackageManagerPin, file: string): Effect.Effect<void, PackageManagerInstallerError> =>
		Effect.gen(function* () {
			if (pin.integrity === undefined) {
				yield* Effect.logWarning(
					`The pin ${pin.toString()} carries no integrity hash; the downloaded artifact was not verified.`,
				);
				return;
			}
			const dot = pin.integrity.indexOf(".");
			const algorithm = pin.integrity.slice(0, dot);
			const expectedHex = pin.integrity.slice(dot + 1);
			const actualHex = yield* hashFile(pin, file, algorithm);
			if (actualHex !== expectedHex) {
				return yield* Effect.fail(
					errorFor(pin)({
						reason: "integrityMismatch",
						subject: file,
						expected: pin.integrity,
						actual: `${algorithm}.${actualHex}`,
					}),
				);
			}
		});

	/**
	 * The ambient `npm --version`, or `None` when the probe cannot answer.
	 *
	 * A failed probe is not an error — there is nothing a caller could do about
	 * it that the dist path does not already do.
	 */
	const ambientNpmVersion: Effect.Effect<Option.Option<string>> = Effect.map(
		Effect.result(spawner.string(ChildProcess.make("npm", ["--version"]))),
		(result) => (result._tag === "Success" ? Option.some(result.success.trim()) : Option.none()),
	);

	/**
	 * The bin entries a package directory publishes, from its own manifest.
	 *
	 * Read from the artifact rather than hardcoded per manager, because the
	 * layouts genuinely move — corepack's own table has pnpm's entry at
	 * `bin/pnpm.cjs` through v10 and `bin/pnpm.mjs` from v11.
	 */
	const readPackageBins = (
		pin: PackageManagerPin,
		packageDir: string,
	): Effect.Effect<Record<string, string>, PackageManagerInstallerError> =>
		Effect.gen(function* () {
			const manifestPath = path.join(packageDir, "package.json");
			const raw = yield* fs
				.readFileString(manifestPath)
				.pipe(
					Effect.mapError((cause) => errorFor(pin)({ reason: "layoutUnexpected", subject: "no package.json", cause })),
				);
			const manifest = yield* Effect.try({
				try: () => JSON.parse(raw) as { readonly bin?: unknown },
				catch: (cause) => errorFor(pin)({ reason: "layoutUnexpected", subject: "unparseable package.json", cause }),
			});
			const bins = Option.getOrUndefined(normalizeBins(manifest.bin, pin.name));
			if (bins === undefined) {
				return yield* Effect.fail(errorFor(pin)({ reason: "layoutUnexpected", subject: "package.json names no bin" }));
			}
			for (const [name, relative] of Object.entries(bins)) {
				yield* assertFile(pin, path.join(packageDir, relative), `bin ${name} (${relative}) is missing`);
			}
			return bins;
		});

	const assertFile = (
		pin: PackageManagerPin,
		file: string,
		subject: string,
	): Effect.Effect<void, PackageManagerInstallerError> =>
		Effect.gen(function* () {
			const stat = yield* Effect.result(fs.stat(file));
			if (stat._tag !== "Success" || stat.success.type !== "File") {
				return yield* Effect.fail(errorFor(pin)({ reason: "layoutUnexpected", subject }));
			}
		});

	const rootBins = (bins: Record<string, string>, directory: string): Record<string, string> =>
		Object.fromEntries(Object.entries(bins).map(([name, relative]) => [name, path.join(directory, relative)]));

	/** The record for a directory already in (or just installed into) the cache. */
	const cachedRecord = (
		pin: PackageManagerPin,
		directory: string,
	): Effect.Effect<InstalledPackageManager, PackageManagerInstallerError> =>
		Effect.gen(function* () {
			if (pin.name === "bun") {
				const binary = path.join(directory, bunBinaryName);
				yield* assertFile(pin, binary, `cached bun binary (${bunBinaryName}) is missing`);
				return InstalledPackageManager.make({
					name: pin.name,
					version: pin.version.toString(),
					source: "tool-cache",
					directory,
					bins: { bun: binary },
				});
			}
			const bins = yield* readPackageBins(pin, directory);
			return InstalledPackageManager.make({
				name: pin.name,
				version: pin.version.toString(),
				source: "tool-cache",
				directory,
				bins: rootBins(bins, directory),
			});
		});

	/** Download bun's per-platform zip from GitHub releases and cache the binary. */
	const installBun = (pin: PackageManagerPin): Effect.Effect<InstalledPackageManager, PackageManagerInstallerError> =>
		Effect.gen(function* () {
			const version = pin.version.toString();
			const target = Option.getOrUndefined(bunTarget(runnerOs, process.arch));
			if (target === undefined) {
				return yield* Effect.fail(
					errorFor(pin)({ reason: "unsupportedPlatform", subject: `${runnerOs || "unknown"}/${process.arch}` }),
				);
			}
			const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${target}.zip`;
			const archive = yield* installer.download(url).pipe(Effect.mapError(fromInstaller(pin)));
			// No corepack authority exists for bun (corepack does not manage it), so
			// an integrity-carrying bun pin verifies against the downloaded zip —
			// which makes such a pin inherently platform-specific.
			yield* verifyIntegrity(pin, archive);
			const extracted = yield* installer.extractZip(archive).pipe(Effect.mapError(fromInstaller(pin)));
			const binary = path.join(extracted, target, bunBinaryName);
			yield* assertFile(pin, binary, `${target}/${bunBinaryName} is missing from the zip`);
			if (!windows) {
				// The zip does not reliably carry the executable bit through every
				// extractor; the cached binary must be invokable as-is.
				yield* fs
					.chmod(binary, 0o755)
					.pipe(Effect.mapError((cause) => errorFor(pin)({ reason: "cacheFailed", subject: binary, cause })));
			}
			const directory = yield* installer
				.cacheFile(binary, bunBinaryName, pin.name, version)
				.pipe(Effect.mapError(fromInstaller(pin)));
			return InstalledPackageManager.make({
				name: pin.name,
				version,
				source: "tool-cache",
				directory,
				bins: { bun: path.join(directory, bunBinaryName) },
			});
		});

	/** Download a registry tarball, verify, extract, and cache its package dir. */
	const installFromRegistry = (
		pin: PackageManagerPin,
		name: "npm" | "pnpm" | "yarn",
		registry: string,
	): Effect.Effect<InstalledPackageManager, PackageManagerInstallerError> =>
		Effect.gen(function* () {
			const version = pin.version.toString();
			const url = registryTarballUrl(name, version, pin.version.major, registry);
			const archive = yield* installer.download(url).pipe(Effect.mapError(fromInstaller(pin)));
			// What a corepack pin's integrity hashes depends on the manager:
			// npm, pnpm and yarn 1.x pins hash the registry tarball's bytes; a
			// yarn>=2 pin hashes the standalone `yarn.js` corepack downloads from
			// repo.yarnpkg.com — byte-identical to `bin/yarn.js` inside the
			// @yarnpkg/cli-dist tarball, which is where it is verified below.
			const berry = name === "yarn" && pin.version.major >= 2;
			if (!berry) {
				yield* verifyIntegrity(pin, archive);
			}
			const extracted = yield* installer.extractTar(archive).pipe(Effect.mapError(fromInstaller(pin)));
			const packageDir = path.join(extracted, "package");
			const stat = yield* Effect.result(fs.stat(packageDir));
			if (stat._tag !== "Success" || stat.success.type !== "Directory") {
				return yield* Effect.fail(
					errorFor(pin)({ reason: "layoutUnexpected", subject: "tarball has no package/ root" }),
				);
			}
			const bins = yield* readPackageBins(pin, packageDir);
			if (berry) {
				const cli = path.join(packageDir, "bin/yarn.js");
				yield* assertFile(pin, cli, "bin/yarn.js is missing from the cli-dist tarball");
				yield* verifyIntegrity(pin, cli);
			}
			const directory = yield* installer.cacheDir(packageDir, name, version).pipe(Effect.mapError(fromInstaller(pin)));
			return InstalledPackageManager.make({
				name,
				version,
				source: "tool-cache",
				directory,
				bins: rootBins(bins, directory),
			});
		});

	const install = Effect.fn("PackageManagerInstaller.install")(function* (
		pin: PackageManagerPin,
		options?: PackageManagerInstallOptions,
	) {
		const version = pin.version.toString();
		yield* Effect.annotateCurrentSpan({ name: pin.name, version });

		// The strictness is a statement about the PIN, so it is decided before
		// any path — a cache hit does not launder an integrity-less pin.
		if (options?.requireIntegrity === true && pin.integrity === undefined) {
			return yield* Effect.fail(errorFor(pin)({ reason: "integrityMissing" }));
		}

		const cached = yield* installer.find(pin.name, version);
		if (Option.isSome(cached)) {
			return yield* cachedRecord(pin, cached.value);
		}

		// Every Node toolchain ships npm; when the ambient one is already the
		// pinned version there is nothing to download. A failed probe falls
		// through to the dist path rather than failing.
		if (pin.name === "npm") {
			const probed = yield* ambientNpmVersion;
			if (Option.isSome(probed) && probed.value === version) {
				return InstalledPackageManager.make({
					name: pin.name,
					version,
					source: "ambient",
					bins: { npm: "npm", npx: "npx" },
				});
			}
		}

		if (pin.name === "bun") {
			return yield* installBun(pin);
		}
		const registry = (options?.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, "");
		return yield* installFromRegistry(pin, pin.name, registry);
	});

	return { install } satisfies PackageManagerInstallerShape;
});

const unimplemented = (member: string): never => {
	throw new Error(
		`PackageManagerInstaller.makeTest: ${member}() was called but not stubbed — pass a \`${member}\` override.`,
	);
};

/**
 * First-class exact-version package-manager provisioning on a GitHub runner.
 *
 * @remarks
 * Takes a corepack pin (`@effected/npm`'s `PackageManagerPin`) and answers
 * with an installed manager: tool-cache `find` first, then — for npm — an
 * ambient `npm --version` probe (every Node toolchain ships npm), and only
 * then the manager's own dist: npm, pnpm and yarn 1.x from their registry
 * tarballs, yarn 2+ (Berry) from `@yarnpkg/cli-dist`, bun from its
 * per-platform GitHub-release zip. A pin that carries integrity is verified
 * fail-closed against what corepack itself hashes; one that does not proceeds
 * with a logged warning unless `requireIntegrity` says otherwise.
 *
 * Caching goes through {@link ToolInstaller}, so the stage-then-swap
 * invariant holds here for free: the tool cache only ever contains complete
 * package managers.
 *
 * @example
 * ```ts
 * import { PackageManagerInstaller } from "@effected/github-actions";
 * import { PackageManagerPin } from "@effected/npm";
 * import { Effect } from "effect";
 *
 * const provision = Effect.gen(function* () {
 *   const installer = yield* PackageManagerInstaller;
 *   const pin = yield* PackageManagerPin.parse("pnpm@10.13.1");
 *   const installed = yield* installer.install(pin);
 *   return installed.bins.pnpm;
 * });
 * ```
 *
 * @public
 */
export class PackageManagerInstaller extends Context.Service<PackageManagerInstaller, PackageManagerInstallerShape>()(
	"@effected/github-actions/PackageManagerInstaller",
) {
	static readonly layer: Layer.Layer<
		PackageManagerInstaller,
		never,
		ActionEnvironment | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | ToolInstaller
	> = Layer.effect(this, make);

	/** A test double. The unstubbed member dies rather than reporting an install that did not happen. */
	static readonly makeTest = (overrides: Partial<PackageManagerInstallerShape> = {}): PackageManagerInstallerShape => ({
		install: () => Effect.sync(() => unimplemented("install")),
		...overrides,
	});

	/** {@link PackageManagerInstaller.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (
		overrides: Partial<PackageManagerInstallerShape> = {},
	): Layer.Layer<PackageManagerInstaller> =>
		Layer.succeed(PackageManagerInstaller, PackageManagerInstaller.makeTest(overrides));
}
