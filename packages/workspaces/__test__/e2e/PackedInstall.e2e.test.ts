// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixture file contents
//
// PackedInstall against real package managers and a real fixture workspace.
//
// The unit suite (PackedInstall.test.ts) stops at the pack: the tarball lands
// in a random temp directory that memfs cannot pre-seed. Everything past it —
// a real `npm pack` and `pnpm pack`, reading the packed manifest with the
// host's `tar`, the macOS /var -> /private/var realpath, the installs, the
// bins, and the scratch directory's removal — is proven here.
//
// Hermetic by construction: the fixture has no external dependencies, and
// every install runs with its network routed to a dead proxy and corepack's
// network switched off. A manager that tried to reach the registry (an
// override that missed) or to download itself (a `packageManager` pin that
// did not match the running version) fails instead of quietly succeeding.
//
// Run it through pnpm (`pnpm test` or `pnpm vitest run`): the first test
// asserts the parent manager's context is present, so the scrub is exercised
// against the real variables rather than a hand-written list.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterAll, assert, describe, layer } from "@effect/vitest";
import { Run } from "@effected/commands";
import { Effect, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { PackageManagerName } from "../../src/index.js";
import { Workspaces } from "../../src/index.js";
import type { InstalledConsumer } from "../../src/testing.js";
import { PackedInstall } from "../../src/testing.js";

const CARRIER = "@effected/packed-install-fixture-carrier";
const LIB = "@effected/packed-install-fixture-lib";
const PLUGIN = "@effected/packed-install-fixture-plugin";
const VERSION = "0.0.0-fixture";
const GREETING = "hello from the packed lib";
const BIN_NAME = "fixture-carrier";
const BIN = `#!/usr/bin/env node\nimport { greet } from "${LIB}";\nconsole.log(greet());\n`;
/** The effected bundler's prod npm output, and PackedInstall's default pack source. */
const PROD = "dist/prod/npm/pkg";

// A port nothing listens on. Every manager honours HTTP(S)_PROXY, so a
// registry fetch or a self-download fails fast with ECONNREFUSED.
const DEAD_PROXY = "http://127.0.0.1:9";
const OFFLINE: Readonly<Record<string, string | undefined>> = {
	...process.env,
	HTTPS_PROXY: DEAD_PROXY,
	HTTP_PROXY: DEAD_PROXY,
	https_proxy: DEAD_PROXY,
	http_proxy: DEAD_PROXY,
	NO_PROXY: undefined,
	no_proxy: undefined,
	COREPACK_ENABLE_NETWORK: "0",
};
/** What the bins and the fixture's own spawns run under: the same scrub the installs get. */
const CHILD_ENV = PackedInstall.scrubEnv(OFFLINE);

const write = (root: string, file: string, content: string, mode?: number): void => {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(join(root, file), content, mode === undefined ? undefined : { mode });
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A three-package pnpm workspace. The source manifests carry `workspace:^`;
 * each `dist/prod/npm/pkg` is the publish-ready build with those specifiers
 * resolved, as the bundler writes it. `carrier/dist/raw` is a broken build
 * that still carries `workspace:^`.
 *
 * - lib: exports `greet`.
 * - carrier: a bin that prints lib's greeting (a runtime dependency on lib).
 * - plugin: a peer dependency on lib and no bin — P3's S1 shape, where the
 *   consumer itself imports the peer.
 */
const writeFixture = (): string => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "packed-install-fixture-")));
	write(root, "package.json", json({ name: "packed-install-fixture-root", version: "0.0.0", private: true }));
	write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n");

	const lib = { name: LIB, version: VERSION, type: "module", exports: { ".": "./index.js" }, files: ["index.js"] };
	const greet = `export const greet = () => "${GREETING}";\n`;
	for (const dir of ["packages/lib", `packages/lib/${PROD}`]) {
		write(root, `${dir}/package.json`, json(lib));
		write(root, `${dir}/index.js`, greet);
	}

	const carrier = (dependency: string) => ({
		name: CARRIER,
		version: VERSION,
		type: "module",
		bin: { [BIN_NAME]: "./bin.js" },
		files: ["bin.js"],
		dependencies: { [LIB]: dependency },
	});
	const carriers: ReadonlyArray<readonly [string, string]> = [
		["packages/carrier", "workspace:^"],
		[`packages/carrier/${PROD}`, VERSION],
		["packages/carrier/dist/raw", "workspace:^"],
	];
	for (const [dir, dependency] of carriers) {
		write(root, `${dir}/package.json`, json(carrier(dependency)));
		write(root, `${dir}/bin.js`, BIN, 0o755);
	}

	const plugin = (peer: string) => ({
		name: PLUGIN,
		version: VERSION,
		type: "module",
		exports: { ".": "./index.js" },
		files: ["index.js"],
		peerDependencies: { [LIB]: peer },
	});
	const shout = `import { greet } from "${LIB}";\nexport const shout = () => greet().toUpperCase();\n`;
	for (const [dir, peer] of [
		["packages/plugin", "workspace:^"],
		[`packages/plugin/${PROD}`, VERSION],
	] as const) {
		write(root, `${dir}/package.json`, json(plugin(peer)));
		write(root, `${dir}/index.js`, shout);
	}
	return root;
};

