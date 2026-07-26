import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ActionEnvironment, ToolInstaller, ToolInstallerError } from "../src/index.js";

/** A scratch tool-cache root, removed by the test that made it. */
const scratch = () => mkdtempSync(join(tmpdir(), "effected-toolcache-"));

const alwaysFails: typeof globalThis.fetch = async () => new Response("no", { status: 500 });

/**
 * The real thing: real filesystem, real `tar`, real `unzip`.
 *
 * @remarks
 * A stubbed filesystem cannot test this module's central claim. Stage-then-swap
 * is a statement about what the filesystem contains after a partial failure,
 * and an in-memory double would only assert the double. Extraction has the same
 * problem one level up — a fake spawner proves the arguments were assembled,
 * not that `tar` accepts them.
 */
const live = (root: string, fetch: typeof globalThis.fetch = alwaysFails, env: Record<string, string> = {}) =>
	ToolInstaller.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				ActionEnvironment.layerTest({ RUNNER_TOOL_CACHE: root, ...env }),
				NodeServices.layer,
				FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch))),
			),
		),
	);

const withRoot = <A, E>(
	use: (root: string) => Effect.Effect<A, E, ToolInstaller>,
	options: { fetch?: typeof globalThis.fetch; env?: Record<string, string> } = {},
) => {
	const root = scratch();
	return use(root).pipe(
		Effect.provide(live(root, options.fetch ?? alwaysFails, options.env ?? {})),
		Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
	);
};

/** A real gzipped tarball containing one file. */
const makeTarball = (directory: string, contents: string): string => {
	const staging = join(directory, "payload");
	mkdirSync(staging, { recursive: true });
	writeFileSync(join(staging, "tool.txt"), contents);
	const archive = join(directory, "tool.tar.gz");
	execFileSync("tar", ["czf", archive, "-C", staging, "tool.txt"]);
	return archive;
};

