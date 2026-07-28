import type { Duration } from "effect";
import { Context, Effect, FileSystem, Layer, Option, Path, Schedule, Schema, Stream } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ActionEnvironment } from "./ActionEnvironment.js";

/**
 * Raised when a tool cannot be downloaded, extracted or cached.
 *
 * @public
 */
export class ToolInstallerError extends Schema.TaggedErrorClass<ToolInstallerError>()("ToolInstallerError", {
	/**
	 * `downloadFailed` — the archive could not be fetched. `extractFailed` — the
	 * extraction tool refused the archive or is not installed. `cacheFailed` —
	 * the tool could not be written into the runner's tool cache.
	 */
	reason: Schema.Literals(["downloadFailed", "extractFailed", "cacheFailed"]),
	/** The HTTP status, when there was one. Drives the retry decision. */
	status: Schema.optionalKey(Schema.Number),
	/** What was being worked on — a url, an archive path, or a tool name. */
	subject: Schema.optionalKey(Schema.String),
	/** The extraction tool's own complaint, which is the only useful part of a tar failure. */
	stderr: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		switch (this.reason) {
			case "downloadFailed":
				return `Could not download ${this.subject}${this.status === undefined ? "" : ` (HTTP ${this.status})`}`;
			case "extractFailed":
				return `Could not extract ${this.subject}${this.stderr === undefined ? "" : `: ${this.stderr}`}`;
			default:
				return `Could not cache ${this.subject} into the tool cache`;
		}
	}

	/**
	 * Whether retrying could plausibly help.
	 *
	 * @remarks
	 * A derived getter rather than a field, so it cannot be set inconsistently
	 * with the status it is derived from. `408`, `429` and any `5xx` are the
	 * server saying "later"; a `404` is it saying "never", and retrying that
	 * three times just makes a broken url take longer to fail.
	 */
	get retryable(): boolean {
		if (this.reason !== "downloadFailed") {
			return false;
		}
		if (this.status === undefined) {
			// No status means the request never completed — a transport fault, which
			// is the most retryable thing there is.
			return true;
		}
		return this.status >= 500 || this.status === 408 || this.status === 429;
	}
}

/**
 * Where extraction should put its output.
 *
 * @public
 */
export interface ExtractOptions {
	/** The destination. A fresh temporary directory when omitted. */
	readonly destination?: string | undefined;
	/**
	 * Flags for `tar`. Defaults to `["xzf"]`, i.e. a gzipped tarball.
	 *
	 * @remarks
	 * The argv is assembled as `[...flags, archive, "-C", destination]` — the
	 * archive path is appended directly AFTER the flags, so the LAST flag must
	 * be the one that consumes the archive operand. `["xzf"]` works because `f`
	 * is last inside the cluster; a custom set like `["xz", "--strip=1", "-f"]`
	 * must end the same way, deliberately rather than by ordering luck.
	 */
	readonly flags?: ReadonlyArray<string> | undefined;
}

/**
 * How a {@link ToolInstallerShape.download} should behave.
 *
 * @public
 */
export interface ToolDownloadOptions {
	/**
	 * The overall time budget for ONE download attempt (request plus streaming
	 * the body to disk). Defaults to five minutes.
	 *
	 * @remarks
	 * The default is deliberately generous: toolchain archives run to hundreds
	 * of megabytes, and a healthy runner connection moves tens of megabytes a
	 * second — even a 500 MB archive on a degraded 2 MB/s link fits in five
	 * minutes. What the budget exists for is the connection that stops moving
	 * entirely: without it, a dead connection is a silent CI hang until the job
	 * timeout; with it, the attempt fails typed as `downloadFailed` with no
	 * status — which `retryable` classifies as a transport fault — and the
	 * download's own retry policy tries again.
	 */
	readonly timeout?: Duration.Input | undefined;
}

/**
 * The {@link ToolInstaller} service shape.
 *
 * @public
 */