/** The version a manager reports from outside any project, or undefined when it is absent. */
const probe = (pm: string): string | undefined => {
	const out = spawnSync(pm, ["--version"], { cwd: tmpdir(), env: CHILD_ENV, encoding: "utf8" });
	return out.status === 0 ? out.stdout.trim().replace(/^v/, "") : undefined;
};
const VERSIONS: Readonly<Record<PackageManagerName, string | undefined>> = {
	npm: probe("npm"),
	pnpm: probe("pnpm"),
	yarn: probe("yarn"),
	bun: probe("bun"),
};
const HAS_NPM = VERSIONS.npm !== undefined;
const HAS_PNPM = VERSIONS.pnpm !== undefined;
const HAS_YARN = VERSIONS.yarn !== undefined;

const ROOT = writeFixture();
// P3 C8: pnpm packs a `workspace:` specifier only in an INSTALLED workspace.
// No external dependencies, so the install is offline.
const PREINSTALL = HAS_PNPM
	? spawnSync("pnpm", ["install", "--offline", "--config.ignore-scripts=true"], {
			cwd: ROOT,
			env: CHILD_ENV,
			encoding: "utf8",
		})
	: undefined;
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

const spawn = (executable: string, args: ReadonlyArray<string>, cwd?: string) =>
	Run.collect(
		ChildProcess.make(executable, args, {
			...(cwd === undefined ? {} : { cwd }),
			env: CHILD_ENV,
			extendEnv: false,
			stdin: "ignore",
		}),
		{ timeout: "30 seconds" },
	);

const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8"));

/** Every consumer-side fact the install path promises, for one consumer. */
const assertConsumer = (consumer: InstalledConsumer, tarballs: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const scratch = dirname(consumer.directory);
		// The realpath'd scratch: file: specs and the install cwd agree.
		assert.strictEqual(consumer.directory, realpathSync(consumer.directory), consumer.manager);
		if (process.platform === "darwin") assert.match(consumer.directory, /^\/private\//, consumer.manager);
		for (const tarball of Object.values(tarballs)) assert.isTrue(tarball.startsWith(`${scratch}/`), tarball);
		const manifest = readJson(join(consumer.directory, "package.json"));
		assert.deepInclude(manifest, { packageManager: `${consumer.manager}@${VERSIONS[consumer.manager]}` });
		assert.strictEqual(consumer.managerVersion, VERSIONS[consumer.manager]);
		// The same manager, run inside the consumer, does not switch versions.
		const inside = yield* spawn(consumer.manager, ["--version"], consumer.directory);
		assert.strictEqual(inside.stdout.trim().replace(/^v/, ""), consumer.managerVersion, consumer.manager);
		// The bin, run through binPath while the scope is open, reaches the packed lib.
		const out = yield* spawn(consumer.binPath(BIN_NAME), []);
		assert.strictEqual(out.stdout.trim(), GREETING, `${consumer.manager}: ${out.stderr}`);
		assert.strictEqual(out.exitCode, 0, consumer.manager);
	});