describe("ToolInstaller", () => {
	describe("the cache layout", () => {
		it("is the layout the runner and @actions/tool-cache both use", () => {
			// A contract with the runner, not an internal detail: a tool cached at
			// any other path is invisible to every other step in the workflow.
			assert.strictEqual(
				ToolInstaller.cachePath({ root: "/opt/hostedtoolcache", tool: "node", version: "22.11.0", arch: "x64" }),
				"/opt/hostedtoolcache/node/22.11.0/x64",
			);
		});
	});

	describe("find", () => {
		it.live("reports a cached tool", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const expected = ToolInstaller.cachePath({ root, tool: "node", version: "22.11.0", arch: process.arch });
					mkdirSync(expected, { recursive: true });
					assert.deepStrictEqual(yield* (yield* ToolInstaller).find("node", "22.11.0"), Option.some(expected));
				}),
			),
		);

		it.live("reports nothing for a tool that is not there", () =>
			withRoot(() =>
				Effect.gen(function* () {
					assert.isTrue(Option.isNone(yield* (yield* ToolInstaller).find("node", "0.0.1")));
				}),
			),
		);

		it.live("reports nothing when the cache path is a file rather than a directory", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					// A stray file where a tool directory belongs is corruption, and
					// answering "found" for it hands the caller a path it cannot use.
					const expected = ToolInstaller.cachePath({ root, tool: "node", version: "1.0.0", arch: process.arch });
					mkdirSync(join(expected, ".."), { recursive: true });
					writeFileSync(expected, "not a directory");
					assert.isTrue(Option.isNone(yield* (yield* ToolInstaller).find("node", "1.0.0")));
				}),
			),
		);
	});

	describe("caching, and the stage-then-swap invariant", () => {
		it.live("installs a directory at the cache path", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const source = join(root, "src");
					mkdirSync(source, { recursive: true });
					writeFileSync(join(source, "bin"), "#!/bin/sh\n");

					const installer = yield* ToolInstaller;
					const cached = yield* installer.cacheDir(source, "node", "22.11.0");
					assert.strictEqual(
						cached,
						ToolInstaller.cachePath({ root, tool: "node", version: "22.11.0", arch: process.arch }),
					);
					assert.strictEqual(readFileSync(join(cached, "bin"), "utf8"), "#!/bin/sh\n");
					assert.deepStrictEqual(yield* installer.find("node", "22.11.0"), Option.some(cached));
				}),
			),
		);

		it.live("leaves NOTHING at the cache path when the install fails", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const installer = yield* ToolInstaller;
					// THE invariant. An implementation that creates the destination and
					// then copies into it leaves an empty directory behind here — and
					// `find` reports an empty directory as a hit, so every later run
					// uses a tool that is not there and never re-downloads it.
					const error = yield* Effect.flip(installer.cacheDir(join(root, "does-not-exist"), "node", "22.11.0"));
					assert.instanceOf(error, ToolInstallerError);
					assert.strictEqual(error.reason, "cacheFailed");

					const destination = ToolInstaller.cachePath({ root, tool: "node", version: "22.11.0", arch: process.arch });
					assert.isFalse(existsSync(destination), "a failed install must not leave a partial tool behind");
					assert.isTrue(Option.isNone(yield* installer.find("node", "22.11.0")));
				}),
			),
		);

		it.live("leaves no staging directory behind after a failure", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const installer = yield* ToolInstaller;
					yield* Effect.flip(installer.cacheDir(join(root, "does-not-exist"), "node", "22.11.0"));
					const { readdirSync } = yield* Effect.promise(() => import("node:fs"));
					const leftovers = readdirSync(root).filter((entry) => entry.startsWith(".staging-"));
					assert.deepStrictEqual(leftovers, [], "the staging directory must be cleaned up on the failure path");
				}),
			),
		);

		it.live("replaces an existing install rather than merging into it", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const installer = yield* ToolInstaller;
					const first = join(root, "first");
					mkdirSync(first, { recursive: true });
					writeFileSync(join(first, "stale.txt"), "old");
					yield* installer.cacheDir(first, "node", "22.11.0");

					const second = join(root, "second");
					mkdirSync(second, { recursive: true });
					writeFileSync(join(second, "fresh.txt"), "new");
					const cached = yield* installer.cacheDir(second, "node", "22.11.0");

					// A merge would leave `stale.txt` from the previous version's
					// layout sitting in the new install.
					assert.isTrue(existsSync(join(cached, "fresh.txt")));
					assert.isFalse(existsSync(join(cached, "stale.txt")), "a re-install must replace, not merge");
				}),
			),
		);

		it.live("installs a single file under the name it is given", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const source = join(root, "downloaded-binary");
					writeFileSync(source, "binary");
					const cached = yield* (yield* ToolInstaller).cacheFile(source, "mytool", "mytool", "1.0.0");
					assert.strictEqual(readFileSync(join(cached, "mytool"), "utf8"), "binary");
				}),
			),
		);
	});

	describe("extraction", () => {
		it.live("extracts a real gzipped tarball", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const archive = makeTarball(root, "hello");
					const extracted = yield* (yield* ToolInstaller).extractTar(archive);
					assert.strictEqual(readFileSync(join(extracted, "tool.txt"), "utf8"), "hello");
				}),
			),
		);

		it.live("extracts into a destination it is given, creating it", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const archive = makeTarball(root, "hello");
					const destination = join(root, "nested", "target");
					const extracted = yield* (yield* ToolInstaller).extractTar(archive, { destination });
					assert.strictEqual(extracted, destination);
					assert.strictEqual(readFileSync(join(destination, "tool.txt"), "utf8"), "hello");
				}),
			),
		);

		it.live("fails typed, carrying tar's own complaint, on a corrupt archive", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const archive = join(root, "not-really.tar.gz");
					writeFileSync(archive, "this is not a tarball");
					const error = yield* Effect.flip((yield* ToolInstaller).extractTar(archive));
					assert.strictEqual(error.reason, "extractFailed");
					// The exit code alone says only "it failed"; stderr is the difference
					// between a corrupt archive and tar not being installed.
					assert.isAbove((error.stderr ?? "").length, 0, "tar's stderr must survive");
				}),
			),
		);
	});

	describe("download", () => {
		it.live("streams the body to a file", () =>
			withRoot(
				() =>
					Effect.gen(function* () {
						const file = yield* (yield* ToolInstaller).download("https://example.test/tool.tar.gz");
						assert.strictEqual(readFileSync(file, "utf8"), "archive-bytes");
					}),
				{ fetch: async () => new Response("archive-bytes", { status: 200 }) },
			),
		);

		it.live("fails typed on a 404 and does NOT retry it", () =>
			withRoot(
				() =>
					Effect.gen(function* () {
						// A 404 will not fix itself; retrying it three times only makes a
						// broken url take longer to fail.
						const error = yield* Effect.flip((yield* ToolInstaller).download("https://example.test/gone"));
						assert.strictEqual(error.reason, "downloadFailed");
						assert.strictEqual(error.status, 404);
						assert.isFalse(error.retryable);
					}),
				{ fetch: async () => new Response("gone", { status: 404 }) },
			),
		);

		it.live("classifies what is worth retrying", () => {
			const of = (status?: number) =>
				new ToolInstallerError({ reason: "downloadFailed", ...(status === undefined ? {} : { status }) });
			assert.isTrue(of(500).retryable);
			assert.isTrue(of(503).retryable);
			assert.isTrue(of(408).retryable);
			assert.isTrue(of(429).retryable);
			assert.isTrue(of().retryable, "a transport fault with no status is the most retryable thing there is");
			assert.isFalse(of(404).retryable);
			assert.isFalse(of(401).retryable);
			assert.isFalse(new ToolInstallerError({ reason: "extractFailed" }).retryable);
			return Effect.void;
		});
	});

	describe("test double", () => {
		it.effect("an unstubbed member dies rather than reporting a tool that is not there", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(Effect.flatMap(ToolInstaller, (installer) => installer.find("node", "1")));
				assert.strictEqual(exit._tag, "Failure");
			}).pipe(Effect.provide(ToolInstaller.layerTest())),
		);

		it.effect("an override wins", () =>
			Effect.gen(function* () {
				const found = yield* Effect.flatMap(ToolInstaller, (installer) => installer.find("node", "1"));
				assert.deepStrictEqual(found, Option.some("/cached"));
			}).pipe(Effect.provide(ToolInstaller.layerTest({ find: () => Effect.succeed(Option.some("/cached")) }))),
		);
	});
});
