// The watch loop behind `--watch`: one recursive watch on the package directory, plus the root config tier when the
// package is not the workspace root; events debounced into batches, filtered against what the build itself writes,
// and handed to one sequential consumer so builds never overlap and changes made during one become one follow-up.

import type { Duration } from "effect";
import { Deferred, Effect, FileSystem, Option, Path, PlatformError, Queue, Stream } from "effect";

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
 * What every watched build ignores: package-relative paths a build writes, matched as a prefix on `/` boundaries.
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
	/** Re-evaluated before each batch is filtered; package-relative prefixes. */
	readonly exclude: Effect.Effect<ReadonlyArray<string>, never, R>;
	/** How long the watched tree must be quiet before a batch is cut; omitted, 100 milliseconds. */
	readonly debounce?: Duration.Input;
	/** One build; its errors end the watch. */
	readonly build: (trigger: WatchTrigger) => Effect.Effect<void, E, R>;
}

const CONFIG_NAME = "effected.toml";

/** Whether `path` is `prefix` or lies under it, on `/` boundaries. */
const isUnder = (path: string, prefix: string): boolean => {
	const trimmed = prefix.replace(/^\.\//, "").replace(/\/+$/, "");
	return trimmed !== "" && (path === trimmed || path.startsWith(`${trimmed}/`));
};

/**
 * Rebuild on change.
 *
 * @public
 */
export class BuildWatch {
	/**
	 * Builds once with `Initial` after every watcher is installed, then once per settled batch of changes, for as long
	 * as it runs. Fails with a watcher's `PlatformError`, or when a watcher stops; `build`'s errors propagate.
	 */
	static readonly run = <E, R>(
		options: BuildWatchOptions<E, R>,
	): Effect.Effect<never, E | PlatformError.PlatformError, R | FileSystem.FileSystem | Path.Path> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const cwd = path.resolve(options.cwd);
			const root = path.resolve(options.root);
			const debounce = options.debounce ?? "100 millis";
			const toRelative = (absolute: string) => path.relative(cwd, absolute).split(path.sep).join("/");

			// Each target maps an event's absolute path to the batch entry it contributes, or to nothing.
			const targets: Array<{
				readonly dir: string;
				readonly recursive: boolean;
				readonly accept: (absolute: string) => string | undefined;
			}> = [
				{
					dir: cwd,
					recursive: true,
					accept: (absolute) => {
						const relative = toRelative(absolute);
						return relative === "" || relative === ".." || relative.startsWith("../") ? undefined : relative;
					},
				},
			];
			if (root !== cwd) {
				for (const dir of [root, path.join(root, ".config")]) {
					if (!(yield* fs.exists(dir))) continue;
					targets.push({
						dir,
						recursive: false,
						accept: (absolute) =>
							path.dirname(absolute) === dir && path.basename(absolute) === CONFIG_NAME
								? toRelative(absolute)
								: undefined,
					});
				}
			}

			const pending = yield* Queue.unbounded<string>();
			const ready = targets.map(() => Deferred.makeUnsafe<void>());
			const watching = Stream.mergeAll(
				targets.map((target, index) =>
					fs
						.watch(target.dir, {
							recursive: target.recursive,
							onReady: () => {
								Deferred.doneUnsafe(ready[index] as Deferred.Deferred<void>, Effect.void);
							},
						})
						// A node watcher reports paths relative to the watched directory; memfs reports them absolute.
						.pipe(Stream.map((event) => target.accept(path.resolve(target.dir, event.path)))),
				),
				{ concurrency: "unbounded" },
			).pipe(
				Stream.runForEach((entry) => (entry === undefined ? Effect.void : Queue.offer(pending, entry))),
				Effect.andThen(
					Effect.fail(
						PlatformError.systemError({
							_tag: "Unknown",
							module: "FileSystem",
							method: "watch",
							pathOrDescriptor: cwd,
							description: "The watcher stopped.",
						}),
					),
				),
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
				yield* Effect.forEach(ready, Deferred.await, { discard: true });
				yield* options.build({ _tag: "Initial" });
				while (true) {
					const paths = yield* nextBatch;
					if (paths.length > 0) yield* options.build({ _tag: "Changed", paths });
				}
			});

			return yield* Effect.raceFirst(watching, consuming);
		});
}
