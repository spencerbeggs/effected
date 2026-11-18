// The watch loop behind `--watch`: the package directory's top level, one recursive watch per top-level directory no
// exclusion covers, and the root config tier when the package is not the workspace root; events debounced into batches,
// filtered against what the build itself writes, and handed to one sequential consumer so builds never overlap and
// changes made during one become one follow-up.

import type { EffectedConfigError } from "@effected/bundler";
import { EffectedConfigFile } from "@effected/bundler";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import type { Duration } from "effect";
import {
	Deferred,
	Effect,
	FiberMap,
	FileSystem,
	Layer,
	Option,
	Path,
	PlatformError,
	Queue,
	Semaphore,
	Stream,
} from "effect";
import { NotAnActionError } from "./ActionRun.js";
import type { NotAPackageError } from "./BuildRun.js";
import { readPackageName, workspaceRootOf } from "./BuildRun.js";

/**
 * Why a watched build runs: the first build, or a settled batch of changes.
 *
 * @public
 */
export type WatchTrigger =
	| { readonly _tag: "Initial" }
	| {
			readonly _tag: "Changed";
			/**
			 * The changed paths, de-duplicated and sorted, relative to the package directory with `/` separators; a
			 * root-tier `effected.toml` reads as `../…`.
			 */
			readonly paths: ReadonlyArray<string>;
	  };

/**
 * What every watched build ignores: package-relative paths a build writes, matched on `/` boundaries.
 *
 * @remarks
 * An entry covers the path itself, everything under it, and the directories it lives in, so a build creating
 * `.github/actions/local` triggers nothing with its `.github` and `.github/actions` directory events. A path that only
 * shares a prefix (`distribution`), or a file beside an entry (`.github/workflows/ci.yml`), still triggers.
 *
 * @public
 */
export const DEFAULT_EXCLUDES: ReadonlyArray<string> = [
	"dist",
	"node_modules",
	".turbo",
	".git",
	".cache",
	"tsdoc.json",
	".actrc",
	".github/workflows/act-test.yml",
	".github/actions/local",
];

/**
 * What {@link BuildWatch.run} watches and what it runs.
 *
 * @public
 */
export interface BuildWatchOptions<E, R> {
	/** The package directory, absolute. */
	readonly cwd: string;
	/** The workspace root, absolute. */
	readonly root: string;
	/**
	 * Package-relative paths to ignore, re-evaluated before each batch is filtered. Each covers itself, what lies under
	 * it, and the directories it lives in, as {@link DEFAULT_EXCLUDES} does.
	 */
	readonly exclude: Effect.Effect<ReadonlyArray<string>, never, R>;
	/** How long the watched tree must be quiet before a batch is cut; omitted, 100 milliseconds. */
	readonly debounce?: Duration.Input;
	/** One build; its errors end the watch. */
	readonly build: (trigger: WatchTrigger) => Effect.Effect<void, E, R>;
}

/**
 * The directories a watch covers, resolved once at startup.
 *
 * @public
 */
export interface WatchTarget {
	/** The package directory, absolute. */
	readonly cwd: string;
	/** The workspace root, absolute; `cwd` itself when there is no workspace above it. */
	readonly root: string;
}

const CONFIG_NAME = "effected.toml";

/** Discovery from `cwd`, as `BuildRun` and `ActionRun` provide it to the root search and the config load. */
const discoveryFrom = (cwd: string) => WorkspaceDiscovery.layer({ cwd }).pipe(Layer.provide(WorkspaceRoot.layer));

/**
 * Whether an exclusion covers `path`, on `/` boundaries: `path` is the excluded path, lies under it, or is a directory
 * it lives in. A build creating `.github/actions/local` also creates `.github` and `.github/actions`, and those
 * directory events are the build's own; a file under them that no exclusion names still triggers.
 */
const isUnder = (path: string, prefix: string): boolean => {
	const trimmed = trimExclusion(prefix);
	return isCovered(path, prefix) || (trimmed !== "" && trimmed.startsWith(`${path}/`));
};

