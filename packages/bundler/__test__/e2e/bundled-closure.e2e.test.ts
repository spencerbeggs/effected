/**
 * A package that carries a dependency inside its build, end to end through the real tsdown: the inlined package keeps
 * its own version where the build's `define` would write the bundling package's, a string that spells the expression
 * is left alone, the emitted manifest no longer installs what the files already hold, and the inlined package's
 * licence travels with its code.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";
import { THIRD_PARTY_LICENSES } from "../../src/passes/third-party-licenses.js";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/bundled-closure");
const TIMEOUT = 120_000;

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const discovery = WorkspaceDiscovery.layer().pipe(
	Layer.provideMerge(WorkspaceRoot.layer),
	Layer.provideMerge(platform),
);

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const build = (cwd: string) =>
	Effect.gen(function* () {
		const { config } = yield* EffectedConfigFile.load({ cwd });
		return yield* Bundler.build({
			cwd,
			config: config.package.build,
			bundle: config.package.bundle,
			noExe: true,
			verbose: false,
			plugins: [],
			ci: false,
		});
	}).pipe(Effect.provide(discovery));

/** A registry-shaped package under the fixture's `node_modules`, written here because `node_modules` is not committed. */
const writePackage = (cwd: string, name: string, files: Readonly<Record<string, string>>) => {
	const directory = join(cwd, "node_modules", name);
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(join(directory, file, ".."), { recursive: true });
		writeFileSync(join(directory, file), text);
	}
};

const SPELLED = "process.env.__PACKAGE_VERSION__";

describe("a package carrying a dependency inside its build", () => {
	it.effect(
		"stamps the inlined package with its own version, prunes it from dependencies and ships its licence",
		() =>
			Effect.gen(function* () {
				const root = realpathSync(mkdtempSync(join(tmpdir(), "bundler-bundled-closure-")));
				roots.push(root);
				cpSync(FIXTURE, root, { recursive: true });
				const cwd = join(root, "pkg");
				writePackage(cwd, "dep-inlined", {
					"package.json": JSON.stringify({
						name: "dep-inlined",
						version: "9.9.9",
						license: "MIT",
						type: "module",
						exports: { ".": "./index.js", "./deep": "./deep/index.js" },
					}),
					LICENSE: "MIT License\n\nCopyright (c) dep-inlined authors\n",
					// A non-ASCII line before the expression: the replacement works in UTF-16 offsets.
					"index.js": `// héllo — ünïcode\nexport const inlinedVersion = ${SPELLED} ?? "0.0.0";\nexport const inlinedText = "${SPELLED}";\nexport const subpathVersion = globalThis.${SPELLED} ?? "unstamped";\n`,
					"deep/index.js": `export const deep = ${SPELLED} ?? "0.0.0";\n`,
				});
				writePackage(cwd, "dep-external", {
					"package.json": JSON.stringify({
						name: "dep-external",
						version: "1.0.0",
						type: "module",
						exports: "./index.js",
					}),
					"index.js": "export const external = 1;\n",
				});

				const result = yield* build(cwd);
				const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as {
					readonly buildOk: boolean;
					readonly warnings: ReadonlyArray<unknown>;
				};
				assert.isTrue(issues.buildOk, JSON.stringify(issues));
				assert.deepStrictEqual(issues.warnings, []);
				const pkg = join(cwd, "dist", "prod", "npm", "pkg");
				const code = readFileSync(join(pkg, "index.js"), "utf-8");

				// Each module keeps its own package's version; the bundling package's own module keeps the define.
				assert.include(code, 'inlinedVersion = "9.9.9"');
				assert.include(code, 'deep = "9.9.9"');
				assert.include(code, 'ownVersion = "1.0.0"');
				// Control: a string spelling the expression, and a spelling `define` does not match, are left as written.
				assert.include(code, `inlinedText = "${SPELLED}"`);
				assert.include(code, `globalThis.${SPELLED}`);
				// The subpath was inlined too: a bare package name in `bundle` covers its subpaths.
				assert.notInclude(code, 'from "dep-inlined');
				assert.include(code, 'from "dep-external"');

				// The emitted manifest installs only what the files still import; a peer is kept.
				const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as {
					readonly dependencies?: Readonly<Record<string, string>>;
					readonly peerDependencies?: Readonly<Record<string, string>>;
				};
				assert.deepStrictEqual(manifest.dependencies, { "dep-external": "1.0.0" });
				assert.deepStrictEqual(manifest.peerDependencies, { "dep-inlined": "*" });

				// The licence of what was inlined, and only that.
				assert.isTrue(existsSync(join(pkg, THIRD_PARTY_LICENSES)));
				const notices = readFileSync(join(pkg, THIRD_PARTY_LICENSES), "utf-8");
				assert.include(notices, "dep-inlined@9.9.9\nLicense: MIT");
				assert.include(notices, "Copyright (c) dep-inlined authors");
				assert.notInclude(notices, "dep-external");
				assert.notInclude(notices, "@fixture/bundled-closure@");
			}),
		TIMEOUT,
	);
});
