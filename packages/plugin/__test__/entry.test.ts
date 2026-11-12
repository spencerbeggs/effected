// A config file imports this package's root to reach `defineSchemastore`, so the root must stay cheap. `vi.mock` cannot
// show that, because it cannot intercept a dependency vitest externalizes, so the built entry runs in a child process
// under a preload that records every module the process resolves. The root `globalSetup` rebuilds `dist/prod` before
// every run, so the entry is this tree's.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { defineConfig } from "@effected/schemastore";
import { defineSchemastore } from "../src/index.js";

const PLUGIN = resolve(import.meta.dirname, "..");
const PKG = join(PLUGIN, "dist/prod/npm/pkg");
const ENTRY = join(PKG, "index.js");
const HOOK = join(PLUGIN, "__test__/fixtures/record-resolved.mjs");
const CONTROL = join(PLUGIN, "__test__/fixtures/load-front-end.mjs");
const BUILD_CONTROL = join(PLUGIN, "__test__/fixtures/load-build-engine.mjs");

const scratch = mkdtempSync(join(tmpdir(), "effected-plugin-entry-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const record = (name: string, script: string) => {
	const log = join(scratch, `${name}.log`);
	writeFileSync(log, "");
	const child = spawnSync(process.execPath, ["--import", HOOK, script], {
		cwd: PLUGIN,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "", RESOLVED_LOG: log },
		timeout: 60_000,
	});
	assert.strictEqual(child.status, 0, child.stderr);
	return readFileSync(log, "utf8").split("\n").filter(Boolean);
};

const EXPENSIVE =
	/\/packages\/(?:cli|mcp|engine|bundler)\/|\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:ajv|ajv-formats|ink|react|jiti|tsdown|rolldown|typescript)\//;
const expensive = (modules: ReadonlyArray<string>) => modules.filter((url) => EXPENSIVE.test(url));

// The manifest's own text, because a built manifest has already rewritten the protocol.
const dependencies = (pkg: string): Readonly<Record<string, string>> =>
	(
		JSON.parse(readFileSync(resolve(PLUGIN, "..", pkg, "package.json"), "utf8")) as {
			readonly dependencies: Readonly<Record<string, string>>;
		}
	).dependencies;