const trimExclusion = (prefix: string): string => prefix.replace(/^\.\//, "").replace(/\/+$/, "");

/** Whether `path` is an excluded path or lies under it, on `/` boundaries: a top-level directory never watched. */
const isCovered = (path: string, prefix: string): boolean => {
	const trimmed = trimExclusion(prefix);
	return trimmed !== "" && (path === trimmed || path.startsWith(`${trimmed}/`));
};

/**
 * Rebuild on change.
 *
 * @public
 */
export class BuildWatch {
	/**
	 * Resolves what a watch covers, refusing a directory that cannot be built at all: no `package.json`, a workspace
	 * root that cannot be discovered, or, for an action, a config that loads with no `[action]` table. A config that
	 * will not load is not refused, because it is an edit the watch must survive.
	 */
	static readonly target = (
		cwd: string,
		kind: "package" | "action",
	): Effect.Effect<
		WatchTarget,
		NotAPackageError | NotAnActionError | EffectedConfigError | PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const resolved = path.resolve(cwd);
			yield* readPackageName(resolved);
			const discovery = discoveryFrom(resolved);
			const root = yield* workspaceRootOf(resolved).pipe(Effect.provide(discovery));
			if (kind === "action") {
				const loaded = yield* EffectedConfigFile.load({ cwd: resolved, root }).pipe(
					Effect.provide(discovery),
					Effect.option,
				);
				if (Option.isSome(loaded) && loaded.value.config.action === undefined) {
					return yield* new NotAnActionError({ cwd: resolved });
				}
			}
			return { cwd: resolved, root };
		});

	/**
	 * An action's exclusions: {@link DEFAULT_EXCLUDES} plus its enabled `persistLocal.path`, package-relative, read
	 * from the config as it is now. Any config that will not load, or has no `[action]` table, gives the defaults.
	 */
	static readonly actionExcludes = (
		target: WatchTarget,
	): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const loaded = yield* EffectedConfigFile.load({ cwd: target.cwd, root: target.root }).pipe(
				Effect.provide(discoveryFrom(target.cwd)),
				Effect.option,
			);
			const persist = Option.isSome(loaded) ? loaded.value.config.action?.persistLocal : undefined;
			if (persist === undefined || !persist.enabled) return DEFAULT_EXCLUDES;
			const relative = path.relative(target.cwd, path.resolve(target.cwd, persist.path)).split(path.sep).join("/");
			// Outside the package no watched event can match it, and at the package itself it would exclude everything.
			const inside = relative !== "" && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative);
			return inside && !DEFAULT_EXCLUDES.includes(relative) ? [...DEFAULT_EXCLUDES, relative] : DEFAULT_EXCLUDES;
		});

	/**
	 * Builds once with `Initial` after every watcher is installed, then once per settled batch of changes, for as long
	 * as it runs. Fails with a watcher's `PlatformError`, or when a watcher stops; `build`'s errors propagate.
	 *
	 * @remarks
	 * The package directory is watched non-recursively, and each of its top-level directories that no exclusion covers
	 * gets a recursive watch of its own, so an excluded `node_modules`, `.git` or `dist` is never walked. A directory
	 * that is only where an exclusion lives, such as `.github`, is watched, and its events are filtered. The set follows
	 * the package: a new top-level directory is watched from its first event, a removed one's watch is dropped, and the
	 * exclusions are re-read after each batch. Only the package directory's own watch and the root tier's watches
	 * stopping fail the run; a top-level directory's watch ending is that directory going away.
	 */
	static readonly run = <E, R>(
		options: BuildWatchOptions<E, R>,
	): Effect.Effect<never, E | PlatformError.PlatformError, R | FileSystem.FileSystem | Path.Path> =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const cwd = path.resolve(options.cwd);
				const root = path.resolve(options.root);
				const debounce = options.debounce ?? "100 millis";
				const toRelative = (absolute: string) => path.relative(cwd, absolute).split(path.sep).join("/");
				// A node watcher reports paths relative to the watched directory; memfs reports them absolute.
				const absoluteIn = (dir: string, eventPath: string) => path.resolve(dir, eventPath);
				const inPackage = (absolute: string) => {
					const relative = toRelative(absolute);
					return relative === "" || relative === ".." || relative.startsWith("../") ? undefined : relative;
				};

				// The watches whose ending means the watcher stopped: the package directory's own top level, and the root
				// tier. Each maps an event's absolute path to the batch entry it contributes, or to nothing.
				const fixed: Array<{
					readonly dir: string;
					readonly accept: (absolute: string) => string | undefined;
					/** Whether an event here can be a top-level directory appearing or vanishing. */
					readonly topLevel: boolean;
				}> = [{ dir: cwd, accept: inPackage, topLevel: true }];
				if (root !== cwd) {
					for (const dir of [root, path.join(root, ".config")]) {
						if (!(yield* fs.exists(dir))) continue;
						fixed.push({
							dir,
							topLevel: false,
							accept: (absolute) =>
								path.dirname(absolute) === dir && path.basename(absolute) === CONFIG_NAME
									? toRelative(absolute)
									: undefined,
						});
					}
				}

				const pending = yield* Queue.unbounded<string>();
				const offer = (entry: string | undefined) => (entry === undefined ? Effect.void : Queue.offer(pending, entry));

				// One recursive watch per top-level directory no exclusion covers, so a populated `node_modules` or `.git`
				// is never walked. A watch here ending, by an error or not, is its directory going away, which the
				// top-level watch reports as a change; it fails the run only if the directory is still there.
				const directories = yield* FiberMap.make<string, void, PlatformError.PlatformError>();
				const arm = (name: string) => {
					const dir = path.join(cwd, name);
					const ready = Deferred.makeUnsafe<void>();
					const watching = fs
						.watch(dir, {
							recursive: true,
							onReady: () => {
								Deferred.doneUnsafe(ready, Effect.void);
							},
						})
						.pipe(
							Stream.runForEach((event) => offer(inPackage(absoluteIn(dir, event.path)))),
							Effect.catch((error: PlatformError.PlatformError) =>
								Effect.flatMap(fs.exists(dir), (exists) => (exists ? Effect.fail(error) : Effect.void)),
							),
							Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(ready, Effect.void))),
						);
					return Effect.as(FiberMap.run(directories, name, watching, { onlyIfMissing: true }), ready);
				};
				// Brings the armed set in line with the package's top-level directories and the exclusions as they are now.
				// Runs at startup, on every top-level event, and after each batch, one at a time.
				const permit = yield* Semaphore.make(1);
				const reconcile = Semaphore.withPermit(
					permit,
					Effect.gen(function* () {
						const excludes = yield* options.exclude;
						const wanted = new Set<string>();
						for (const name of yield* fs.readDirectory(cwd)) {
							if (excludes.some((prefix) => isCovered(name, prefix))) continue;
							// Gone between the listing and the stat is not a directory to watch.
							const info = yield* Effect.option(fs.stat(path.join(cwd, name)));
							if (Option.isSome(info) && info.value.type === "Directory") wanted.add(name);
						}
						for (const [name] of [...directories]) {
							if (!wanted.has(name)) yield* FiberMap.remove(directories, name);
						}
						const armed: Array<Deferred.Deferred<void>> = [];
						for (const name of wanted) {
							if (!(yield* FiberMap.has(directories, name))) armed.push(yield* arm(name));
						}
						return armed;
					}),
				);

				const fixedReady = fixed.map(() => Deferred.makeUnsafe<void>());
				// A fixed watch stream that ends has lost its watcher (node ends one on `close`). Any one ending fails the
				// run: a stopped package watch beside live root-tier watches would otherwise idle while looking healthy.
				const stopped = (dir: string) =>
					PlatformError.systemError({
						_tag: "Unknown",
						module: "FileSystem",
						method: "watch",
						pathOrDescriptor: dir,
						description: "The watcher stopped.",
					});
				const watching = Stream.mergeAll(
					fixed.map((target, index) =>
						fs
							.watch(target.dir, {
								onReady: () => {
									Deferred.doneUnsafe(fixedReady[index] as Deferred.Deferred<void>, Effect.void);
								},
							})
							.pipe(
								Stream.map((event) => ({ target, entry: target.accept(absoluteIn(target.dir, event.path)) })),
								Stream.concat(Stream.fail(stopped(target.dir))),
							),
					),
					{ concurrency: "unbounded" },
				).pipe(
					Stream.runForEach(({ target, entry }) =>
						target.topLevel && entry !== undefined ? Effect.andThen(reconcile, offer(entry)) : offer(entry),
					),
					// Unreachable: every stream above ends by failing.
					Effect.andThen(Effect.never),
				);

				// Wait for changes, then until none has arrived for `debounce`; changes made during a build wait in `pending`.
				const nextBatch = Effect.gen(function* () {
					const batch = new Set(yield* Queue.takeAll(pending));
					while (true) {
						const more = yield* Effect.timeoutOption(Queue.takeAll(pending), debounce);
						if (Option.isNone(more)) break;
						for (const entry of more.value) batch.add(entry);
					}
					const excludes = yield* options.exclude;
					return [...batch].filter((entry) => !excludes.some((prefix) => isUnder(entry, prefix))).sort();
				});

				const consuming = Effect.gen(function* () {
					const armed = yield* reconcile;
					yield* Effect.forEach([...fixedReady, ...armed], Deferred.await, { discard: true });
					yield* options.build({ _tag: "Initial" });
					while (true) {
						const paths = yield* nextBatch;
						// The exclusions may have changed with the config, so the armed set follows them.
						yield* reconcile;
						if (paths.length > 0) yield* options.build({ _tag: "Changed", paths });
					}
				});

				return yield* Effect.raceAllFirst([
					watching,
					consuming,
					Effect.andThen(FiberMap.join(directories), Effect.never),
				]);
			}),
		);
}