export interface ToolInstallerShape {
	/**
	 * A cached tool, if this runner already has it.
	 *
	 * @remarks
	 * Absent is not an error, and neither is an unreadable cache: both mean
	 * "install it", which is the only thing a caller can do about either.
	 *
	 * **The tool cache is SHARED.** The hosted runner image pre-populates it and
	 * every `setup-*` action writes into it — this package is a co-writer, not
	 * the owner. A hit guarantees only the `<root>/<tool>/<version>/<arch>`
	 * location contract ({@link ToolInstaller.cachePath}); the directory's
	 * *interior* layout is whatever its writer produced, which is not
	 * necessarily what this consumer's own `cacheDir` would have written.
	 * Validate the layout of a foreign hit before relying on it — applying an
	 * assumption from your own install path (an archive-wrapper subdirectory,
	 * say) to a foreign entry is a real shipped bug.
	 */
	readonly find: (tool: string, version: string) => Effect.Effect<Option.Option<string>>;
	/** Download a url to a temporary file, retrying what is worth retrying. */
	readonly download: (url: string, options?: ToolDownloadOptions) => Effect.Effect<string, ToolInstallerError>;
	/** Extract a tarball. Returns the directory its contents landed in. */
	readonly extractTar: (archive: string, options?: ExtractOptions) => Effect.Effect<string, ToolInstallerError>;
	/** Extract a zip. Returns the directory its contents landed in. */
	readonly extractZip: (archive: string, options?: ExtractOptions) => Effect.Effect<string, ToolInstallerError>;
	/** Install a directory into the tool cache. Returns its cached path. */
	readonly cacheDir: (source: string, tool: string, version: string) => Effect.Effect<string, ToolInstallerError>;
	/** Install a single file into the tool cache under `name`. Returns the cached directory. */
	readonly cacheFile: (
		source: string,
		name: string,
		tool: string,
		version: string,
	) => Effect.Effect<string, ToolInstallerError>;
}

/** How many times a retryable download is retried before giving up. */
const DOWNLOAD_RETRIES = 2;

/** The default per-attempt download budget. See {@link ToolDownloadOptions.timeout}. */
const DOWNLOAD_TIMEOUT: Duration.Input = "5 minutes";