describe("@effected/plugin's root entry", () => {
	it("defineSchemastore is schemastore's defineConfig", () => {
		assert.strictEqual(defineSchemastore, defineConfig);
	});

	it("control: the recorder sees the front ends when something does load them", () => {
		const hits = expensive(record("control", CONTROL));
		for (const expected of ["/packages/cli/", "/packages/mcp/", "/packages/engine/"]) {
			assert.isTrue(
				hits.some((url) => url.includes(expected)),
				expected,
			);
		}
	});

	it("control: the recorder sees the bundler and its toolchain when something does load them", () => {
		const hits = expensive(record("build-control", BUILD_CONTROL));
		// Workspace links resolve to source, so the bundler is `packages/bundler/src/`; it builds on rolldown and TypeScript.
		for (const expected of ["/packages/bundler/src/", "/tsdown/", "/rolldown/", "/typescript/"]) {
			assert.isTrue(
				hits.some((url) => url.includes(expected)),
				expected,
			);
		}
	});

	// The built package carries the tool inside it, so the module recorder sees only its own files: what the root costs is
	// which of them it loads. Each marker is text only the named part's code holds.
	const MARKERS = {
		"the CLI": "CLI_VERSION",
		"the MCP server": "MCP_VERSION",
		"the engine": '"VersionMismatchError"',
		"the bundler": "effected:stamp-versions",
		ajv: "ajv/dist/runtime",
		jiti: 'from "jiti"',
		Ink: 'from "ink"',
		tsdown: 'import("tsdown")',
	} as const;
	const builtFiles = (dir: string): ReadonlyArray<string> =>
		readdirSync(dir, { recursive: true, encoding: "utf8" })
			.filter((file) => file.endsWith(".js"))
			.map((file) => join(dir, file));
	const markersIn = (files: ReadonlyArray<string>) => {
		const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
		return Object.entries(MARKERS)
			.filter(([, marker]) => text.includes(marker))
			.map(([name]) => name);
	};

	it("control: every marker is in the built package, so its absence from the root means something", () => {
		assert.deepStrictEqual(markersIn(builtFiles(PKG)), Object.keys(MARKERS));
	});

	it("the built root resolves nothing outside its own files, and loads no front end, engine, bundler, ajv, jiti or Ink", () => {
		const modules = record("root", ENTRY);
		const loaded = modules.filter((url) => url.startsWith("file:")).map((url) => fileURLToPath(url));
		// The recorder's own tsx resolves its lexer lazily; it is the probe, not the entry.
		const foreign = modules.filter(
			(url) => !url.startsWith("node:") && !url.includes("/tsx/") && !fileURLToPath(url).startsWith(`${PKG}/`),
		);
		assert.deepStrictEqual(foreign, [], "the root imports no installed package");
		assert.isTrue(
			loaded.some((file) => readFileSync(file, "utf8").includes("@effected/schemastore/version")),
			"the root reached schemastore's stamp, so the walk saw the re-export",
		);
		assert.deepStrictEqual(markersIn(loaded), []);
	});

	it("the built root is schemastore at its own version, so a config from it passes the version check", () => {
		const { version } = JSON.parse(readFileSync(resolve(PLUGIN, "..", "schemastore", "package.json"), "utf8")) as {
			readonly version: string;
		};
		// The schema comes from the workspace's own effect, a copy apart from the one inside the package, as a consumer's does.
		const script = `import { SchemastoreVersion, defineSchemastore, HostedSchema } from ${JSON.stringify(pathToFileURL(ENTRY).href)};
import { Schema } from ${JSON.stringify(import.meta.resolve("effect"))};
const hosted = HostedSchema.github({ repo: "o/r", name: "x", versions: ["1.0"] });
const config = defineSchemastore({ name: "x", outputDir: "out", schemas: { x: { schema: Schema.Struct({ a: Schema.String }), hosted } } });
console.log(JSON.stringify([SchemastoreVersion.current, SchemastoreVersion.of(hosted), SchemastoreVersion.of(config)]));`;
		const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
			cwd: scratch,
			encoding: "utf8",
			env: { PATH: process.env.PATH ?? "" },
			timeout: 60_000,
		});
		assert.strictEqual(child.status, 0, child.stderr);
		const [current, hosted, config] = JSON.parse(child.stdout) as [string, { value?: string }, { value?: string }];
		assert.strictEqual(current, version);
		assert.strictEqual(hosted.value, version);
		assert.strictEqual(config.value, version);
	});

	it("the emitted manifest installs only what the files still import, and peers effect for the root's types", () => {
		const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
			readonly dependencies: Readonly<Record<string, string>>;
			readonly peerDependencies: Readonly<Record<string, string>>;
			readonly peerDependenciesMeta: Readonly<Record<string, { readonly optional?: boolean }>>;
		};
		assert.sameMembers(Object.keys(manifest.dependencies), [
			"@microsoft/api-extractor",
			"@microsoft/tsdoc",
			"@microsoft/tsdoc-config",
			"@tsdown/exe",
			"ink",
			"jiti",
			"react",
			"rolldown",
			"rolldown-plugin-dts",
			"tsdown",
		]);
		assert.sameMembers(Object.keys(manifest.peerDependencies), [
			"@resvg/resvg-js",
			"@types/node",
			"effect",
			"satori",
			"typescript",
		]);
		for (const optional of ["@resvg/resvg-js", "effect", "satori"]) {
			assert.isTrue(manifest.peerDependenciesMeta[optional]?.optional, optional);
		}
		// The declarations import effect, which the peer resolves; schemastore's are inlined.
		const declarations = readFileSync(join(PKG, "index.d.ts"), "utf8");
		const imported = [...declarations.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
		assert.deepStrictEqual(imported, ["effect"]);
	});

	it("the notices of what the build inlined ship with it", () => {
		const notices = readFileSync(join(PKG, "THIRD_PARTY_LICENSES.txt"), "utf8");
		for (const name of ["effect", "@effected/schemastore", "@effected/cli", "@effected/bundler", "ajv"]) {
			assert.match(notices, new RegExp(`^${name.replace("/", "\\/")}@\\d`, "m"), name);
		}
	});

	// The beta the kit builds on, the RC, and every stable 7.x; a `-dev` nightly matches none of the three.
	it("the five packages that peer typescript agree on one literal range", () => {
		for (const pkg of ["bundler", "engine", "cli", "mcp", "plugin"]) {
			const { peerDependencies } = JSON.parse(readFileSync(resolve(PLUGIN, "..", pkg, "package.json"), "utf8")) as {
				readonly peerDependencies: Readonly<Record<string, string>>;
			};
			assert.strictEqual(peerDependencies.typescript, "7.1.0-beta || 7.1.1-rc || >=7.1.0 <8", pkg);
		}
	});

	it("every link in the chain is workspace:*", () => {
		const chain = [
			["plugin", "@effected/cli"],
			["plugin", "@effected/mcp"],
			["plugin", "@effected/schemastore"],
			["cli", "@effected/engine"],
			["mcp", "@effected/engine"],
			["engine", "@effected/schemastore"],
			["engine", "@effected/bundler"],
			["bundler", "@effected/changesets"],
			["schemastore", "@effected/semver"],
		] as const;
		for (const [from, to] of chain) {
			assert.strictEqual(dependencies(from)[to], "workspace:*", `${from} -> ${to}`);
		}
	});

	// The tool owns its closure: a kit patch floating in under a carrier version changes what the
	// tool does with no release of the tool to show for it (effected#1333). Pinning every kit edge
	// of the tool's own packages also pins each library's kit peers, which resolve from here.
	it("every kit dependency of the tool's packages is workspace:*", () => {
		for (const pkg of ["plugin", "cli", "mcp", "engine", "bundler"]) {
			const kit = Object.entries(dependencies(pkg)).filter(([name]) => name.startsWith("@effected/"));
			assert.isNotEmpty(kit, `${pkg} has kit dependencies, so the check is not vacuous`);
			for (const [name, specifier] of kit) {
				assert.strictEqual(specifier, "workspace:*", `${pkg} -> ${name}`);
			}
		}
	});
});
