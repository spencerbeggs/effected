import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { PackageManagerPin } from "@effected/npm";
import { Effect, Layer, Logger, Option, PlatformError, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
	ActionEnvironment,
	AmbientPackageManager,
	CachedPackageManager,
	InstalledPackageManager,
	PackageManagerInstaller,
	PackageManagerInstallerError,
	ToolInstaller,
	ToolInstallerError,
} from "../src/index.js";

/** A scratch tool-cache root, removed by the test that made it. */
const scratch = () => mkdtempSync(join(tmpdir(), "effected-pminstall-"));

const alwaysFails: typeof globalThis.fetch = async () => new Response("no", { status: 500 });

/** A fetch scripted by exact url, recording every request it sees. */
const scriptedFetch = (replies: Readonly<Record<string, () => Response>>) => {
	const calls: Array<string> = [];
	const fetch: typeof globalThis.fetch = async (input) => {
		const url = String(input);
		calls.push(url);
		const reply = replies[url];
		return reply === undefined ? new Response("not scripted", { status: 404 }) : reply();
	};
	return { calls, fetch };
};

/**
 * The real thing: real filesystem, real `tar`, real `unzip`, the real
 * ToolInstaller underneath — the claims here are about what lands in the tool
 * cache, and a stubbed filesystem would only assert the stub.
 */
const live = (root: string, fetch: typeof globalThis.fetch = alwaysFails, env: Record<string, string> = {}) => {
	const platform = Layer.mergeAll(
		ActionEnvironment.layerTest({ RUNNER_TOOL_CACHE: root, ...env }),
		NodeServices.layer,
		FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch))),
	);
	return PackageManagerInstaller.layer.pipe(Layer.provideMerge(ToolInstaller.layer), Layer.provide(platform));
};

const withRoot = <A, E>(
	use: (
		root: string,
	) => Effect.Effect<A, E, PackageManagerInstaller | ToolInstaller | ChildProcessSpawner.ChildProcessSpawner>,
	options: { fetch?: typeof globalThis.fetch; env?: Record<string, string> } = {},
) => {
	const root = scratch();
	return use(root).pipe(
		Effect.provide(live(root, options.fetch ?? alwaysFails, options.env ?? {})),
		// A second NodeServices at the outer level gives the TEST its own real
		// spawner for probing installed shims; the layer above consumed its own.
		Effect.provide(NodeServices.layer),
		Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
	);
};

/**
 * A registry-shaped tarball: `package/package.json` with a `bin` map plus the
 * bin files themselves, gzipped — the layout npm, pnpm, yarn 1.x and
 * `@yarnpkg/cli-dist` all publish (probed against the real tarballs).
 */
const makeManagerTarball = (
	directory: string,
	options: {
		readonly name: string;
		readonly version: string;
		readonly bin?: Record<string, string> | undefined;
		readonly binFiles?: ReadonlyArray<string> | undefined;
		readonly binFileContents?: string | undefined;
		readonly extraFiles?: ReadonlyArray<string> | undefined;
		readonly omitManifest?: boolean | undefined;
	},
): string => {
	const safeName = options.name.replaceAll("/", "-");
	const staging = join(directory, `staging-${safeName}-${options.version}`);
	const packageDir = join(staging, "package");
	mkdirSync(packageDir, { recursive: true });
	if (options.omitManifest !== true) {
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: options.name, version: options.version, ...(options.bin ? { bin: options.bin } : {}) }),
		);
	}
	for (const file of options.binFiles ?? []) {
		mkdirSync(join(packageDir, file, ".."), { recursive: true });
		writeFileSync(
			join(packageDir, file),
			options.binFileContents ?? `#!/usr/bin/env node\nconsole.log("${options.name}");\n`,
		);
	}
	for (const file of options.extraFiles ?? []) {
		writeFileSync(join(packageDir, file), "plain file");
	}
	const archive = join(directory, `${safeName}-${options.version}.tgz`);
	execFileSync("tar", ["czf", archive, "-C", staging, "package"]);
	return archive;
};

/** A bun-release-shaped zip: `bun-<target>/bun` (the layout bun's own install script unpacks). */
const makeBunZip = (directory: string, target: string): string => {
	const staging = join(directory, "bun-staging");
	mkdirSync(join(staging, target), { recursive: true });
	writeFileSync(join(staging, target, "bun"), "#!/bin/sh\necho bun\n");
	const archive = join(directory, `${target}.zip`);
	execFileSync("zip", ["-rq", archive, target], { cwd: staging });
	return archive;
};

const tgzResponse = (archive: string) => () => new Response(new Uint8Array(readFileSync(archive)), { status: 200 });

const sha512Hex = (file: string): string => createHash("sha512").update(readFileSync(file)).digest("hex");