const make = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const http = yield* HttpClient.HttpClient;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	// Resolved once, at construction. The source package read `RUNNER_TOOL_CACHE`
	// into a module-level constant at import time, which fixes the cache root
	// before any layer has had a chance to say otherwise and makes it impossible
	// to point at a different one in a test.
	const root = yield* Effect.map(env.getOptional("RUNNER_TOOL_CACHE"), (found) =>
		Option.getOrElse(found, () => path.join("/tmp", "runner-tool-cache")),
	);
	const windows = yield* Effect.map(env.getOptional("RUNNER_OS"), (found) =>
		Option.match(found, { onNone: () => false, onSome: (os) => os.toLowerCase() === "windows" }),
	);

	const cachePath = (tool: string, version: string): string =>
		ToolInstaller.cachePath({ root, tool, version, arch: process.arch });

	const destinationFor = (options: ExtractOptions | undefined): Effect.Effect<string, ToolInstallerError> => {
		const requested = options?.destination;
		if (requested === undefined) {
			return fs
				.makeTempDirectory({ prefix: "effected-extract-" })
				.pipe(Effect.mapError((cause) => new ToolInstallerError({ reason: "extractFailed", cause })));
		}
		return fs.makeDirectory(requested, { recursive: true }).pipe(
			Effect.as(requested),
			Effect.mapError((cause) => new ToolInstallerError({ reason: "extractFailed", subject: requested, cause })),
		);
	};

	/**
	 * Run an extraction command ONCE, keeping its stderr.
	 *
	 * @remarks
	 * `tar`'s exit code says only that it failed; its stderr says why, and it is
	 * the difference between "this is not a gzip archive" and "tar is not
	 * installed". Discarding it is what makes an extraction failure unactionable.
	 *
	 * **One spawn, not two — load-bearing.** The spawner's convenience members
	 * each spawn independently: `string` collects output without inspecting the
	 * exit code, and `exitCode` runs the command AGAIN (core's
	 * `ChildProcessSpawner.make` derives both from `spawn`). Calling them
	 * back-to-back double-executed every extraction — harmless for idempotent
	 * `tar`/`unzip -o`, but .NET's `ZipFile.ExtractToDirectory` refuses to
	 * overwrite, so the second run failed 5/5 on real Windows runners while the
	 * captured "complaint" was the FIRST run's silent success. Output and exit
	 * code must come from the same `spawn` handle.
	 */
	const extractWith = (command: ChildProcess.Command, archive: string): Effect.Effect<void, ToolInstallerError> =>
		Effect.scoped(
			Effect.gen(function* () {
				const extractError = (cause: unknown) =>
					new ToolInstallerError({ reason: "extractFailed", subject: archive, cause });
				const handle = yield* spawner.spawn(command).pipe(Effect.mapError(extractError));
				// Drain stdout+stderr BEFORE awaiting the exit code, so a chatty
				// extractor cannot deadlock on a full pipe; the stream ends at exit.
				const output = yield* Stream.mkString(Stream.decodeText(handle.all)).pipe(Effect.mapError(extractError));
				const code = yield* handle.exitCode.pipe(Effect.mapError(extractError));
				if (code !== 0) {
					return yield* Effect.fail(
						new ToolInstallerError({ reason: "extractFailed", subject: archive, stderr: output.trim() }),
					);
				}
			}),
		);

	/**
	 * Install a staged directory into the tool cache by renaming it into place.
	 *
	 * @remarks
	 * **Stage then swap**, and the reason is that the alternative is worse than a
	 * failed install: copying straight into the cache path leaves a *partial*
	 * tool behind when the copy fails halfway, and `find` reports a partial
	 * directory as a hit. Every later run then uses a half-extracted toolchain
	 * and never re-downloads it. A rename within one filesystem is atomic, so the
	 * cache only ever contains complete tools.
	 */
	const swapIntoCache = (staging: string, tool: string, version: string): Effect.Effect<string, ToolInstallerError> =>
		Effect.gen(function* () {
			const destination = cachePath(tool, version);
			yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
			// A previous interrupted install, or a re-install of the same version.
			yield* fs.remove(destination, { recursive: true, force: true });
			yield* fs.rename(staging, destination);
			return destination;
		}).pipe(Effect.mapError((cause) => new ToolInstallerError({ reason: "cacheFailed", subject: tool, cause })));

	/** A staging directory beside the cache, so the swap is a rename and not a copy. */
	const staged = <A>(
		tool: string,
		use: (staging: string) => Effect.Effect<A, ToolInstallerError>,
	): Effect.Effect<A, ToolInstallerError> =>
		Effect.gen(function* () {
			// `directory: root` matters: a rename across filesystems is not atomic
			// (and on many platforms not permitted at all), so the staging area has
			// to live under the cache root rather than in the system temp directory.
			yield* fs.makeDirectory(root, { recursive: true });
			const staging = yield* fs.makeTempDirectory({ directory: root, prefix: ".staging-" });
			return staging;
		}).pipe(
			Effect.mapError((cause) => new ToolInstallerError({ reason: "cacheFailed", subject: tool, cause })),
			Effect.flatMap((staging) =>
				use(staging).pipe(
					// Removed on the failure path only: on the success path it has
					// already been renamed away and is no longer there to remove.
					Effect.tapCause(() => Effect.ignore(fs.remove(staging, { recursive: true, force: true }))),
				),
			),
		);

	const download = Effect.fn("ToolInstaller.download")(function* (url: string, options?: ToolDownloadOptions) {
		const attempt = Effect.gen(function* () {
			const response = yield* http
				.get(url)
				.pipe(Effect.mapError((cause) => new ToolInstallerError({ reason: "downloadFailed", subject: url, cause })));
			if (response.status < 200 || response.status >= 300) {
				return yield* Effect.fail(
					new ToolInstallerError({ reason: "downloadFailed", subject: url, status: response.status }),
				);
			}
			const directory = yield* fs
				.makeTempDirectory({ prefix: "effected-download-" })
				.pipe(Effect.mapError((cause) => new ToolInstallerError({ reason: "downloadFailed", subject: url, cause })));
			const file = path.join(directory, "download");
			// Streamed to disk rather than buffered: a toolchain archive is measured
			// in hundreds of megabytes and a runner is not generous with memory.
			yield* Stream.run(response.stream, fs.sink(file)).pipe(
				Effect.mapError((cause) => new ToolInstallerError({ reason: "downloadFailed", subject: url, cause })),
			);
			return file;
		});

		return yield* attempt.pipe(
			// The per-attempt budget sits INSIDE the retry: a connection that stops
			// moving becomes a typed, statusless (and therefore retryable)
			// downloadFailed instead of a silent hang to the job timeout.
			Effect.timeout(options?.timeout ?? DOWNLOAD_TIMEOUT),
			Effect.catchTag("TimeoutError", (cause) =>
				Effect.fail(new ToolInstallerError({ reason: "downloadFailed", subject: url, cause })),
			),
			Effect.retry({
				schedule: Schedule.exponential("1 second"),
				times: DOWNLOAD_RETRIES,
				while: (error: ToolInstallerError) => error.retryable,
			}),
		);
	});

	return {
		find: (tool: string, version: string) =>
			Effect.map(Effect.result(fs.stat(cachePath(tool, version))), (result) =>
				result._tag === "Success" && result.success.type === "Directory"
					? Option.some(cachePath(tool, version))
					: Option.none(),
			),

		download,

		extractTar: Effect.fn("ToolInstaller.extractTar")(function* (archive: string, options?: ExtractOptions) {
			const destination = yield* destinationFor(options);
			const flags = options?.flags === undefined || options.flags.length === 0 ? ["xzf"] : [...options.flags];
			yield* extractWith(ChildProcess.make("tar", [...flags, archive, "-C", destination]), archive);
			return destination;
		}),

		extractZip: Effect.fn("ToolInstaller.extractZip")(function* (archive: string, options?: ExtractOptions) {
			const destination = yield* destinationFor(options);
			// The platform comes from `RUNNER_OS` rather than `process.platform`,
			// which is both the runner's own answer and the only version of this
			// branch that a test on any host can reach.
			// The pwsh branch is deliberately belt-and-braces: the THREE-argument
			// `ExtractToDirectory(src, dest, $true)` overload overwrites existing
			// files (the two-argument one refuses, which is what turned a repeated
			// extraction into a hard failure), and the try/catch writes the actual
			// .NET exception text plainly to stderr and exits 1 — pwsh's own error
			// rendering does not reliably reach a captured stream, and an empty
			// complaint costs a source dive to even hypothesize about.
			const command = windows
				? ChildProcess.make("pwsh", [
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						`$ErrorActionPreference = 'Stop'; try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archive.replaceAll("'", "''")}', '${destination.replaceAll("'", "''")}', $true) } catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }`,
					])
				: ChildProcess.make("unzip", ["-oq", archive, "-d", destination]);
			yield* extractWith(command, archive);
			return destination;
		}),

		cacheDir: Effect.fn("ToolInstaller.cacheDir")(function* (source: string, tool: string, version: string) {
			yield* Effect.annotateCurrentSpan({ tool, version });
			return yield* staged(tool, (staging) =>
				fs.copy(source, staging, { overwrite: true }).pipe(
					Effect.mapError((cause) => new ToolInstallerError({ reason: "cacheFailed", subject: tool, cause })),
					Effect.flatMap(() => swapIntoCache(staging, tool, version)),
				),
			);
		}),

		cacheFile: Effect.fn("ToolInstaller.cacheFile")(function* (
			source: string,
			name: string,
			tool: string,
			version: string,
		) {
			yield* Effect.annotateCurrentSpan({ tool, version });
			return yield* staged(tool, (staging) =>
				fs.copyFile(source, path.join(staging, name)).pipe(
					Effect.mapError((cause) => new ToolInstallerError({ reason: "cacheFailed", subject: tool, cause })),
					Effect.flatMap(() => swapIntoCache(staging, tool, version)),
				),
			);
		}),
	} satisfies ToolInstallerShape;
});

