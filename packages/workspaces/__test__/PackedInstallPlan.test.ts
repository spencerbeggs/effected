import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { WorkspacePackage } from "../src/index.js";
import {
	closureOf,
	consumerFiles,
	installArgs,
	scrubEnv,
	unresolvedSpecifiers,
	versionOf,
} from "../src/internal/packedInstallPlan.js";

const pkg = (name: string, fields: Record<string, Record<string, string>> = {}): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		version: "1.0.0",
		path: `/repo/packages/${name.replace("@x/", "")}`,
		packageJsonPath: `/repo/packages/${name.replace("@x/", "")}/package.json`,
		relativePath: `packages/${name.replace("@x/", "")}`,
		workspaceRoot: "/repo",
		...fields,
	});
const PACKAGES = [
	pkg("@x/carrier", {
		dependencies: { "@x/lib": "workspace:^" },
		peerDependencies: { "@x/peer": "workspace:^" },
		devDependencies: { "@x/tool": "workspace:*" },
	}),
	// lib -> deep is transitive-only, deep -> lib closes a cycle, lib -> devonly is dev-only.
	pkg("@x/lib", { dependencies: { "@x/deep": "workspace:^" }, devDependencies: { "@x/devonly": "workspace:*" } }),
	pkg("@x/peer"),
	pkg("@x/tool"),
	pkg("@x/deep", { peerDependencies: { "@x/lib": "workspace:^" } }),
	pkg("@x/devonly"),
];
const INPUT = {
	version: "0.0.0",
	carrier: { name: "@x/carrier", tarball: "/t/carrier.tgz" },
	overrides: { "@x/lib": "/t/lib.tgz" },
	dependencies: { effect: "4.0.0-rc.117" },
};
const fileMap = (files: ReadonlyArray<{ readonly file: string; readonly content: string }>) =>
	Object.fromEntries(files.map(({ file, content }) => [file, content]));

describe("scrubEnv", () => {
	it("drops the parent package manager's context and undefined values, keeps the rest", () => {
		assert.deepStrictEqual(
			scrubEnv({
				PATH: "/usr/bin",
				HOME: "/home/u",
				CI: "true",
				INIT_CWD: "/repo",
				NODE_V8_COVERAGE: "/cov",
				npm_config_user_agent: "pnpm/12",
				NPM_CONFIG_REGISTRY: "https://x",
				pnpm_config_verify_deps_before_run: "false",
				PNPM_SCRIPT_SRC_DIR: "/repo/packages/x",
				PNPM_PACKAGE_NAME: "@x/carrier",
				YARN_NODE_LINKER: "pnp",
				yarn_enable_immutable_installs: "true",
				PNPM_HOME: "/home/u/.pnpm",
				EMPTY: undefined,
			}),
			{ PATH: "/usr/bin", HOME: "/home/u", PNPM_HOME: "/home/u/.pnpm" },
		);
	});
});

describe("versionOf", () => {
	it("takes the last version-shaped line of --version output", () => {
		assert.strictEqual(versionOf("11.19.1\n"), "11.19.1");
		assert.strictEqual(versionOf("v1.4.2"), "1.4.2");
		assert.strictEqual(versionOf("WARN this project pins pnpm@12.6.0\n12.5.1\n"), "12.5.1");
		assert.strictEqual(versionOf("4.5.0-rc.1\n"), "4.5.0-rc.1");
		assert.isUndefined(versionOf(""));
		assert.isUndefined(versionOf("command not found"));
	});
});

describe("closureOf", () => {
	it("auto walks runtime edges transitively from the carrier, carrier first, through cycles, never devDependencies", () => {
		const closure = closureOf(PACKAGES, "@x/carrier", "auto");
		assert.isTrue(Result.isSuccess(closure));
		if (Result.isSuccess(closure)) {
			assert.deepStrictEqual(
				closure.success.map((p) => p.name),
				["@x/carrier", "@x/lib", "@x/peer", "@x/deep"],
			);
		}
	});

	it("an explicit list is taken as given, carrier first, and an unknown name fails", () => {
		const explicit = closureOf(PACKAGES, "@x/carrier", ["@x/lib", "@x/carrier"]);
		assert.deepStrictEqual(Result.isSuccess(explicit) ? explicit.success.map((p) => p.name) : [], [
			"@x/carrier",
			"@x/lib",
		]);
		assert.deepStrictEqual(closureOf(PACKAGES, "@x/nope", "auto"), Result.fail("@x/nope"));
		assert.deepStrictEqual(closureOf(PACKAGES, "@x/carrier", ["@x/ghost"]), Result.fail("@x/ghost"));
	});
});

