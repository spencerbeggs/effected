import type { CommandOutput } from "@effected/commands";
import { Run } from "@effected/commands";
import { Duration, Effect, FileSystem, Option, Path, Redacted, Result, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ChildProcess } from "effect/unstable/process";
import {
	closureOf,
	consumerFiles,
	installArgs,
	scrubEnv,
	unresolvedSpecifiers,
	versionOf,
} from "./internal/packedInstallPlan.js";
import { PackageManagerName } from "./PackageManagerName.js";
import { WorkspaceDiscovery } from "./WorkspaceDiscovery.js";
import type { WorkspacePackage } from "./WorkspacePackage.js";

/**
 * Where each closure package is packed from.
 *
 * @remarks
 * `{ directory }` runs `npm pack` in that subdirectory of each package, whose
 * manifest must already be publish-ready. The default,
 * `{ directory: "dist/prod/npm/pkg" }`, is the effected bundler's prod npm
 * output: the same file list a release publishes.
 *
 * `"source"` runs `pnpm pack` in the package directory: pnpm honours
 * `publishConfig.directory` and rewrites `workspace:` and `catalog:`
 * specifiers. Two costs. Under the effected bundler `publishConfig.directory`
 * names the DEV build, so source mode proves the dev artifact, not the
 * published one. And pnpm can rewrite a `workspace:` specifier only in a
 * workspace that has been `pnpm install`ed: in a never-installed one the pack
 * fails with `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`, which
 * `PackedInstall.run` reports as a `PackFailed` error naming the missing
 * install.
 *
 * @public
 */
export type PackSource = "source" | { readonly directory: string };

/**
 * Options for {@link PackedInstall.run}.
 *
 * @public
 */
export interface PackedInstallOptions {
	/** The carrier: a direct dependency of each scratch consumer, beside only `consumerDependencies`. */
	readonly carrier: string;
	/** The other workspace packages to pack and override; `"auto"` is the carrier's transitive runtime workspace dependencies. */
	readonly closure: ReadonlyArray<string> | "auto";
	/**
	 * The package managers to install with; each is used only if it answers
	 * `--version`. A manager listed twice is installed once; an empty list
	 * fails `NoManagerAvailable`.
	 */
	readonly managers: ReadonlyArray<PackageManagerName>;
	/** `"all"` fails if any listed manager is unavailable; `"any"` (the default) needs one. */
	readonly require?: "all" | "any" | undefined;
	/**
	 * Where to pack from. Defaults to `{ directory: "dist/prod/npm/pkg" }`, the
	 * published artifact; see {@link PackSource} for what `"source"` costs.
	 */
	readonly packFrom?: PackSource | undefined;
	/** Bin names every consumer must expose, executable, in `node_modules/.bin`. */
	readonly bins: ReadonlyArray<string>;
	/** The environment for every spawn: pass `process.env` from the test file. The parent manager's context is stripped. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/**
	 * Extra consumer dependencies, name to range or `file:` tarball spec.
	 *
	 * @remarks
	 * Declare here every package the consumer's own code imports directly
	 * other than the carrier. pnpm's isolated layout links only the consumer's
	 * declared dependencies at its top level, so a closure package reached only
	 * through the carrier's peers or the overrides resolves inside the carrier
	 * but fails `ERR_MODULE_NOT_FOUND` when imported from the consumer root,
	 * while npm and bun hoist it and pass. That is a property of the consumer,
	 * not of the pack.
	 *
	 * An entry naming a packed package (the carrier or a closure member) is
	 * written as that package's `file:` tarball, whatever spec you pass, so
	 * any range will do: the packed tarball always wins. npm fails an install
	 * whose direct spec differs from its override (`EOVERRIDE`), so a range
	 * written through unchanged would break every npm consumer.
	 */
	readonly consumerDependencies?: Readonly<Record<string, string>> | undefined;
	/** Ceiling on each install. Defaults to four minutes. Expiry fails `InstallFailed` with a message naming the manager and this duration. */
	readonly installTimeout?: Duration.Input | undefined;
}

/**
 * Why a packed install could not be proven.
 *
 * @public
 */