const unimplemented = (member: string): never => {
	throw new Error(`ToolInstaller.makeTest: ${member}() was called but not stubbed — pass a \`${member}\` override.`);
};

/**
 * Download, extract and cache a toolchain in the runner's tool cache.
 *
 * @remarks
 * The primitives, not a workflow: a consumer composes `find` → `download` →
 * `extractTar` → `cacheDir` in whatever order its tool needs, because the
 * orders genuinely differ (a single binary skips extraction, a tarball with a
 * nested root directory needs a path fixup between extract and cache).
 *
 * No `@actions/tool-cache` dependency — the cache is a directory layout, and
 * this reproduces the layout rather than importing a package to compute it.
 *
 * @example
 * ```ts
 * import { ToolInstaller } from "@effected/github-actions";
 * import { Effect, Option } from "effect";
 *
 * const install = Effect.gen(function* () {
 *   const installer = yield* ToolInstaller;
 *   const cached = yield* installer.find("node", "22.11.0");
 *   if (Option.isSome(cached)) return cached.value;
 *   const archive = yield* installer.download("https://nodejs.org/dist/v22.11.0/node.tar.gz");
 *   const extracted = yield* installer.extractTar(archive);
 *   return yield* installer.cacheDir(extracted, "node", "22.11.0");
 * });
 * ```
 *
 * @public
 */