/** A spawner whose `string` is scripted and whose other members die loudly. */
const scriptedSpawner = (
	string: () => Effect.Effect<string, PlatformError.PlatformError>,
): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> =>
	Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
		spawn: () => Effect.die("scriptedSpawner: spawn was called but not scripted"),
		exitCode: () => Effect.die("scriptedSpawner: exitCode was called but not scripted"),
		streamString: () => Stream.fromEffect(Effect.die("scriptedSpawner: streamString was called but not scripted")),
		streamLines: () => Stream.fromEffect(Effect.die("scriptedSpawner: streamLines was called but not scripted")),
		lines: () => Effect.die("scriptedSpawner: lines was called but not scripted"),
		string,
	});

/** A stub-backed layer for the short-circuit tests: no download path exists unless stubbed. */
const stubbed = (options: {
	readonly installer?: Parameters<typeof ToolInstaller.layerTest>[0] | undefined;
	readonly spawner?: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> | undefined;
	readonly env?: Record<string, string> | undefined;
}) =>
	PackageManagerInstaller.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				ActionEnvironment.layerTest(options.env ?? {}),
				NodeServices.layer,
				options.spawner ?? Layer.empty,
				ToolInstaller.layerTest(options.installer ?? {}),
			),
		),
	);

const pin = (spec: string): PackageManagerPin => {
	const parsed = PackageManagerPin.parseResult(spec);
	if (parsed._tag !== "Success") {
		throw new Error(`test pin ${spec} did not parse`);
	}
	return parsed.success;
};

const install = (spec: string, options?: { requireIntegrity?: boolean; registry?: string; allowAmbient?: boolean }) =>
	Effect.flatMap(PackageManagerInstaller, (installer) => installer.install(pin(spec), options));

/** Narrow to the tool-cache variant or fail the test loudly. */
const cachedOf = (installed: InstalledPackageManager): CachedPackageManager => {
	assert.instanceOf(installed, CachedPackageManager);
	assert.strictEqual(installed.source, "tool-cache");
	return installed as CachedPackageManager;
};