describe("consumerFiles", () => {
	it("npm: overrides in the manifest, the carrier a dependency (never dev, never an override), the probed version pinned", () => {
		const files = fileMap(consumerFiles({ ...INPUT, manager: "npm", version: "11.19.1" }));
		assert.deepStrictEqual(Object.keys(files), ["package.json"]);
		const manifest = JSON.parse(files["package.json"] ?? "{}") as Record<string, unknown>;
		assert.strictEqual(manifest.packageManager, "npm@11.19.1");
		assert.deepStrictEqual(manifest.dependencies, { "@x/carrier": "file:/t/carrier.tgz", effect: "4.0.0-rc.117" });
		assert.isUndefined(manifest.devDependencies, "omit=dev or NODE_ENV=production would skip a devDependency");
		assert.deepStrictEqual(manifest.overrides, { "@x/lib": "file:/t/lib.tgz" });
		assert.isUndefined(manifest.resolutions);
	});

	it("pnpm: overrides only in a settings-only pnpm-workspace.yaml", () => {
		const files = fileMap(consumerFiles({ ...INPUT, manager: "pnpm", version: "12.5.1" }));
		const manifest = JSON.parse(files["package.json"] ?? "{}") as Record<string, unknown>;
		assert.isUndefined(manifest.overrides);
		assert.strictEqual(files["pnpm-workspace.yaml"], 'overrides:\n  "@x/lib": "file:/t/lib.tgz"\n');
		const empty = fileMap(consumerFiles({ ...INPUT, overrides: {}, manager: "pnpm", version: "12.5.1" }));
		assert.strictEqual(empty["pnpm-workspace.yaml"], "overrides: {}\n");
	});

	it("yarn: resolutions, plus the node-modules linker for Berry only", () => {
		const berry = fileMap(consumerFiles({ ...INPUT, manager: "yarn", version: "4.5.0" }));
		assert.deepStrictEqual((JSON.parse(berry["package.json"] ?? "{}") as Record<string, unknown>).resolutions, {
			"@x/lib": "file:/t/lib.tgz",
		});
		assert.strictEqual(
			berry[".yarnrc.yml"],
			"nodeLinker: node-modules\nenableImmutableInstalls: false\nenableScripts: false\nenableTelemetry: false\n",
		);
		assert.isUndefined(fileMap(consumerFiles({ ...INPUT, manager: "yarn", version: "1.22.22" }))[".yarnrc.yml"]);
	});

	it("a consumer dependency naming a packed package is written as that package's tarball, for every manager", () => {
		// npm refuses an override that differs from a direct spec (EOVERRIDE); the same file: spec in both is accepted.
		for (const [manager, version] of [
			["npm", "11.19.1"],
			["pnpm", "12.5.1"],
			["yarn", "4.5.0"],
			["bun", "1.4.2"],
		] as const) {
			const files = fileMap(
				consumerFiles({
					...INPUT,
					manager,
					version,
					dependencies: { "@x/lib": "^1.0.0", "@x/carrier": "1.0.0", effect: "4.0.0-rc.117" },
				}),
			);
			const manifest = JSON.parse(files["package.json"] ?? "{}") as Record<string, unknown>;
			assert.deepStrictEqual(
				manifest.dependencies,
				{ "@x/carrier": "file:/t/carrier.tgz", "@x/lib": "file:/t/lib.tgz", effect: "4.0.0-rc.117" },
				manager,
			);
		}
	});

	it("bun: overrides in the manifest", () => {
		const files = fileMap(consumerFiles({ ...INPUT, manager: "bun", version: "1.4.2" }));
		assert.deepStrictEqual((JSON.parse(files["package.json"] ?? "{}") as Record<string, unknown>).overrides, {
			"@x/lib": "file:/t/lib.tgz",
		});
	});
});

describe("installArgs", () => {
	it("skips lifecycle scripts the way each manager spells it", () => {
		assert.deepStrictEqual(installArgs("npm", "11.19.1"), ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
		assert.deepStrictEqual(installArgs("pnpm", "12.5.1"), ["install", "--config.ignore-scripts=true"]);
		assert.deepStrictEqual(installArgs("yarn", "4.5.0"), ["install"]);
		assert.deepStrictEqual(installArgs("yarn", "1.22.22"), ["install", "--ignore-scripts", "--non-interactive"]);
		assert.deepStrictEqual(installArgs("bun", "1.4.2"), ["install", "--ignore-scripts"]);
	});
});

describe("unresolvedSpecifiers", () => {
	it("lists workspace: and catalog: specifiers in runtime maps only", () => {
		const manifest = JSON.stringify({
			dependencies: { "@x/lib": "workspace:^", ajv: "^8.0.0" },
			peerDependencies: { effect: "catalog:effect:peers" },
			devDependencies: { "@x/tool": "workspace:*" },
		});
		assert.deepStrictEqual(
			unresolvedSpecifiers(manifest),
			Result.succeed(["dependencies.@x/lib: workspace:^", "peerDependencies.effect: catalog:effect:peers"]),
		);
		assert.isTrue(Result.isFailure(unresolvedSpecifiers("{ nope")));
	});
});
