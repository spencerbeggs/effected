import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { PackageManagerPin } from "@effected/npm";
import { Effect, Layer, Logger, Option, PlatformError, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
	ActionEnvironment,
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
	use: (root: string) => Effect.Effect<A, E, PackageManagerInstaller | ToolInstaller>,
	options: { fetch?: typeof globalThis.fetch; env?: Record<string, string> } = {},
) => {
	const root = scratch();
	return use(root).pipe(
		Effect.provide(live(root, options.fetch ?? alwaysFails, options.env ?? {})),
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
		writeFileSync(join(packageDir, file), `#!/usr/bin/env node\nconsole.log("${options.name}");\n`);
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

/** The bun arch component for this host, in bun's own spelling. */
const bunArch = process.arch === "arm64" ? "aarch64" : "x64";

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

const install = (spec: string, options?: { requireIntegrity?: boolean; registry?: string }) =>
	Effect.flatMap(PackageManagerInstaller, (installer) => installer.install(pin(spec), options));

describe("PackageManagerInstaller", () => {
	describe("the tool-cache short-circuit", () => {
		it.live("answers from the cache without downloading anything", () =>
			withRoot((root) =>
				Effect.gen(function* () {
					// The fetch always fails, so a hit here proves no download happened.
					const cached = ToolInstaller.cachePath({ root, tool: "pnpm", version: "7.7.7", arch: process.arch });
					mkdirSync(join(cached, "bin"), { recursive: true });
					writeFileSync(join(cached, "package.json"), JSON.stringify({ bin: { pnpm: "bin/pnpm.cjs" } }));
					writeFileSync(join(cached, "bin", "pnpm.cjs"), "console.log('pnpm')");

					const installed = yield* install("pnpm@7.7.7");
					assert.instanceOf(installed, InstalledPackageManager);
					assert.strictEqual(installed.source, "tool-cache");
					assert.strictEqual(installed.directory, cached);
					assert.deepStrictEqual(installed.bins, { pnpm: join(cached, "bin", "pnpm.cjs") });
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
	});

	describe("the ambient npm short-circuit", () => {
		it.effect("answers ambient when the probe matches the pin exactly", () =>
			Effect.gen(function* () {
				const installed = yield* install("npm@9.9.9");
				assert.strictEqual(installed.source, "ambient");
				assert.strictEqual(installed.version, "9.9.9");
				assert.isUndefined(installed.directory);
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
				const installed = yield* install("npm@1.0.0").pipe(
					Effect.provide(live(root, script.fetch)),
					Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
				);
				assert.strictEqual(installed.source, "tool-cache");
				assert.deepStrictEqual(script.calls, ["https://registry.npmjs.org/npm/-/npm-1.0.0.tgz"]);
				assert.strictEqual(installed.bins.npm, join(installed.directory ?? "", "bin", "npm-cli.js"));
			}),
		);

		it.live("a failed probe is not an error — it falls through to the dist path", () =>
			Effect.gen(function* () {
				const root = scratch();
				const extracted = join(root, "extracted", "package");
				mkdirSync(join(extracted, "bin"), { recursive: true });
				writeFileSync(join(extracted, "package.json"), JSON.stringify({ bin: { npm: "bin/npm-cli.js" } }));
				writeFileSync(join(extracted, "bin", "npm-cli.js"), "console.log('npm')");

				const installed = yield* install("npm@1.2.3").pipe(
					Effect.provide(
						stubbed({
							spawner: scriptedSpawner(() =>
								Effect.fail(
									PlatformError.badArgument({ module: "Test", method: "string", description: "npm is not installed" }),
								),
							),
							installer: {
								find: () => Effect.succeed(Option.none()),
								download: () => Effect.succeed(join(root, "unused-archive")),
								extractTar: () => Effect.succeed(join(root, "extracted")),
								cacheDir: () => Effect.succeed(join(root, "cached")),
							},
						}),
					),
					Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
				);
				assert.strictEqual(installed.source, "tool-cache");
				assert.strictEqual(installed.bins.npm, join(root, "cached", "bin", "npm-cli.js"));
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
				const installed = yield* install("yarn@1.22.10").pipe(
					Effect.provide(live(root, script.fetch)),
					Effect.ensuring(Effect.sync(() => rmSync(root, { recursive: true, force: true }))),
				);
				assert.deepStrictEqual(script.calls, ["https://registry.npmjs.org/yarn/-/yarn-1.22.10.tgz"]);
				assert.strictEqual(installed.bins.yarn, join(installed.directory ?? "", "bin", "yarn.js"));
				assert.strictEqual(installed.bins.yarnpkg, join(installed.directory ?? "", "bin", "yarn.js"));
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
				rmSync(join(installed.directory ?? ""), { recursive: true, force: true });
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
				const root = scratch();
				const target = `bun-linux-${bunArch}`;
				const archive = makeBunZip(root, target);
				const url = `https://github.com/oven-sh/bun/releases/download/bun-v1.0.0/${target}.zip`;
				const script = scriptedFetch({
					[url]: () => new Response(new Uint8Array(readFileSync(archive)), { status: 200 }),
				});
				const installed = yield* install("bun@1.0.0").pipe(
					Effect.provide(live(root, script.fetch, { RUNNER_OS: "Linux" })),
				);
				assert.deepStrictEqual(script.calls, [url]);
				assert.strictEqual(installed.source, "tool-cache");
				const binary = installed.bins.bun ?? "";
				assert.strictEqual(binary, join(installed.directory ?? "", "bun"));
				assert.notStrictEqual(statSync(binary).mode & 0o111, 0, "the cached bun binary must be executable");
				rmSync(root, { recursive: true, force: true });
			}),
		);

		it.live("maps macOS onto bun's darwin spelling", () =>
			Effect.gen(function* () {
				// The 404 is the assertion vehicle: what matters is the url the
				// mapping produced, recorded by the scripted fetch.
				const script = scriptedFetch({});
				const error = yield* Effect.flip(
					install("bun@1.0.0").pipe(Effect.provide(live(scratch(), script.fetch, { RUNNER_OS: "macOS" }))),
				);
				assert.strictEqual(error.reason, "downloadFailed");
				assert.deepStrictEqual(script.calls, [
					`https://github.com/oven-sh/bun/releases/download/bun-v1.0.0/bun-darwin-${bunArch}.zip`,
				]);
			}),
		);

		it.live("fails typed on a platform bun does not publish for, without downloading", () =>
			Effect.gen(function* () {
				const script = scriptedFetch({});
				const error = yield* Effect.flip(
					install("bun@1.0.0").pipe(Effect.provide(live(scratch(), script.fetch, { RUNNER_OS: "Solaris" }))),
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
				const script = scriptedFetch({});
				const error = yield* Effect.flip(install("pnpm@2.0.0").pipe(Effect.provide(live(scratch(), script.fetch))));
				assert.strictEqual(error.reason, "downloadFailed");
				assert.instanceOf(error.cause, ToolInstallerError);
			}),
		);

		it.live("extractFailed when the downloaded bytes are not an archive", () =>
			Effect.gen(function* () {
				const script = scriptedFetch({
					"https://registry.npmjs.org/pnpm/-/pnpm-2.0.1.tgz": () => new Response("not a tarball", { status: 200 }),
				});
				const error = yield* Effect.flip(install("pnpm@2.0.1").pipe(Effect.provide(live(scratch(), script.fetch))));
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

	describe("test double", () => {
		it.effect("an unstubbed member dies rather than reporting an install that did not happen", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(install("npm@1.0.0"));
				assert.strictEqual(exit._tag, "Failure");
			}).pipe(Effect.provide(PackageManagerInstaller.layerTest())),
		);

		it.effect("an override wins", () =>
			Effect.gen(function* () {
				const record = InstalledPackageManager.make({
					name: "npm",
					version: "1.0.0",
					source: "ambient",
					bins: { npm: "npm" },
				});
				const installed = yield* install("npm@1.0.0");
				assert.deepStrictEqual(installed, record);
			}).pipe(
				Effect.provide(
					PackageManagerInstaller.layerTest({
						install: () =>
							Effect.succeed(
								InstalledPackageManager.make({
									name: "npm",
									version: "1.0.0",
									source: "ambient",
									bins: { npm: "npm" },
								}),
							),
					}),
				),
			),
		);
	});
});