export class ToolInstaller extends Context.Service<ToolInstaller, ToolInstallerShape>()(
	"@effected/github-actions/ToolInstaller",
) {
	static readonly layer: Layer.Layer<
		ToolInstaller,
		never,
		| ActionEnvironment
		| FileSystem.FileSystem
		| Path.Path
		| HttpClient.HttpClient
		| ChildProcessSpawner.ChildProcessSpawner
	> = Layer.effect(this, make);

	/**
	 * Where a tool lives in the cache.
	 *
	 * @remarks
	 * Pure, exported and tested on its own, because the layout is a **contract
	 * with the runner**: `<root>/<tool>/<version>/<arch>` is what the hosted
	 * image populates and what `@actions/tool-cache` reads, so a tool cached at
	 * any other path is invisible to every other step in the workflow. The `arch`
	 * segment uses Node's `process.arch` spelling (`x64`) rather than the
	 * runner's `RUNNER_ARCH` (`X64`) for the same reason.
	 */
	static readonly cachePath = (options: {
		readonly root: string;
		readonly tool: string;
		readonly version: string;
		readonly arch: string;
	}): string => `${options.root}/${options.tool}/${options.version}/${options.arch}`;

	/** A test double. Unstubbed members die rather than reporting a tool that is not there. */
	static readonly makeTest = (overrides: Partial<ToolInstallerShape> = {}): ToolInstallerShape => ({
		find: () => Effect.sync(() => unimplemented("find")),
		download: () => Effect.sync(() => unimplemented("download")),
		extractTar: () => Effect.sync(() => unimplemented("extractTar")),
		extractZip: () => Effect.sync(() => unimplemented("extractZip")),
		cacheDir: () => Effect.sync(() => unimplemented("cacheDir")),
		cacheFile: () => Effect.sync(() => unimplemented("cacheFile")),
		...overrides,
	});

	/** {@link ToolInstaller.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<ToolInstallerShape> = {}): Layer.Layer<ToolInstaller> =>
		Layer.succeed(ToolInstaller, ToolInstaller.makeTest(overrides));
}
