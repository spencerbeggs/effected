import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemHandle, MemoryFileSystemOptions, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem, Path } from "effect";
import { Deferred, Effect, Fiber, PlatformError, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { NotAnActionError } from "../../src/build/ActionRun.js";
import { NotAPackageError } from "../../src/build/BuildRun.js";
import type { WatchTrigger } from "../../src/build/BuildWatch.js";
import { BuildWatch, DEFAULT_EXCLUDES } from "../../src/build/BuildWatch.js";

const ROOT = "/repo";
const CWD = `${ROOT}/packages/a`;

const SEED: MemoryFileSystemSeed = {
	[`${ROOT}/package.json`]: "{}",
	[`${ROOT}/.config/effected.toml`]: "",
	[`${CWD}/package.json`]: "{}",
	[`${CWD}/src/index.ts`]: "",
};

/** The package directory, `/repo`, `/repo/.config`, and the one top-level directory SEED gives the package: `src`. */
const WATCHERS = 4;

/** Lets every forked fiber run until it blocks. */
const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true });

const waitForWatchers = (handle: MemoryFileSystemHandle, count: number) =>
	Effect.gen(function* () {
		for (let turn = 0; turn < 500 && handle.watcherCount() < count; turn++) yield* Effect.yieldNow;
		assert.strictEqual(handle.watcherCount(), count);
		yield* settle;
	});

const changed = (...paths: ReadonlyArray<string>): WatchTrigger => ({ _tag: "Changed", paths });

interface Harness {
	readonly handle: MemoryFileSystemHandle;
	readonly triggers: Effect.Effect<ReadonlyArray<WatchTrigger>>;
	readonly fiber: Fiber.Fiber<never, PlatformError.PlatformError>;
}

/** Forks `run` over a manual-events volume and waits for its watchers to be installed. */
const start = (options: {
	readonly seed?: MemoryFileSystemSeed;
	readonly cwd?: string;
	readonly watchers?: number;
	readonly exclude?: Effect.Effect<ReadonlyArray<string>>;
	readonly handle?: MemoryFileSystemOptions;
}) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(options.seed ?? SEED, {
			...options.handle,
			watchEvents: "manual",
		});
		const log = yield* Ref.make<ReadonlyArray<WatchTrigger>>([]);
		const fiber = yield* BuildWatch.run({
			cwd: options.cwd ?? CWD,
			root: ROOT,
			exclude: options.exclude ?? Effect.succeed(DEFAULT_EXCLUDES),
			build: (trigger) => Ref.update(log, (all) => [...all, trigger]),
		}).pipe(Effect.provide(handle.layer), Effect.forkChild({ startImmediately: true }));
		yield* waitForWatchers(handle, options.watchers ?? WATCHERS);
		const harness: Harness = { handle, triggers: Ref.get(log), fiber };
		return harness;
	});

/** Emits each event, then lets the debounce elapse. */
const burst = (
	handle: MemoryFileSystemHandle,
	events: ReadonlyArray<readonly [string, "Create" | "Update" | "Remove"]>,
) =>
	Effect.gen(function* () {
		for (const [path, event] of events) handle.emit(path, event);
		yield* settle;
		yield* TestClock.adjust("100 millis");
		yield* settle;
	});