describe("PackedInstall against a real fixture workspace", () => {
	layer(Live, { excludeTestServices: true })((it) => {
		it.effect("runs under pnpm, and every manager spawn gets the parent's context scrubbed", () =>
			Effect.sync(() => {
				// Positive control: the real pnpm context is present in this process.
				const leaked = Object.keys(process.env).filter((key) => /^(npm_|pnpm_config_|PNPM_SCRIPT_SRC_DIR$)/i.test(key));
				assert.isAbove(leaked.length, 0, "run this suite through pnpm (pnpm test) so its context is real");
				assert.match(process.env.npm_config_user_agent ?? "", /^pnpm\//);
				assert.deepStrictEqual(
					Object.keys(CHILD_ENV).filter((key) => leaked.includes(key)),
					[],
				);
				assert.strictEqual(CHILD_ENV.HTTPS_PROXY, DEAD_PROXY);
			}),
		);

		it.effect.skipIf(!HAS_NPM)("the dead proxy the installs run behind really blocks the registry", () =>
			Effect.gen(function* () {
				// Without this control, "installed with no network" would be vacuous.
				const out = yield* spawn(
					"npm",
					["view", LIB, "version", "--prefer-online", "--fetch-retries=0"],
					realpathSync(tmpdir()),
				);
				assert.isFalse(out.succeeded);
				assert.include(out.stderr, "ECONNREFUSED");
			}).pipe(Effect.timeout("25 seconds")),
		);

		const prodManagers = (["npm", "pnpm", "bun"] as const).filter((pm) => VERSIONS[pm] !== undefined);
		it.effect.skipIf(!HAS_NPM)(
			"packs dist/prod/npm/pkg by default, installs under every available manager, runs the bin, then removes the scratch directory",
			() =>
				Effect.gen(function* () {
					const seen = yield* Effect.scoped(
						Effect.gen(function* () {
							const result = yield* PackedInstall.run({
								carrier: CARRIER,
								closure: "auto",
								managers: prodManagers,
								require: "all",
								bins: [BIN_NAME],
								env: OFFLINE,
								installTimeout: "90 seconds",
							});
							assert.deepStrictEqual(Object.keys(result.tarballs).sort(), [CARRIER, LIB].sort());
							assert.deepStrictEqual(result.unavailable, []);
							assert.deepStrictEqual(
								result.consumers.map((consumer) => consumer.manager),
								[...prodManagers],
							);
							// The packed manifest, read back with the host tar (bsdtar on macOS).
							const carrierTarball = result.tarballs[CARRIER] ?? "";
							const packed = spawnSync("tar", ["-xzOf", carrierTarball, "package/package.json"], { encoding: "utf8" });
							assert.strictEqual(packed.status, 0, packed.stderr);
							assert.deepStrictEqual(JSON.parse(packed.stdout).dependencies, { [LIB]: VERSION });
							for (const consumer of result.consumers) yield* assertConsumer(consumer, result.tarballs);
							const scratch = dirname(result.consumers[0]?.directory ?? "");
							assert.isTrue(existsSync(scratch), "the scratch directory exists while the scope is open");
							return scratch;
						}),
					);
					assert.isFalse(existsSync(seen), `${seen} survived the scope`);
				}).pipe(Effect.timeout("150 seconds")),
			180_000,
		);

		const sourceManagers = (["npm", "pnpm", "bun"] as const).filter((pm) => VERSIONS[pm] !== undefined);
		it.effect.skipIf(!HAS_PNPM)(
			"packs from source in the installed workspace, rewriting workspace:^, and every available manager's bin runs",
			() =>
				Effect.gen(function* () {
					assert.strictEqual(PREINSTALL?.status, 0, `${PREINSTALL?.stdout}\n${PREINSTALL?.stderr}`);
					const result = yield* PackedInstall.run({
						carrier: CARRIER,
						closure: "auto",
						managers: sourceManagers,
						require: "all",
						packFrom: "source",
						bins: [BIN_NAME],
						env: OFFLINE,
						installTimeout: "90 seconds",
					});
					const packed = spawnSync("tar", ["-xzOf", result.tarballs[CARRIER] ?? "", "package/package.json"], {
						encoding: "utf8",
					});
					assert.strictEqual(packed.status, 0, packed.stderr);
					// pnpm rewrote workspace:^ to the lib's version.
					assert.deepStrictEqual(JSON.parse(packed.stdout).dependencies, { [LIB]: `^${VERSION}` });
					assert.deepStrictEqual(
						result.consumers.map((consumer) => consumer.manager),
						[...sourceManagers],
					);
					for (const consumer of result.consumers) yield* assertConsumer(consumer, result.tarballs);
				}).pipe(Effect.timeout("150 seconds")),
			180_000,
		);

		// The development machine has no yarn, so this skips there. It was run
		// once (2026-09-23) with scratch installs of yarn 1.22.22 and 4.18.0
		// prepended to PATH, and passed under both; a machine with yarn on PATH
		// (a GitHub-hosted runner ships yarn 1) runs it every time.
		it.effect.skipIf(!HAS_YARN)(
			"yarn installs the packed carrier (skipped where yarn is not on PATH)",
			() =>
				Effect.gen(function* () {
					const result = yield* PackedInstall.run({
						carrier: CARRIER,
						closure: "auto",
						managers: ["yarn"],
						require: "all",
						bins: [BIN_NAME],
						env: OFFLINE,
						installTimeout: "90 seconds",
					});
					const [yarn] = result.consumers;
					assert.strictEqual(yarn?.manager, "yarn");
					if (yarn !== undefined) yield* assertConsumer(yarn, result.tarballs);
				}).pipe(Effect.timeout("100 seconds"), Effect.scoped),
			120_000,
		);

		it.effect.skipIf(!HAS_NPM || HAS_YARN)(
			"a requested manager that is not installed lands in unavailable (yarn, on a machine without it)",
			() =>
				Effect.gen(function* () {
					const result = yield* PackedInstall.run({
						carrier: CARRIER,
						closure: "auto",
						managers: ["npm", "yarn"],
						bins: [BIN_NAME],
						env: OFFLINE,
						installTimeout: "90 seconds",
					});
					assert.deepStrictEqual(result.unavailable, ["yarn"]);
					assert.deepStrictEqual(
						result.consumers.map((consumer) => consumer.manager),
						["npm"],
					);
				}).pipe(Effect.timeout("100 seconds"), Effect.scoped),
			120_000,
		);

		/** Import the plugin AND its peer from the consumer ROOT, as the consumer's own code would. */
		const importFromRoot = (consumer: InstalledConsumer) =>
			spawn(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					`import { greet } from "${LIB}"; import { shout } from "${PLUGIN}"; console.log(greet() + "|" + shout());`,
				],
				consumer.directory,
			);

		it.effect.skipIf(!HAS_PNPM)(
			"P3 S1 under pnpm: a peer the consumer imports is declared through consumerDependencies",
			() =>
				Effect.gen(function* () {
					const result = yield* PackedInstall.run({
						carrier: PLUGIN,
						closure: "auto",
						managers: ["pnpm"],
						require: "all",
						bins: [],
						env: OFFLINE,
						consumerDependencies: { [LIB]: VERSION },
						installTimeout: "90 seconds",
					});
					assert.deepStrictEqual(Object.keys(result.tarballs).sort(), [LIB, PLUGIN].sort());
					const [pnpm] = result.consumers;
					assert.strictEqual(pnpm?.manager, "pnpm");
					if (pnpm === undefined) return;
					const out = yield* importFromRoot(pnpm);
					assert.strictEqual(out.stdout.trim(), `${GREETING}|${GREETING.toUpperCase()}`, out.stderr);
				}).pipe(Effect.timeout("100 seconds"), Effect.scoped),
			120_000,
		);

		it.effect.skipIf(!HAS_PNPM)(
			"P3 S1 control: without consumerDependencies pnpm resolves the peer inside the plugin but not at the root",
			() =>
				Effect.gen(function* () {
					const result = yield* PackedInstall.run({
						carrier: PLUGIN,
						closure: "auto",
						managers: ["pnpm"],
						require: "all",
						bins: [],
						env: OFFLINE,
						installTimeout: "90 seconds",
					});
					const [pnpm] = result.consumers;
					assert.strictEqual(pnpm?.manager, "pnpm");
					if (pnpm === undefined) return;
					const out = yield* importFromRoot(pnpm);
					assert.isFalse(out.succeeded);
					assert.include(out.stderr, "ERR_MODULE_NOT_FOUND");
					assert.include(out.stderr, LIB);
				}).pipe(Effect.timeout("100 seconds"), Effect.scoped),
			120_000,
		);

		it.effect.skipIf(!HAS_NPM)(
			"a built directory still carrying workspace: fails UnresolvedProtocol, naming the specifier",
			() =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(
						PackedInstall.run({
							carrier: CARRIER,
							closure: [],
							managers: ["npm"],
							packFrom: { directory: "dist/raw" },
							bins: [],
							env: OFFLINE,
						}),
					);
					assert.strictEqual(error.reason, "UnresolvedProtocol");
					assert.include(error.message, `dependencies.${LIB}: workspace:^`);
				}).pipe(Effect.timeout("60 seconds"), Effect.scoped),
			90_000,
		);

		it.effect.skipIf(!HAS_NPM)(
			"an expected bin the carrier does not ship fails MissingBin",
			() =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(
						PackedInstall.run({
							carrier: CARRIER,
							closure: "auto",
							managers: ["npm"],
							bins: ["not-a-bin"],
							env: OFFLINE,
							installTimeout: "90 seconds",
						}),
					);
					assert.deepStrictEqual([error.reason, error.manager], ["MissingBin", "npm"]);
				}).pipe(Effect.timeout("100 seconds"), Effect.scoped),
			120_000,
		);
	});
});