export class PackedInstallError extends Schema.TaggedError<PackedInstallError>()("PackedInstallError", {
	/** What failed. */
	reason: Schema.Literals([
		"UnsupportedPlatform",
		"NoManagerAvailable",
		"ManagerUnavailable",
		"UnknownPackage",
		"PackSourceMissing",
		"PackFailed",
		"UnresolvedProtocol",
		"InstallFailed",
		"MissingBin",
		"BinFailed",
		"Discovery",
		"Io",
	]),
	/** One line, naming the package or manager involved. */
	message: Schema.String,
	/** The package manager involved. */
	manager: Schema.optionalKey(PackageManagerName),
	/** The workspace package involved. */
	package: Schema.optionalKey(Schema.String),
	/** The tail of the failing command's output. */
	output: Schema.optionalKey(Schema.String),
	/** The originating failure. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * Options for {@link InstalledConsumer.runBin}.
 *
 * @public
 */
export interface RunBinOptions {
	/**
	 * Variables layered over the environment the install ran under, such as an
	 * `XDG_DATA_HOME` inside `PackedInstallResult.scratch`. A key set to
	 * `undefined` removes that variable. The parent manager's context is
	 * stripped from the result, as it is for the install.
	 */
	readonly env?: Readonly<Record<string, string | undefined>> | undefined;
	/** The working directory. Defaults to the consumer's `directory`. */
	readonly cwd?: string | undefined;
	/** Ceiling on the run. Defaults to one minute. Expiry fails `BinFailed` with a message naming the bin and this duration. */
	readonly timeout?: Duration.Input | undefined;
}

const DEFAULT_BIN_TIMEOUT: Duration.Input = "1 minute";

/**
 * One scratch project, outside the workspace, with the carrier installed.
 *
 * @public
 */
export class InstalledConsumer extends Schema.Class<InstalledConsumer>("InstalledConsumer")({
	/** The package manager that installed it. */
	manager: PackageManagerName,
	/** The version it reported and was pinned to. */
	managerVersion: Schema.String,
	/** The consumer project directory (realpath'd). */
	directory: Schema.String,
	/**
	 * The scrubbed environment the install ran under, which {@link InstalledConsumer.runBin}
	 * starts from. Redacted, so printing a consumer never prints a token.
	 * `PackedInstall.run` always sets it; a hand-made consumer without it runs
	 * its bins under only `RunBinOptions.env`.
	 */
	env: Schema.optionalKey(Schema.Redacted(Schema.Record(Schema.String, Schema.String))),
}) {
	/** The installed bin `name`, in `node_modules/.bin`. POSIX: `PackedInstall` runs only there. */
	binPath(name: string): string {
		return `${this.directory}/node_modules/.bin/${name}`;
	}

	/**
	 * Run the installed bin `name` to completion and collect what it wrote.
	 *
	 * @remarks
	 * Spawns {@link InstalledConsumer.binPath} from the consumer's directory,
	 * stdin ignored, under the install's scrubbed environment with
	 * `options.env` layered over it, and nothing inherited beyond that. A
	 * non-zero exit is a result, read from `exitCode`, never a failure. A bin
	 * that cannot spawn, outlives `options.timeout` or floods its output fails
	 * `BinFailed` naming the manager and the bin. Run it inside the scope that
	 * ran `PackedInstall.run`: the scratch directory is removed when that
	 * scope closes.
	 *
	 * @param name - The bin, as named in `node_modules/.bin`.
	 * @param args - Its arguments.
	 * @param options - Extra environment, working directory and ceiling.
	 */
	runBin(
		name: string,
		args: ReadonlyArray<string> = [],
		options: RunBinOptions = {},
	): Effect.Effect<CommandOutput, PackedInstallError, ChildProcessSpawner.ChildProcessSpawner> {
		const env = scrubEnv({ ...(this.env === undefined ? {} : Redacted.value(this.env)), ...options.env });
		const timeout = options.timeout ?? DEFAULT_BIN_TIMEOUT;
		const manager = this.manager;
		return Run.collect(
			ChildProcess.make(this.binPath(name), args, {
				cwd: options.cwd ?? this.directory,
				env,
				extendEnv: false,
				stdin: "ignore",
			}),
			{ timeout },
		).pipe(
			Effect.mapError((cause) =>
				failure(
					"BinFailed",
					cause._tag === "CommandFailedError" && cause.kind === "timeout"
						? `${manager}: ${name} timed out after ${describeDuration(timeout)}`
						: `${manager}: ${name} could not run`,
					{ manager, cause },
				),
			),
		);
	}
}

/**
 * What a packed install produced.
 *
 * @public
 */
export class PackedInstallResult extends Schema.Class<PackedInstallResult>("PackedInstallResult")({
	/** One consumer per available manager, in the order requested. */
	consumers: Schema.Array(InstalledConsumer),
	/** The requested managers that did not answer `--version`. */
	unavailable: Schema.Array(PackageManagerName),
	/** Every packed package: name to absolute tarball path. */
	tarballs: Schema.Record(Schema.String, Schema.String),
	/**
	 * The scratch root (realpath'd) holding the tarballs and every consumer.
	 * It is removed when the scope that ran `PackedInstall.run` closes, so a
	 * directory made under it, such as an `XDG_DATA_HOME` for the bins, is
	 * cleaned up with it.
	 */
	scratch: Schema.String,
}) {}

/**
 * What {@link PackedInstall.timeoutBudget} adds up.
 *
 * @public
 */
export interface PackedInstallBudget {
	/** The managers the run requests; one listed twice counts once. */
	readonly managers: ReadonlyArray<PackageManagerName>;
	/** The run's `installTimeout`. Defaults to four minutes, as the run does. */
	readonly installTimeout?: Duration.Input | undefined;
	/**
	 * How many packages the run packs: the carrier plus its closure. For
	 * `closure: "auto"`, count them once; `PackedInstallResult.tarballs` has one
	 * entry per packed package.
	 */
	readonly packages: number;
	/** What the test does with each consumer afterwards, such as its bin runs' ceilings. Defaults to zero. */
	readonly perConsumer?: Duration.Input | undefined;
}

// Probe P3: npm-packing the prod output is byte-identical to the published
// tarball; pnpm-packing the source packs the dev build.
const DEFAULT_PACK_FROM: PackSource = { directory: "dist/prod/npm/pkg" };
const WORKSPACE_PROTOCOL_NOT_INSTALLED = "ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL";
const TAIL = 2000;
const tail = (text: string): string => (text.length <= TAIL ? text : text.slice(-TAIL));
const DEFAULT_INSTALL_TIMEOUT: Duration.Input = "4 minutes";
const PROBE_TIMEOUT: Duration.Input = "30 seconds";
const PACK_TIMEOUT: Duration.Input = "2 minutes";
const MANIFEST_TIMEOUT: Duration.Input = "30 seconds";
/** The untimed steps a budget allows for: discovery, the consumer files and the bin checks. */
const UNTIMED_SLACK: Duration.Input = "30 seconds";
/** A ceiling as a person reads it: `"4m"` for `"4 minutes"`, the raw input if it does not decode. */
const describeDuration = (input: Duration.Input): string =>
	Option.match(Duration.fromInput(input), { onNone: () => String(input), onSome: Duration.format });

const failure = (
	reason: PackedInstallError["reason"],
	message: string,
	extra: { manager?: PackageManagerName; package?: string; output?: string; cause?: unknown } = {},
): PackedInstallError => new PackedInstallError({ reason, message, ...extra });

/**
 * Prove a carrier's bins reach a consumer that is not part of the workspace,
 * once per available package manager.
 *
 * @remarks
 * Packs the carrier and its closure into a scoped, realpath'd scratch
 * directory (so `file:` specs and the install cwd agree on macOS). Then, for
 * each manager that answers `--version` from that directory (so a corepack
 * pin in the repo cannot refuse it), it writes a consumer whose only direct
 * dependency is the carrier tarball, steers the closure to its tarballs
 * through the manager's own override field, pins the probed version (as
 * `packageManager`, or for pnpm as `devEngines.packageManager` with
 * `onFail: "ignore"`, since pnpm resolves a `packageManager` pin from the registry even
 * when it names the running version), installs with lifecycle scripts skipped,
 * and checks every
 * expected bin is present and executable. A packed manifest that still
 * carries `workspace:`, `catalog:`, `link:` or a relative `file:` specifier
 * fails `UnresolvedProtocol` before any install.
 *
 * It asserts nothing about what the bins DO: run them from the test through
 * `InstalledConsumer.runBin`, or for an MCP bin through `McpProbe` from
 * `@effected/mcp/testing` at `InstalledConsumer.binPath`, inside the same
 * scope, because the scratch directory (`PackedInstallResult.scratch`) is
 * removed when the scope closes. Size the test's outer timeout with
 * {@link PackedInstall.timeoutBudget}. POSIX only.
 *
 * @example
 * ```ts
 * import { NodeServices } from "@effect/platform-node";
 * import { Workspaces } from "@effected/workspaces";
 * import { PackedInstall } from "@effected/workspaces/testing";
 * import { Effect, Layer } from "effect";
 *
 * const Live = Workspaces.layer({ cwd: "/repo" }).pipe(Layer.provideMerge(NodeServices.layer));
 *
 * // Use the consumers INSIDE the scope: closing it removes the scratch
 * // directory, so a binPath returned out of Effect.scoped points at nothing.
 * const program = Effect.gen(function* () {
 *   const result = yield* PackedInstall.run({
 *     carrier: "my-tool",
 *     closure: "auto",
 *     managers: ["npm", "pnpm"],
 *     bins: ["my-tool"],
 *     env: process.env,
 *   });
 *   // Keep the tool's data inside the scratch root, removed with it.
 *   const env = { XDG_DATA_HOME: `${result.scratch}/xdg` };
 *   for (const consumer of result.consumers) {
 *     const { stdout, exitCode } = yield* consumer.runBin("my-tool", ["--version"], { env });
 *     console.log(consumer.manager, exitCode, stdout.trim());
 *   }
 * }).pipe(Effect.scoped, Effect.provide(Live));
 * ```
 *
 * @public
 */
export class PackedInstall {
	private constructor() {}

	/** `env` without undefined values or the parent manager's context: the environment the installs run under. Reuse it to run the installed bins. */
	static readonly scrubEnv: (env: Readonly<Record<string, string | undefined>>) => Record<string, string> = scrubEnv;

	/**
	 * The ceiling a test's outer timeout should cover so that every one of the
	 * run's own ceilings fires first, as a named `PackedInstallError`, rather
	 * than the outer guard's `TimeoutError` that names nothing.
	 *
	 * @remarks
	 * The worst case of the run's own ceilings, taken in sequence as the run
	 * takes them: each manager's `--version` probe (30 seconds), install
	 * (`installTimeout`) and `perConsumer`, plus each package's pack (two
	 * minutes) and manifest read (30 seconds), plus 30 seconds for the untimed
	 * steps. A vitest test timeout must sit above it, since vitest's own guard
	 * should not pre-empt the Effect's.
	 *
	 * @example
	 * ```ts
	 * import { PackedInstall } from "@effected/workspaces/testing";
	 * import { Duration } from "effect";
	 *
	 * const budget = PackedInstall.timeoutBudget({
	 *   managers: ["npm", "pnpm", "yarn", "bun"],
	 *   installTimeout: "3 minutes",
	 *   packages: 3,
	 *   perConsumer: "2 minutes",
	 * });
	 * console.log(Duration.format(budget));
	 * // => 30m
	 * ```
	 */
	static readonly timeoutBudget = (budget: PackedInstallBudget): Duration.Duration => {
		const perManager = [PROBE_TIMEOUT, budget.installTimeout ?? DEFAULT_INSTALL_TIMEOUT, budget.perConsumer ?? 0]
			.map(Duration.fromInputUnsafe)
			.reduce((total, step) => Duration.sum(total, step), Duration.zero);
		const perPackage = Duration.sum(Duration.fromInputUnsafe(PACK_TIMEOUT), Duration.fromInputUnsafe(MANIFEST_TIMEOUT));
		return Duration.sum(
			Duration.sum(
				Duration.times(perManager, new Set(budget.managers).size),
				Duration.times(perPackage, Math.max(1, budget.packages)),
			),
			Duration.fromInputUnsafe(UNTIMED_SLACK),
		);
	};

	/** Pack, then install under every available manager. */
	static readonly run = Effect.fn("PackedInstall.run")(function* (options: PackedInstallOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (path.sep !== "/") {
			return yield* failure(
				"UnsupportedPlatform",
				"PackedInstall drives POSIX .bin shims and tar; run it on macOS or Linux",
			);
		}
		// One consumer directory per manager: a manager listed twice is installed once.
		const managers = [...new Set(options.managers)];
		if (managers.length === 0) {
			return yield* failure(
				"NoManagerAvailable",
				"managers is empty: name at least one package manager to install with",
			);
		}
		const env = scrubEnv(options.env);
		const io = (message: string) => (cause: unknown) => failure("Io", message, { cause });
		const command = (executable: string, args: ReadonlyArray<string>, cwd: string) =>
			ChildProcess.make(executable, args, { cwd, env, extendEnv: false, stdin: "ignore" });

		const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "effected-packed-install-" }).pipe(
			Effect.flatMap((directory) => fs.realPath(directory)),
			Effect.mapError(io("could not create the scratch directory")),
		);

		const probes = yield* Effect.forEach(managers, (manager) =>
			Run.collect(command(manager, ["--version"], scratch), { timeout: PROBE_TIMEOUT }).pipe(
				Effect.map((output) => (output.succeeded ? versionOf(output.stdout) : undefined)),
				Effect.catch(() => Effect.succeed(undefined)),
				Effect.map((version) => ({ manager, version })),
			),
		);
		const available = probes.flatMap(({ manager, version }) => (version === undefined ? [] : [{ manager, version }]));
		const unavailable = probes.flatMap(({ manager, version }) => (version === undefined ? [manager] : []));
		if (available.length === 0) {
			return yield* failure("NoManagerAvailable", `none of ${managers.join(", ")} answered --version from ${scratch}`);
		}
		const missing = unavailable[0];
		if (options.require === "all" && missing !== undefined) {
			return yield* failure("ManagerUnavailable", `${missing} is required but did not answer --version`, {
				manager: missing,
			});
		}

		const discovery = yield* WorkspaceDiscovery;
		const packages = yield* discovery
			.listPackages()
			.pipe(Effect.mapError((cause) => failure("Discovery", "workspace discovery failed", { cause })));
		const closure = closureOf(packages, options.carrier, options.closure);
		if (Result.isFailure(closure)) {
			return yield* failure("UnknownPackage", `${closure.failure} is not a package of this workspace`, {
				package: closure.failure,
			});
		}

		const source = options.packFrom ?? DEFAULT_PACK_FROM;
		const pack = (pkg: WorkspacePackage, destination: string) =>
			Effect.gen(function* () {
				yield* fs
					.makeDirectory(destination, { recursive: true })
					.pipe(Effect.mapError(io(`could not create ${destination}`)));
				const cwd = source === "source" ? pkg.path : path.join(pkg.path, source.directory);
				if (source !== "source") {
					const built = yield* fs
						.exists(path.join(cwd, "package.json"))
						.pipe(Effect.mapError(io(`could not inspect ${cwd}`)));
					if (!built) {
						return yield* failure(
							"PackSourceMissing",
							`${cwd} has no package.json; build ${pkg.name} before packing it`,
							{
								package: pkg.name,
							},
						);
					}
				}
				const packer = source === "source" ? "pnpm" : "npm";
				const args =
					source === "source"
						? ["pack", "--pack-destination", destination, "--config.ignore-scripts=true"]
						: ["pack", "--ignore-scripts", "--pack-destination", destination];
				const output = yield* Run.collect(command(packer, args, cwd), { timeout: PACK_TIMEOUT }).pipe(
					Effect.mapError((cause) =>
						failure("PackFailed", `${packer} pack could not run for ${pkg.name}`, { package: pkg.name, cause }),
					),
				);
				if (!output.succeeded) {
					const notInstalled =
						source === "source" && `${output.stdout}${output.stderr}`.includes(WORKSPACE_PROTOCOL_NOT_INSTALLED);
					return yield* failure(
						"PackFailed",
						notInstalled
							? `pnpm pack could not rewrite the workspace: specifiers of ${pkg.name} because the workspace is not installed; run pnpm install in the workspace first`
							: `${packer} pack exited ${output.exitCode} for ${pkg.name}`,
						// Both streams: a pnpm WARN banner on stderr must not hide the real error on stdout.
						{ package: pkg.name, output: tail(`${output.stdout}\n${output.stderr}`) },
					);
				}
				const found = (yield* fs
					.readDirectory(destination)
					.pipe(Effect.mapError(io(`could not list ${destination}`)))).filter((name) => name.endsWith(".tgz"));
				const [only] = found;
				if (only === undefined || found.length !== 1) {
					return yield* failure(
						"PackFailed",
						`expected exactly one tarball for ${pkg.name} in ${destination}, found ${found.length}`,
						{
							package: pkg.name,
						},
					);
				}
				const tarball = path.join(destination, only);
				const manifest = yield* Run.text(command("tar", ["-xzOf", tarball, "package/package.json"], destination), {
					timeout: MANIFEST_TIMEOUT,
				}).pipe(
					Effect.mapError((cause) =>
						failure("PackFailed", `could not read package/package.json out of ${tarball}`, {
							package: pkg.name,
							cause,
						}),
					),
				);
				const unresolved = unresolvedSpecifiers(manifest);
				if (Result.isFailure(unresolved)) {
					return yield* failure("PackFailed", `the packed package.json of ${pkg.name} is not a JSON object`, {
						package: pkg.name,
						cause: unresolved.failure,
					});
				}
				if (unresolved.success.length > 0) {
					return yield* failure(
						"UnresolvedProtocol",
						`${pkg.name}'s packed manifest still carries ${unresolved.success.join(", ")}, which no consumer outside the workspace can resolve; pack from "source" so pnpm rewrites workspace: and catalog:, or fix the build`,
						{ package: pkg.name },
					);
				}
				return tarball;
			});

		const packed: Array<{ readonly name: string; readonly tarball: string }> = [];
		for (const [index, pkg] of closure.success.entries()) {
			packed.push({ name: pkg.name, tarball: yield* pack(pkg, path.join(scratch, "tarballs", String(index))) });
		}
		const [carrier, ...rest] = packed;
		if (carrier === undefined)
			return yield* failure("UnknownPackage", `${options.carrier} was not packed`, { package: options.carrier });
		const overrides = Object.fromEntries(rest.map(({ name, tarball }) => [name, tarball]));

		const consumers = yield* Effect.forEach(available, ({ manager, version }) =>
			Effect.gen(function* () {
				const directory = path.join(scratch, `consumer-${manager}`);
				yield* fs
					.makeDirectory(directory, { recursive: true })
					.pipe(Effect.mapError(io(`could not create ${directory}`)));
				for (const { file, content } of consumerFiles({
					manager,
					version,
					carrier,
					overrides,
					dependencies: options.consumerDependencies ?? {},
				})) {
					yield* fs
						.writeFileString(path.join(directory, file), content)
						.pipe(Effect.mapError(io(`could not write ${file}`)));
				}
				const installTimeout = options.installTimeout ?? DEFAULT_INSTALL_TIMEOUT;
				const output = yield* Run.collect(command(manager, installArgs(manager, version), directory), {
					timeout: installTimeout,
				}).pipe(
					Effect.mapError((cause) =>
						failure(
							"InstallFailed",
							// A ceiling that fired is not a spawn that failed: say which, so a slow registry is not read as a missing binary.
							cause._tag === "CommandFailedError" && cause.kind === "timeout"
								? `${manager} install timed out after ${describeDuration(installTimeout)}`
								: `${manager} install could not run`,
							{ manager, cause },
						),
					),
				);
				if (!output.succeeded) {
					return yield* failure("InstallFailed", `${manager} install exited ${output.exitCode}`, {
						manager,
						output: tail(`${output.stdout}\n${output.stderr}`),
					});
				}
				const consumer = InstalledConsumer.make({
					manager,
					managerVersion: version,
					directory,
					env: Redacted.make(env),
				});
				for (const bin of options.bins) {
					const info = yield* Effect.option(fs.stat(consumer.binPath(bin)));
					if (Option.isNone(info) || (info.value.mode & 0o111) === 0) {
						// What .bin DOES hold separates a wrong bin name from a link that never happened.
						const listing = yield* fs.readDirectory(path.join(directory, "node_modules", ".bin")).pipe(
							Effect.map((names) =>
								names.length === 0
									? "node_modules/.bin is empty"
									: `node_modules/.bin holds: ${[...names].sort().join(", ")}`,
							),
							Effect.catch(() => Effect.succeed("node_modules/.bin does not exist or cannot be listed")),
						);
						return yield* failure(
							"MissingBin",
							`${manager} installed ${options.carrier} but node_modules/.bin/${bin} is missing or not executable; ${listing}`,
							{ manager, package: options.carrier, output: listing },
						);
					}
				}
				return consumer;
			}),
		);

		return PackedInstallResult.make({
			consumers,
			unavailable,
			tarballs: Object.fromEntries(packed.map(({ name, tarball }) => [name, tarball])),
			scratch,
		});
	});
}