describe("BuildWatch.run", () => {
	it.effect("runs Initial before any event", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(SEED, { watchEvents: "manual" });
			const seen = yield* Ref.make<ReadonlyArray<readonly [WatchTrigger, number]>>([]);
			const fiber = yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build: (trigger) => Ref.update(seen, (all) => [...all, [trigger, handle.watcherCount()] as const]),
			}).pipe(Effect.provide(handle.layer), Effect.forkChild({ startImmediately: true }));
			yield* waitForWatchers(handle, WATCHERS);
			// Every watcher was installed when Initial ran, so no edit made after it can be lost.
			assert.deepStrictEqual(yield* Ref.get(seen), [[{ _tag: "Initial" }, WATCHERS]]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("collapses a burst within the debounce into one batch", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			handle.emit(`${CWD}/src/a.ts`, "Update");
			yield* settle;
			yield* TestClock.adjust("30 millis");
			handle.emit(`${CWD}/src/b.ts`, "Create");
			yield* settle;
			yield* TestClock.adjust("30 millis");
			handle.emit(`${CWD}/src/a.ts`, "Update");
			yield* settle;
			yield* TestClock.adjust("99 millis");
			yield* settle;
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }], "the window is not quiet yet");
			yield* TestClock.adjust("1 millis");
			yield* settle;
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("src/a.ts", "src/b.ts")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("treats a save-by-rename as one path", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			yield* burst(handle, [
				[`${CWD}/src/index.ts`, "Create"],
				[`${CWD}/src/index.ts`, "Remove"],
				[`${CWD}/src/index.ts`, "Update"],
			]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("src/index.ts")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("ignores every default exclusion", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			yield* burst(
				handle,
				DEFAULT_EXCLUDES.flatMap((exclude) => [
					[`${CWD}/${exclude}`, "Update"] as const,
					[`${CWD}/${exclude}/nested/file.js`, "Create"] as const,
				]),
			);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("does not exclude a path that merely shares a prefix", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({
				seed: {
					...SEED,
					[`${CWD}/distribution/x.ts`]: "",
					[`${CWD}/.github/actions/local-notes.md`]: "",
				},
				watchers: WATCHERS + 2,
			});
			yield* burst(handle, [
				[`${CWD}/distribution/x.ts`, "Update"],
				[`${CWD}/.github/actions/local-notes.md`, "Update"],
			]);
			assert.deepStrictEqual(yield* triggers, [
				{ _tag: "Initial" },
				changed(".github/actions/local-notes.md", "distribution/x.ts"),
			]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("ignores the directories an exclusion lives in, not the files beside it", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({
				seed: { ...SEED, [`${CWD}/.github/workflows/ci.yml`]: "" },
				watchers: WATCHERS + 1,
			});
			// What a first action build's persist step creates on its way to `.github/actions/local` and `act-test.yml`.
			yield* burst(handle, [
				[`${CWD}/.github`, "Create"],
				[`${CWD}/.github/actions`, "Create"],
				[`${CWD}/.github/workflows`, "Create"],
			]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }], "the build's own directories trigger nothing");
			yield* burst(handle, [[`${CWD}/.github/workflows/ci.yml`, "Update"]]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed(".github/workflows/ci.yml")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("watches the package top level, and recursively only its directories that no exclusion covers", () =>
		Effect.gen(function* () {
			const watched: Array<readonly [string, boolean]> = [];
			const seed: MemoryFileSystemSeed = {
				...SEED,
				[`${CWD}/node_modules/dep/index.js`]: "",
				[`${CWD}/dist/index.js`]: "",
				[`${CWD}/.git/HEAD`]: "",
				[`${CWD}/.turbo/log`]: "",
				[`${CWD}/.github/workflows/ci.yml`]: "",
			};
			const { handle, triggers, fiber } = yield* start({
				seed,
				watchers: WATCHERS + 1,
				handle: { spies: { watch: (path, options) => watched.push([path, options?.recursive === true]) } },
			});
			assert.deepStrictEqual(
				[...watched].sort(([a], [b]) => a.localeCompare(b)),
				[
					[ROOT, false],
					[`${ROOT}/.config`, false],
					[CWD, false],
					// Only an ancestor of `.github/actions/local`, so it is watched and its events are filtered.
					[`${CWD}/.github`, true],
					[`${CWD}/src`, true],
				],
			);
			yield* burst(handle, [[`${CWD}/.github/workflows/ci.yml`, "Update"]]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed(".github/workflows/ci.yml")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("watches a new top-level directory, and an edit inside it triggers", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			handle.mkdir(`${CWD}/lib`);
			handle.emit(`${CWD}/lib`, "Create");
			yield* settle;
			// Armed on the top-level event itself, before the batch is cut, so an edit inside it straight away is seen.
			assert.strictEqual(handle.watcherCount(), WATCHERS + 1, "the new directory is watched before the debounce");
			yield* TestClock.adjust("100 millis");
			yield* settle;
			yield* burst(handle, [[`${CWD}/lib/x.ts`, "Update"]]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("lib"), changed("lib/x.ts")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("removing a top-level directory rebuilds and does not fail the run", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			handle.remove(`${CWD}/src`);
			yield* burst(handle, [[`${CWD}/src`, "Remove"]]);
			assert.strictEqual(handle.watcherCount(), WATCHERS - 1, "its watch is gone");
			assert.isUndefined(fiber.pollUnsafe(), "run is still watching");
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("src")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("a top-level directory's watch ending once the directory is gone does not fail the run", () =>
		Effect.gen(function* () {
			const gone = yield* Deferred.make<void>();
			const { handle, triggers, fiber } = yield* start({
				watchers: WATCHERS - 1,
				handle: {
					faults: (base) => ({
						// The directory's watch lives until the directory is removed, then ends with no error.
						watch: (path, options) =>
							path === `${CWD}/src` ? Stream.drain(Stream.fromEffect(Deferred.await(gone))) : base.watch(path, options),
					}),
				},
			});
			handle.remove(`${CWD}/src`);
			yield* Deferred.succeed(gone, undefined);
			yield* settle;
			assert.isUndefined(fiber.pollUnsafe(), "run is still watching");
			yield* burst(handle, [[`${CWD}/README.md`, "Update"]]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("README.md")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("a top-level directory's watch ending while the directory is still there fails the run", () =>
		Effect.gen(function* () {
			const reason = stoppedReason(yield* runWithEndingWatch((dir) => dir === `${CWD}/src`));
			assert.strictEqual(reason.pathOrDescriptor, `${CWD}/src`);
		}),
	);

	it.effect("re-reads exclude before each batch, and re-arms the watched directories to match", () =>
		Effect.gen(function* () {
			const excludes = yield* Ref.make<ReadonlyArray<string>>(["generated"]);
			const watched: Array<string> = [];
			// `generated` is excluded, so it gets no watch: the package, the root tier, `src` and `out`.
			const { handle, triggers, fiber } = yield* start({
				seed: { ...SEED, [`${CWD}/generated/a.ts`]: "", [`${CWD}/out/a.ts`]: "" },
				watchers: WATCHERS + 1,
				exclude: Ref.get(excludes),
				handle: { spies: { watch: (path) => watched.push(path) } },
			});
			assert.notInclude(watched, `${CWD}/generated`);
			yield* burst(handle, [
				[`${CWD}/generated/a.ts`, "Update"],
				[`${CWD}/out/a.ts`, "Update"],
			]);
			// The exclusions change with the config, and the config edit is itself a batch: after it, the armed set follows.
			yield* Ref.set(excludes, ["out"]);
			yield* burst(handle, [[`${CWD}/package.json`, "Update"]]);
			assert.include(watched, `${CWD}/generated`, "the directory no longer excluded is watched");
			assert.strictEqual(handle.watcherCount(), WATCHERS + 1, "and the one now excluded is not");
			yield* burst(handle, [
				[`${CWD}/generated/b.ts`, "Update"],
				[`${CWD}/out/b.ts`, "Update"],
			]);
			assert.deepStrictEqual(yield* triggers, [
				{ _tag: "Initial" },
				changed("out/a.ts"),
				changed("package.json"),
				changed("generated/b.ts"),
			]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("watches the root tier for effected.toml only", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			yield* burst(handle, [[`${ROOT}/effected.toml`, "Create"]]);
			yield* burst(handle, [[`${ROOT}/README.md`, "Update"]]);
			yield* burst(handle, [[`${ROOT}/.config/effected.toml`, "Update"]]);
			assert.deepStrictEqual(yield* triggers, [
				{ _tag: "Initial" },
				changed("../../effected.toml"),
				changed("../../.config/effected.toml"),
			]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("skips a missing .config directory", () =>
		Effect.gen(function* () {
			const seed: MemoryFileSystemSeed = {
				[`${ROOT}/package.json`]: "{}",
				[`${CWD}/package.json`]: "{}",
			};
			const { handle, triggers, fiber } = yield* start({ seed, watchers: 2 });
			yield* burst(handle, [[`${ROOT}/effected.toml`, "Create"]]);
			assert.isUndefined(fiber.pollUnsafe(), "run is still watching");
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("../../effected.toml")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("watches a .config created after the watch starts, and drops its watch when it is removed", () =>
		Effect.gen(function* () {
			const seed: MemoryFileSystemSeed = {
				[`${ROOT}/package.json`]: "{}",
				[`${CWD}/package.json`]: "{}",
			};
			const { handle, triggers, fiber } = yield* start({ seed, watchers: 2 });
			// Created with its effected.toml already inside: the config changed, and later edits are seen.
			handle.write(`${ROOT}/.config/effected.toml`, "");
			yield* burst(handle, [[`${ROOT}/.config`, "Create"]]);
			assert.strictEqual(handle.watcherCount(), 3, "the new .config is watched");
			yield* burst(handle, [[`${ROOT}/.config/effected.toml`, "Update"]]);
			// Removed, then created again: its old watch is dropped, and the new one is armed afresh.
			handle.remove(`${ROOT}/.config`);
			yield* burst(handle, [[`${ROOT}/.config`, "Remove"]]);
			assert.strictEqual(handle.watcherCount(), 2, "the removed .config's watch is gone");
			assert.isUndefined(fiber.pollUnsafe(), "run is still watching");
			handle.mkdir(`${ROOT}/.config`);
			yield* burst(handle, [[`${ROOT}/.config`, "Create"]]);
			assert.strictEqual(handle.watcherCount(), 3, "the recreated .config is watched");
			yield* burst(handle, [[`${ROOT}/.config/effected.toml`, "Create"]]);
			assert.deepStrictEqual(yield* triggers, [
				{ _tag: "Initial" },
				changed("../../.config/effected.toml"),
				changed("../../.config/effected.toml"),
				changed("../../.config/effected.toml"),
			]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("does not watch the root tier when root is cwd", () =>
		Effect.gen(function* () {
			// `/repo` itself, then its top-level directories `.config` and `packages`; no root-tier watch on top.
			const { handle, triggers, fiber } = yield* start({ cwd: ROOT, watchers: 3 });
			yield* burst(handle, [
				[`${ROOT}/.cache/effected/build.jsonl`, "Update"],
				[`${ROOT}/.cache/effected/locks/a.lock`, "Create"],
			]);
			assert.strictEqual(handle.watcherCount(), 3);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("queues exactly one follow-up for changes during a build", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(SEED, { watchEvents: "manual" });
			const log = yield* Ref.make<ReadonlyArray<WatchTrigger>>([]);
			const running = yield* Ref.make(0);
			const peak = yield* Ref.make(0);
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const build = (trigger: WatchTrigger) =>
				Effect.gen(function* () {
					const now = yield* Ref.updateAndGet(running, (n) => n + 1);
					yield* Ref.update(peak, (p) => Math.max(p, now));
					yield* Ref.update(log, (all) => [...all, trigger]);
					const changes = yield* Ref.get(log);
					if (changes.length === 2) {
						yield* Deferred.succeed(entered, undefined);
						yield* Deferred.await(release);
					}
					yield* Ref.update(running, (n) => n - 1);
				});
			const fiber = yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build,
			}).pipe(Effect.provide(handle.layer), Effect.forkChild({ startImmediately: true }));
			yield* waitForWatchers(handle, WATCHERS);
			yield* burst(handle, [[`${CWD}/src/first.ts`, "Update"]]);
			yield* Deferred.await(entered);
			for (const name of ["c", "a", "b"]) {
				handle.emit(`${CWD}/src/${name}.ts`, "Update");
				yield* settle;
				yield* TestClock.adjust("150 millis");
				yield* settle;
			}
			assert.strictEqual((yield* Ref.get(log)).length, 2, "no build starts while one runs");
			yield* Deferred.succeed(release, undefined);
			yield* settle;
			yield* TestClock.adjust("100 millis");
			yield* settle;
			assert.deepStrictEqual(yield* Ref.get(log), [
				{ _tag: "Initial" },
				changed("src/first.ts"),
				changed("src/a.ts", "src/b.ts", "src/c.ts"),
			]);
			yield* TestClock.adjust("1 second");
			yield* settle;
			assert.strictEqual((yield* Ref.get(log)).length, 3, "exactly one follow-up");
			assert.strictEqual(yield* Ref.get(peak), 1);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("fails with the watcher's PlatformError", () =>
		Effect.gen(function* () {
			const failure = PlatformError.systemError({
				_tag: "Unknown",
				module: "FileSystem",
				method: "watch",
				pathOrDescriptor: CWD,
				description: "watcher died",
			});
			const options: MemoryFileSystemOptions = {
				watchEvents: "manual",
				faults: (base) => ({
					watch: (path, watchOptions) => (path === CWD ? Stream.fail(failure) : base.watch(path, watchOptions)),
				}),
			};
			const handle = yield* MemoryFileSystem.makeHandle(SEED, options);
			const error = yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build: () => Effect.void,
			}).pipe(Effect.provide(handle.layer), Effect.flip);
			assert.strictEqual(error, failure);
		}),
	);

	/** Runs `run` over a volume whose `watch` ends at once for every directory `ends` accepts, and returns its error. */
	const runWithEndingWatch = (ends: (dir: string) => boolean) =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(SEED, {
				watchEvents: "manual",
				faults: (base) => ({
					watch: (path, watchOptions) => (ends(path) ? Stream.empty : base.watch(path, watchOptions)),
				}),
			});
			return yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build: () => Effect.void,
			}).pipe(Effect.provide(handle.layer), Effect.flip);
		});

	/** The stopped-watcher error's `SystemError`, failing the test when the reason is anything else. */
	const stoppedReason = (error: PlatformError.PlatformError) => {
		const reason = error.reason;
		assert.instanceOf(reason, PlatformError.SystemError);
		if (!(reason instanceof PlatformError.SystemError)) throw new Error("unreachable");
		assert.strictEqual(reason._tag, "Unknown");
		assert.strictEqual(reason.method, "watch");
		assert.strictEqual(reason.description, "The watcher stopped.");
		return reason;
	};

	it.effect("fails when every watcher stops", () =>
		Effect.gen(function* () {
			const reason = stoppedReason(yield* runWithEndingWatch(() => true));
			assert.include([CWD, `${CWD}/src`, ROOT, `${ROOT}/.config`], reason.pathOrDescriptor);
		}),
	);

	it.effect("fails when the package watcher stops while the root tier stays live", () =>
		Effect.gen(function* () {
			const reason = stoppedReason(yield* runWithEndingWatch((dir) => dir === CWD));
			assert.strictEqual(reason.pathOrDescriptor, CWD);
		}),
	);
});

/** A pnpm workspace at ROOT with one package at CWD, plus whatever `extra` adds. */
const workspace = (extra: MemoryFileSystemSeed = {}): MemoryFileSystemSeed => ({
	[`${ROOT}/package.json`]: JSON.stringify({ name: "root" }),
	[`${ROOT}/pnpm-workspace.yaml`]: 'packages:\n  - "packages/*"\n',
	[`${CWD}/package.json`]: JSON.stringify({ name: "@scope/a" }),
	...extra,
});

const inVolume = <A, E>(seed: MemoryFileSystemSeed, effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(seed);
		return yield* effect.pipe(Effect.provide(handle.layer));
	});

describe("BuildWatch.target", () => {
	it.effect("target fails NotAPackageError without a package.json", () =>
		Effect.gen(function* () {
			const { [`${CWD}/package.json`]: _manifest, ...seed } = workspace();
			const error = yield* inVolume(seed, Effect.flip(BuildWatch.target(CWD, "package")));
			assert.instanceOf(error, NotAPackageError);
		}),
	);

	it.effect("target fails NotAnActionError for an action whose config has no [action] table", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: '[package.build]\ncopy = ["public"]\n' });
			const error = yield* inVolume(seed, Effect.flip(BuildWatch.target(CWD, "action")));
			assert.instanceOf(error, NotAnActionError);
		}),
	);

	it.effect("target succeeds for an action whose effected.toml does not parse", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: "[action\n" });
			const target = yield* inVolume(seed, BuildWatch.target(CWD, "action"));
			assert.deepStrictEqual(target, { cwd: CWD, root: ROOT });
		}),
	);

	it.effect("target resolves the workspace root above cwd", () =>
		Effect.gen(function* () {
			const target = yield* inVolume(workspace(), BuildWatch.target(CWD, "package"));
			assert.deepStrictEqual(target, { cwd: CWD, root: ROOT });
		}),
	);
});

describe("BuildWatch.actionExcludes", () => {
	it.effect("actionExcludes adds a custom persistLocal.path", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: '[action.persistLocal]\npath = "out/local"\n' });
			const excludes = yield* inVolume(seed, BuildWatch.actionExcludes({ cwd: CWD, root: ROOT }));
			assert.include(excludes, "out/local");
			for (const entry of DEFAULT_EXCLUDES) assert.include(excludes, entry);
		}),
	);

	it.effect("actionExcludes leaves persistLocal.path watched under persist: false", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: '[action.persistLocal]\npath = "out/local"\n' });
			const excludes = yield* inVolume(seed, BuildWatch.actionExcludes({ cwd: CWD, root: ROOT }, { persist: false }));
			assert.deepStrictEqual(excludes, DEFAULT_EXCLUDES);
		}),
	);

	it.effect("actionExcludes falls back to the defaults when the config will not load", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: "[action\n" });
			const excludes = yield* inVolume(seed, BuildWatch.actionExcludes({ cwd: CWD, root: ROOT }));
			assert.deepStrictEqual(excludes, DEFAULT_EXCLUDES);
		}),
	);
});

describe("BuildWatch.packageExcludes", () => {
	it.effect("packageExcludes adds each localPaths directory inside the package", () =>
		Effect.gen(function* () {
			const seed = workspace({
				[`${CWD}/effected.toml`]:
					'[package.build.meta]\nlocalPaths = ["docs/models", "./site/api/", "../../website/models"]\n',
			});
			const excludes = yield* inVolume(seed, BuildWatch.packageExcludes({ cwd: CWD, root: ROOT }));
			assert.deepStrictEqual(excludes, [...DEFAULT_EXCLUDES, "docs/models", "site/api"]);
		}),
	);

	it.effect("packageExcludes gives the defaults with no localPaths", () =>
		Effect.gen(function* () {
			const excludes = yield* inVolume(workspace(), BuildWatch.packageExcludes({ cwd: CWD, root: ROOT }));
			assert.deepStrictEqual(excludes, DEFAULT_EXCLUDES);
		}),
	);

	it.effect("packageExcludes gives the defaults under meta = false", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: "[package.build]\nmeta = false\n" });
			const excludes = yield* inVolume(seed, BuildWatch.packageExcludes({ cwd: CWD, root: ROOT }));
			assert.deepStrictEqual(excludes, DEFAULT_EXCLUDES);
		}),
	);

	it.effect("packageExcludes falls back to the defaults when the config will not load", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: "[package.build\n" });
			const excludes = yield* inVolume(seed, BuildWatch.packageExcludes({ cwd: CWD, root: ROOT }));
			assert.deepStrictEqual(excludes, DEFAULT_EXCLUDES);
		}),
	);
});