describe("PackageManagerInstaller", () => {
	describe("the tool-cache short-circuit", () => {
		it.live("answers from the cache without downloading anything, regenerating absent shims", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					// The fetch always fails, so a hit here proves no download happened.
					// The entry has no `.bin` — a foreign writer (runner image, setup-*
					// action, or the previous version of this module) cached it — so
					// the shims must be regenerated into the entry.
					const cached = ToolInstaller.cachePath({ root, tool: "pnpm", version: "7.7.7", arch: process.arch });
					mkdirSync(join(cached, "bin"), { recursive: true });
					writeFileSync(join(cached, "package.json"), JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }));
					writeFileSync(join(cached, "bin", "pnpm.cjs"), "console.log('pnpm')");

					const installed = cachedOf(yield* install("pnpm@7.7.7"));
					assert.strictEqual(installed.directory, cached);
					assert.strictEqual(installed.binDir, join(cached, ".bin"));
					assert.deepStrictEqual(installed.bins, { pnpm: join(cached, "bin", "pnpm.cjs") });
					// The regenerated shim points INTO the cached entry, verbatim.
					assert.strictEqual(
						readFileSync(join(cached, ".bin", "pnpm"), "utf8"),
						`#!/bin/sh\nexec node "${join(cached, "bin", "pnpm.cjs")}" "$@"\n`,
					);
					assert.notStrictEqual(statSync(join(cached, ".bin", "pnpm")).mode & 0o111, 0);
				}),
			),
		);

		it.live("leaves an already-present shim untouched on a cache hit", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					// The tool cache is SHARED: another writer's shim must not be
					// rewritten out from under it.
					const cached = ToolInstaller.cachePath({ root, tool: "pnpm", version: "7.7.9", arch: process.arch });
					mkdirSync(join(cached, "bin"), { recursive: true });
					mkdirSync(join(cached, ".bin"), { recursive: true });
					writeFileSync(join(cached, "package.json"), JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }));
					writeFileSync(join(cached, "bin", "pnpm.cjs"), "console.log('pnpm')");
					writeFileSync(join(cached, ".bin", "pnpm"), "#!/bin/sh\n# sentinel: a foreign shim\n");

					yield* install("pnpm@7.7.9");
					assert.include(readFileSync(join(cached, ".bin", "pnpm"), "utf8"), "sentinel");
				}),
			),
		);

		it.live("a shim that cannot be regenerated is a typed cacheFailed", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const cached = ToolInstaller.cachePath({ root, tool: "pnpm", version: "7.8.0", arch: process.arch });
					mkdirSync(join(cached, "bin"), { recursive: true });
					writeFileSync(join(cached, "package.json"), JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }));
					writeFileSync(join(cached, "bin", "pnpm.cjs"), "console.log('pnpm')");
					chmodSync(cached, 0o555); // read-only entry: the .bin mkdir must fail
					const error = yield* Effect.flip(install("pnpm@7.8.0"));
					chmodSync(cached, 0o755); // restore so cleanup can remove the root
					assert.instanceOf(error, PackageManagerInstallerError);
					assert.strictEqual(error.reason, "cacheFailed");
				}),
			),
		);

		it.live("reports a corrupted cache entry as layoutUnexpected rather than answering with it", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					const cached = ToolInstaller.cachePath({ root, tool: "pnpm", version: "7.7.8", arch: process.arch });
					mkdirSync(cached, { recursive: true }); // present, but empty — no manifest
					const error = yield* Effect.flip(install("pnpm@7.7.8"));
					assert.instanceOf(error, PackageManagerInstallerError);
					assert.strictEqual(error.reason, "layoutUnexpected");
				}),
			),
		);

		it.live("refuses a bin path that escapes the package directory, even when its target exists", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					// The hostile-manifest case: the bin names a file OUTSIDE the
					// entry, and that file EXISTS — so the existence check alone would
					// pass, a shim would be written invoking it, and `bins` would
					// publish a path the artifact never legitimately owned. Only the
					// containment guard can refuse this one.
					const cached = ToolInstaller.cachePath({ root, tool: "pnpm", version: "7.9.0", arch: process.arch });
					mkdirSync(cached, { recursive: true });
					writeFileSync(join(cached, "package.json"), JSON.stringify({ bin: { pnpm: "../../../evil.js" } }));
					// `<root>/pnpm/7.9.0/<arch>/../../../evil.js` is `<root>/evil.js`.
					writeFileSync(join(root, "evil.js"), "console.log('payload')");
					const error = yield* Effect.flip(install("pnpm@7.9.0"));
					assert.instanceOf(error, PackageManagerInstallerError);
					assert.strictEqual(error.reason, "layoutUnexpected");
					assert.include(error.subject ?? "", "pnpm");
					assert.include(error.subject ?? "", "escapes");
					assert.isFalse(existsSync(join(cached, ".bin")), "no shim may be written for an escaping bin");
				}),
			),
		);
	});

	describe("the ambient npm short-circuit", () => {
		it.effect("answers ambient when the probe matches the pin exactly", () =>
			Effect.gen(function* () {
				const installed = yield* install("npm@9.9.9");
				assert.instanceOf(installed, AmbientPackageManager);
				assert.strictEqual(installed.source, "ambient");
				assert.strictEqual(installed.version, "9.9.9");
				// The discriminant is structural: the ambient variant HAS no
				// directory or binDir field, rather than carrying undefined ones.
				assert.isFalse("directory" in installed);
				assert.isFalse("binDir" in installed);
				assert.deepStrictEqual(installed.bins, { npm: "npm", npx: "npx" });
			}).pipe(
				Effect.provide(
					stubbed({
						// find misses; download would DIE if the short-circuit failed to fire.
						installer: { find: () => Effect.succeed(Option.none()) },
						spawner: scriptedSpawner(() => Effect.succeed("9.9.9\n")),
					}),
				),
			),
		);

		it.live("allowAmbient: false suppresses the probe even when it WOULD match, and installs to the tool cache", () =>
			Effect.gen(function* () {
				// The discriminating case for the option: the probe stands ready to
				// answer EXACTLY the pinned version — but it must never be asked. A
				// consumer that sets allowAmbient: false is replacing node in-run,
				// so the runner's npm is about to be shadowed and its answer would
				// diverge from the npm that actually executes.
				const root = scratch();
				const extracted = join(root, "extracted", "package");
				mkdirSync(join(extracted, "bin"), { recursive: true });
				writeFileSync(join(extracted, "package.json"), JSON.stringify({ bin: { npm: "bin/npm-cli.js" } }));
				writeFileSync(join(extracted, "bin", "npm-cli.js"), "console.log('npm')");
				const destination = ToolInstaller.cachePath({ root, tool: "npm", version: "9.9.9", arch: process.arch });

				const probes: Array<string> = [];
				const installed = cachedOf(
					yield* install("npm@9.9.9", { allowAmbient: false }).pipe(
						Effect.provide(
							stubbed({
								env: { RUNNER_TOOL_CACHE: root },
								spawner: scriptedSpawner(() =>
									Effect.suspend(() => {
										probes.push("npm --version");
										return Effect.succeed("9.9.9\n"); // WOULD match — must never be consulted
									}),
								),
								installer: {
									find: () => Effect.succeed(Option.none()),
									download: () => Effect.succeed(join(root, "unused-archive")),
									extractTar: () => Effect.succeed(join(root, "extracted")),
									cacheDir: () => Effect.succeed(destination),
								},
							}),
						),
						Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
					),
				);
				assert.lengthOf(probes, 0, "the ambient probe must not have been spawned at all");
				assert.strictEqual(installed.source, "tool-cache");
				assert.strictEqual(installed.binDir, join(destination, ".bin"));
			}),
		);

		it.effect("allowAmbient: true is the default behavior, spelled out", () =>
			Effect.gen(function* () {
				const installed = yield* install("npm@9.9.9", { allowAmbient: true });
				assert.instanceOf(installed, AmbientPackageManager);
				assert.strictEqual(installed.source, "ambient");
			}).pipe(
				Effect.provide(
					stubbed({
						installer: { find: () => Effect.succeed(Option.none()) },
						spawner: scriptedSpawner(() => Effect.succeed("9.9.9\n")),
					}),
				),
			),
		);

		it.live("falls through to the dist path when the probe answers a different version", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "npm",
					version: "1.0.0",
					bin: { npm: "bin/npm-cli.js", npx: "bin/npx-cli.js" },
					binFiles: ["bin/npm-cli.js", "bin/npx-cli.js"],
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/npm/-/npm-1.0.0.tgz": tgzResponse(archive) });
				// The REAL spawner probes the host's real npm, whose version is never
				// the fixture's 1.0.0 — so the probe answers, mismatches, and the
				// dist path runs.
				const installed = cachedOf(
					yield* install("npm@1.0.0").pipe(
						Effect.provide(live(root, script.fetch)),
						Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
					),
				);
				assert.deepStrictEqual(script.calls, ["https://registry.npmjs.org/npm/-/npm-1.0.0.tgz"]);
				assert.strictEqual(installed.bins.npm, join(installed.directory, "bin", "npm-cli.js"));
			}),
		);

		it.live("a failed probe is not an error — it falls through to the dist path", () =>
			Effect.gen(function* () {
				const root = scratch();
				const extracted = join(root, "extracted", "package");
				mkdirSync(join(extracted, "bin"), { recursive: true });
				writeFileSync(join(extracted, "package.json"), JSON.stringify({ bin: { npm: "bin/npm-cli.js" } }));
				writeFileSync(join(extracted, "bin", "npm-cli.js"), "console.log('npm')");

				// The stub answers with the destination the module derives, so the
				// divergence guard passes and the record comes back tool-cache.
				const destination = ToolInstaller.cachePath({ root, tool: "npm", version: "1.2.3", arch: process.arch });
				const installed = cachedOf(
					yield* install("npm@1.2.3").pipe(
						Effect.provide(
							stubbed({
								env: { RUNNER_TOOL_CACHE: root },
								spawner: scriptedSpawner(() =>
									Effect.fail(
										PlatformError.badArgument({
											module: "Test",
											method: "string",
											description: "npm is not installed",
										}),
									),
								),
								installer: {
									find: () => Effect.succeed(Option.none()),
									download: () => Effect.succeed(join(root, "unused-archive")),
									extractTar: () => Effect.succeed(join(root, "extracted")),
									cacheDir: () => Effect.succeed(destination),
								},
							}),
						),
						Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
					),
				);
				assert.strictEqual(installed.bins.npm, join(destination, "bin", "npm-cli.js"));
				assert.strictEqual(installed.binDir, join(destination, ".bin"));
			}),
		);
	});

	describe("shims", () => {
		it.live("writes executable shims as part of the cached entry, naming the final path", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "5.0.0",
					bin: { pnpm: "bin/pnpm.cjs", pnpx: "bin/pnpx.cjs" },
					binFiles: ["bin/pnpm.cjs", "bin/pnpx.cjs"],
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-5.0.0.tgz": tgzResponse(archive) });
				const installed = cachedOf(yield* install("pnpm@5.0.0").pipe(Effect.provide(live(root, script.fetch))));
				assert.strictEqual(installed.binDir, join(installed.directory, ".bin"));
				// The shim contents are the contract: an exec wrapper naming the
				// FINAL cached entry path — never the staging directory the entry
				// was assembled in — pinned verbatim.
				const shim = readFileSync(join(installed.binDir, "pnpm"), "utf8");
				assert.strictEqual(shim, `#!/bin/sh\nexec node "${join(installed.directory, "bin", "pnpm.cjs")}" "$@"\n`);
				assert.strictEqual(
					readFileSync(join(installed.binDir, "pnpx"), "utf8"),
					`#!/bin/sh\nexec node "${join(installed.directory, "bin", "pnpx.cjs")}" "$@"\n`,
				);
				assert.notStrictEqual(statSync(join(installed.binDir, "pnpm")).mode & 0o111, 0, "shims must be executable");
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("a shim passes its arguments through intact, run for real", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "5.0.1",
					bin: { pnpm: "bin/pnpm.cjs" },
					binFiles: ["bin/pnpm.cjs"],
					binFileContents: "console.log(JSON.stringify(process.argv.slice(2)));\n",
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-5.0.1.tgz": tgzResponse(archive) });
				const program = Effect.gen(function* () {
					const installed = cachedOf(yield* install("pnpm@5.0.1"));
					// The REAL spawner executes the shim itself: shebang, executable
					// bit and `"$@"` quoting all have to hold for this to answer.
					const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
					const output = yield* spawner.string(
						ChildProcess.make(join(installed.binDir, "pnpm"), ["a b", "--flag", "c"]),
					);
					assert.deepStrictEqual(JSON.parse(output.trim()), ["a b", "--flag", "c"]);
				});
				yield* program.pipe(
					Effect.provide(Layer.mergeAll(live(root, script.fetch), NodeServices.layer)),
					Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
				);
			}),
		);

		it.live("a shim directory that cannot be created fails typed as cacheFailed, and caches nothing", () =>
			Effect.gen(function* () {
				const root = scratch();
				// The tarball ships a FILE named `.bin` where the shim directory
				// must go — the mkdir fails, and the entry must not be cached.
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "5.0.2",
					bin: { pnpm: "bin/pnpm.cjs" },
					binFiles: ["bin/pnpm.cjs"],
					extraFiles: [".bin"],
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-5.0.2.tgz": tgzResponse(archive) });
				const error = yield* Effect.flip(install("pnpm@5.0.2").pipe(Effect.provide(live(root, script.fetch))));
				assert.instanceOf(error, PackageManagerInstallerError);
				assert.strictEqual(error.reason, "cacheFailed");
				const destination = ToolInstaller.cachePath({ root, tool: "pnpm", version: "5.0.2", arch: process.arch });
				assert.isFalse(existsSync(destination), "a failed shim write must not leave a cached entry behind");
				rmSync(root, { recursive: true, force: true });
			}),
		);
	});

	describe("integrity", () => {
		it.live("verifies a pin that carries integrity and proceeds on a match", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "1.0.0",
					bin: { pnpm: "bin/pnpm.cjs" },
					binFiles: ["bin/pnpm.cjs"],
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-1.0.0.tgz": tgzResponse(archive) });
				const installed = yield* install(`pnpm@1.0.0+sha512.${sha512Hex(archive)}`).pipe(
					Effect.provide(live(root, script.fetch)),
					Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
				);
				assert.strictEqual(installed.source, "tool-cache");
			}),
		);

		it.live("fails closed on a mismatch, and caches NOTHING", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "1.0.1",
					bin: { pnpm: "bin/pnpm.cjs" },
					binFiles: ["bin/pnpm.cjs"],
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-1.0.1.tgz": tgzResponse(archive) });
				const wrong = "0".repeat(128);
				const error = yield* Effect.flip(
					install(`pnpm@1.0.1+sha512.${wrong}`).pipe(Effect.provide(live(root, script.fetch))),
				);
				assert.instanceOf(error, PackageManagerInstallerError);
				assert.strictEqual(error.reason, "integrityMismatch");
				assert.strictEqual(error.expected, `sha512.${wrong}`);
				assert.strictEqual(error.actual, `sha512.${sha512Hex(archive)}`);
				// A measured mismatch names both hashes...
				assert.include(error.message, "Integrity mismatch");
				assert.include(error.message, `sha512.${wrong}`);
				// ...while a failure to compute the digest at all says THAT, rather
				// than reporting a mismatch it never measured as
				// "expected undefined, got undefined".
				assert.include(
					new PackageManagerInstallerError({
						reason: "integrityMismatch",
						name: "pnpm",
						version: "1.0.1",
						subject: "/tmp/pnpm.tgz",
					}).message,
					"Could not verify the integrity",
				);
				const destination = ToolInstaller.cachePath({ root, tool: "pnpm", version: "1.0.1", arch: process.arch });
				assert.isFalse(existsSync(destination), "a failed verification must not leave anything in the cache");
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("proceeds with a logged warning when the pin carries no integrity", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "1.0.2",
					bin: { pnpm: "bin/pnpm.cjs" },
					binFiles: ["bin/pnpm.cjs"],
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-1.0.2.tgz": tgzResponse(archive) });
				const entries: Array<{ level: string; message: unknown }> = [];
				const recorder = Logger.layer([
					Logger.make((options) => {
						entries.push({ level: options.logLevel, message: options.message });
					}),
				]);
				const installed = yield* install("pnpm@1.0.2").pipe(
					Effect.provide(Layer.mergeAll(live(root, script.fetch), recorder)),
					Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
				);
				assert.strictEqual(installed.source, "tool-cache");
				const warning = entries.find((entry) => entry.level === "Warn");
				assert.isDefined(warning, "an unverified download must be announced");
				assert.include(String(warning?.message), "integrity");
			}),
		);

		it.effect("requireIntegrity makes an integrity-less pin a typed failure, before anything else runs", () =>
			Effect.gen(function* () {
				// EVERY ToolInstaller member dies here — the strictness is a statement
				// about the pin and must be decided before the cache is even consulted.
				const error = yield* Effect.flip(install("npm@9.9.9", { requireIntegrity: true }));
				assert.instanceOf(error, PackageManagerInstallerError);
				assert.strictEqual(error.reason, "integrityMissing");
			}).pipe(Effect.provide(stubbed({}))),
		);
	});

	describe("the yarn version split", () => {
		it.live("yarn 1.x downloads the yarn registry tarball", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "yarn",
					version: "1.22.10",
					// yarn 1.x publishes its bin with a `./` prefix (probed) — the
					// resolved path must normalize it away.
					bin: { yarn: "./bin/yarn.js", yarnpkg: "./bin/yarn.js" },
					binFiles: ["bin/yarn.js"],
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/yarn/-/yarn-1.22.10.tgz": tgzResponse(archive) });
				const installed = cachedOf(
					yield* install("yarn@1.22.10").pipe(
						Effect.provide(live(root, script.fetch)),
						Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
					),
				);
				assert.deepStrictEqual(script.calls, ["https://registry.npmjs.org/yarn/-/yarn-1.22.10.tgz"]);
				assert.strictEqual(installed.bins.yarn, join(installed.directory, "bin", "yarn.js"));
				assert.strictEqual(installed.bins.yarnpkg, join(installed.directory, "bin", "yarn.js"));
			}),
		);

		it.live("yarn 2+ downloads @yarnpkg/cli-dist, and verifies integrity against bin/yarn.js", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "@yarnpkg/cli-dist",
					version: "4.1.0",
					bin: { yarn: "bin/yarn.js", yarnpkg: "bin/yarn.js" },
					binFiles: ["bin/yarn.js"],
				});
				// What corepack hashes for a Berry pin is the standalone yarn.js —
				// byte-identical to the tarball's bin/yarn.js (probed) — NOT the
				// tarball. So the js-file hash must pass…
				const staged = join(root, "staging-@yarnpkg-cli-dist-4.1.0", "package", "bin", "yarn.js");
				const cliHash = createHash("sha512").update(readFileSync(staged)).digest("hex");
				const url = "https://registry.npmjs.org/@yarnpkg/cli-dist/-/cli-dist-4.1.0.tgz";
				const script = scriptedFetch({ [url]: tgzResponse(archive) });
				const installed = yield* install(`yarn@4.1.0+sha512.${cliHash}`).pipe(Effect.provide(live(root, script.fetch)));
				assert.deepStrictEqual(script.calls, [url]);
				assert.strictEqual(installed.source, "tool-cache");

				// …and the TARBALL hash — the right answer for every other manager —
				// must fail: this pair is what discriminates the Berry rule.
				rmSync(cachedOf(installed).directory, { recursive: true, force: true });
				const error = yield* Effect.flip(
					install(`yarn@4.1.0+sha512.${sha512Hex(archive)}`).pipe(Effect.provide(live(root, script.fetch))),
				);
				assert.strictEqual(error.reason, "integrityMismatch");
				rmSync(root, { recursive: true, force: true });
			}),
		);
	});

	describe("bun", () => {
		it.live("maps the runner platform onto bun's release asset, extracts, and sets the executable bit", () =>
			Effect.gen(function* () {
				// RUNNER_ARCH decides the target (F3), so the fixture's name is a
				// LITERAL — deterministic on any host.
				const root = scratch();
				const archive = makeBunZip(root, "bun-linux-x64");
				const url = "https://github.com/oven-sh/bun/releases/download/bun-v1.0.0/bun-linux-x64.zip";
				const script = scriptedFetch({
					[url]: () => new Response(new Uint8Array(readFileSync(archive)), { status: 200 }),
				});
				const installed = cachedOf(
					yield* install("bun@1.0.0").pipe(
						Effect.provide(live(root, script.fetch, { RUNNER_OS: "Linux", RUNNER_ARCH: "X64" })),
					),
				);
				assert.deepStrictEqual(script.calls, [url]);
				// bun's binDir IS the entry directory: the binary is directly
				// executable, so no shim is written for it.
				assert.strictEqual(installed.binDir, installed.directory);
				assert.isFalse(existsSync(join(installed.directory, ".bin")), "bun must get no shim directory");
				const binary = installed.bins.bun ?? "";
				assert.strictEqual(binary, join(installed.directory, "bun"));
				assert.notStrictEqual(statSync(binary).mode & 0o111, 0, "the cached bun binary must be executable");
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("maps macOS and ARM64 onto bun's own spellings", () =>
			Effect.gen(function* () {
				// The 404s are the assertion vehicle: what matters are the urls the
				// mapping produced, recorded by the scripted fetch — exact literals,
				// reachable from any host because RUNNER_ARCH decides (F3).
				const darwinRoot = scratch();
				const darwin = scriptedFetch({});
				yield* Effect.flip(
					install("bun@1.0.0").pipe(
						Effect.provide(live(darwinRoot, darwin.fetch, { RUNNER_OS: "macOS", RUNNER_ARCH: "X64" })),
						Effect.ensuring(Effect.sync(() => rmSync(darwinRoot, { recursive: true, force: true }))),
					),
				);
				assert.deepStrictEqual(darwin.calls, [
					"https://github.com/oven-sh/bun/releases/download/bun-v1.0.0/bun-darwin-x64.zip",
				]);

				const armRoot = scratch();
				const arm = scriptedFetch({});
				yield* Effect.flip(
					install("bun@1.0.0").pipe(
						Effect.provide(live(armRoot, arm.fetch, { RUNNER_OS: "Linux", RUNNER_ARCH: "ARM64" })),
						Effect.ensuring(Effect.sync(() => rmSync(armRoot, { recursive: true, force: true }))),
					),
				);
				assert.deepStrictEqual(arm.calls, [
					"https://github.com/oven-sh/bun/releases/download/bun-v1.0.0/bun-linux-aarch64.zip",
				]);
			}),
		);

		it.live("fails typed on a platform bun does not publish for, without downloading", () =>
			Effect.gen(function* () {
				const root = scratch();
				const script = scriptedFetch({});
				const error = yield* Effect.flip(
					install("bun@1.0.0").pipe(
						Effect.provide(live(root, script.fetch, { RUNNER_OS: "Solaris" })),
						Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
					),
				);
				assert.instanceOf(error, PackageManagerInstallerError);
				assert.strictEqual(error.reason, "unsupportedPlatform");
				assert.include(error.subject ?? "", "Solaris");
				assert.deepStrictEqual(script.calls, [], "an unsupported platform must fail before any download");
			}),
		);
	});

	describe("the error reasons that remain", () => {
		it.live("downloadFailed carries the ToolInstaller failure as cause", () =>
			Effect.gen(function* () {
				const root = scratch();
				const script = scriptedFetch({});
				const error = yield* Effect.flip(
					install("pnpm@2.0.0").pipe(
						Effect.provide(live(root, script.fetch)),
						Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
					),
				);
				assert.strictEqual(error.reason, "downloadFailed");
				assert.instanceOf(error.cause, ToolInstallerError);
			}),
		);

		it.live("extractFailed when the downloaded bytes are not an archive", () =>
			Effect.gen(function* () {
				const root = scratch();
				const script = scriptedFetch({
					"https://registry.npmjs.org/pnpm/-/pnpm-2.0.1.tgz": () => new Response("not a tarball", { status: 200 }),
				});
				const error = yield* Effect.flip(
					install("pnpm@2.0.1").pipe(
						Effect.provide(live(root, script.fetch)),
						Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
					),
				);
				assert.strictEqual(error.reason, "extractFailed");
			}),
		);

		it.live("layoutUnexpected when the tarball has no package/ root", () =>
			Effect.gen(function* () {
				const root = scratch();
				const staging = join(root, "rootless");
				mkdirSync(staging, { recursive: true });
				writeFileSync(join(staging, "loose-file"), "no package dir here");
				const archive = join(root, "rootless.tgz");
				execFileSync("tar", ["czf", archive, "-C", staging, "loose-file"]);
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-2.0.2.tgz": tgzResponse(archive) });
				const error = yield* Effect.flip(install("pnpm@2.0.2").pipe(Effect.provide(live(root, script.fetch))));
				assert.strictEqual(error.reason, "layoutUnexpected");
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("layoutUnexpected when the manifest names no bin", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, { name: "pnpm", version: "2.0.3" });
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-2.0.3.tgz": tgzResponse(archive) });
				const error = yield* Effect.flip(install("pnpm@2.0.3").pipe(Effect.provide(live(root, script.fetch))));
				assert.strictEqual(error.reason, "layoutUnexpected");
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("layoutUnexpected when a declared bin file is missing from the artifact", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "2.0.4",
					bin: { pnpm: "bin/pnpm.cjs" }, // declared, never shipped
				});
				const script = scriptedFetch({ "https://registry.npmjs.org/pnpm/-/pnpm-2.0.4.tgz": tgzResponse(archive) });
				const error = yield* Effect.flip(install("pnpm@2.0.4").pipe(Effect.provide(live(root, script.fetch))));
				assert.strictEqual(error.reason, "layoutUnexpected");
				assert.include(error.subject ?? "", "pnpm");
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("cacheFailed maps the ToolInstaller failure through", () =>
			Effect.gen(function* () {
				const root = scratch();
				const extracted = join(root, "extracted", "package");
				mkdirSync(join(extracted, "bin"), { recursive: true });
				writeFileSync(join(extracted, "package.json"), JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }));
				writeFileSync(join(extracted, "bin", "pnpm.cjs"), "console.log('pnpm')");
				const error = yield* Effect.flip(
					install("pnpm@2.0.5").pipe(
						Effect.provide(
							stubbed({
								installer: {
									find: () => Effect.succeed(Option.none()),
									download: () => Effect.succeed(join(root, "unused-archive")),
									extractTar: () => Effect.succeed(join(root, "extracted")),
									cacheDir: () => Effect.fail(new ToolInstallerError({ reason: "cacheFailed", subject: "pnpm" })),
								},
							}),
						),
					),
				);
				assert.instanceOf(error, PackageManagerInstallerError);
				assert.strictEqual(error.reason, "cacheFailed");
				assert.instanceOf(error.cause, ToolInstallerError);
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("a cache entry that lands away from the derived shim target is a typed cacheFailed", () =>
			Effect.gen(function* () {
				// The divergence guard: the shims name a destination this module
				// derived; if ToolInstaller's swap lands the entry anywhere else the
				// shims point at nothing, and that must be loud, not latent.
				const root = scratch();
				const extracted = join(root, "extracted", "package");
				mkdirSync(join(extracted, "bin"), { recursive: true });
				writeFileSync(join(extracted, "package.json"), JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }));
				writeFileSync(join(extracted, "bin", "pnpm.cjs"), "console.log('pnpm')");
				const error = yield* Effect.flip(
					install("pnpm@2.0.6").pipe(
						Effect.provide(
							stubbed({
								installer: {
									find: () => Effect.succeed(Option.none()),
									download: () => Effect.succeed(join(root, "unused-archive")),
									extractTar: () => Effect.succeed(join(root, "extracted")),
									cacheDir: () => Effect.succeed(join(root, "somewhere-else")),
								},
							}),
						),
					),
				);
				assert.instanceOf(error, PackageManagerInstallerError);
				assert.strictEqual(error.reason, "cacheFailed");
				assert.include(error.subject ?? "", "diverged");
				rmSync(root, { recursive: true, force: true });
			}),
		);
	});

	describe("the registry override", () => {
		it.live("downloads from a mirror instead of registry.npmjs.org", () =>
			Effect.gen(function* () {
				const root = scratch();
				const archive = makeManagerTarball(root, {
					name: "pnpm",
					version: "3.0.0",
					bin: { pnpm: "bin/pnpm.cjs" },
					binFiles: ["bin/pnpm.cjs"],
				});
				const url = "https://mirror.example.test/pnpm/-/pnpm-3.0.0.tgz";
				const script = scriptedFetch({ [url]: tgzResponse(archive) });
				// The trailing slash must not double up in the route.
				const installed = yield* install("pnpm@3.0.0", { registry: "https://mirror.example.test/" }).pipe(
					Effect.provide(live(root, script.fetch)),
					Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
				);
				assert.deepStrictEqual(script.calls, [url]);
				assert.strictEqual(installed.source, "tool-cache");
			}),
		);
	});

	describe("the discriminated union", () => {
		it.effect("both variants round-trip through the union schema (ActionState-persistable)", () =>
			Effect.gen(function* () {
				const cached = CachedPackageManager.make({
					name: "pnpm",
					version: "1.2.3",
					directory: "/cache/pnpm/1.2.3/x64",
					binDir: "/cache/pnpm/1.2.3/x64/.bin",
					bins: { pnpm: "/cache/pnpm/1.2.3/x64/bin/pnpm.cjs" },
				});
				const ambient = AmbientPackageManager.make({ name: "npm", version: "9.9.9", bins: { npm: "npm" } });

				const encode = Schema.encodeUnknownEffect(InstalledPackageManager);
				const decode = Schema.decodeUnknownEffect(InstalledPackageManager);
				const cachedBack = yield* decode(JSON.parse(JSON.stringify(yield* encode(cached))));
				const ambientBack = yield* decode(JSON.parse(JSON.stringify(yield* encode(ambient))));

				assert.instanceOf(cachedBack, CachedPackageManager);
				assert.instanceOf(ambientBack, AmbientPackageManager);
				// The discriminant narrows in the type AND at runtime: the tool-cache
				// variant carries directory + binDir, the ambient one has neither.
				if (cachedBack.source === "tool-cache") {
					assert.strictEqual(cachedBack.binDir, "/cache/pnpm/1.2.3/x64/.bin");
				} else {
					assert.fail("cached record decoded to the wrong variant");
				}
				assert.isFalse("directory" in ambientBack);
			}),
		);
	});

	describe("test double", () => {
		it.effect("an unstubbed member dies rather than reporting an install that did not happen", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(install("npm@1.0.0"));
				assert.strictEqual(exit._tag, "Failure");
			}).pipe(Effect.provide(PackageManagerInstaller.layerTest())),
		);

		it.effect("an override wins", () =>
			Effect.gen(function* () {
				const record = AmbientPackageManager.make({ name: "npm", version: "1.0.0", bins: { npm: "npm" } });
				const installed = yield* install("npm@1.0.0");
				assert.deepStrictEqual(installed, record);
			}).pipe(
				Effect.provide(
					PackageManagerInstaller.layerTest({
						install: () =>
							Effect.succeed(AmbientPackageManager.make({ name: "npm", version: "1.0.0", bins: { npm: "npm" } })),
					}),
				),
			),
		);
	});
});
