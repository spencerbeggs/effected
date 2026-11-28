import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "vitest";

/**
 * The `build` task in `turbo.json` hashes the `effected` tool's own sources, and only those.
 *
 * @remarks
 * Every package's `build` runs `effected package build` from source, and no package depends on `@effected/plugin`,
 * so no `^` edge ties a build to the tool that ran it. The task names the tool's sources as inputs instead: one
 * `$TURBO_ROOT$/packages/<dir>/src/**` entry per package in `@effected/plugin`'s workspace closure, read from the
 * manifests' `dependencies`, `peerDependencies` and `optionalDependencies`. A package's own dependencies already
 * reach its hash through `types:check`'s `^types:check` chain.
 *
 * A glob over every package's source did the same job with no list, and cost every package's build its cache
 * whenever any package's source changed, the 19 the tool never loads included. This test is what keeps the list
 * honest: a new edge into the closure fails it until `turbo.json` names the package, so a tool change can never
 * replay a build made by the old tool. See `okf/gotchas/root-workspace-devdeps-hash.md`.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const EDGE_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

interface Manifest {
	readonly name: string;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/** Every workspace package's directory under `packages/`, by package name. */
const workspacePackages = (): ReadonlyMap<string, { readonly dir: string; readonly manifest: Manifest }> => {
	const packages = new Map<string, { readonly dir: string; readonly manifest: Manifest }>();
	for (const dir of readdirSync(join(ROOT, "packages"))) {
		const path = join(ROOT, "packages", dir, "package.json");
		if (!existsSync(path)) continue;
		const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
		packages.set(manifest.name, { dir, manifest });
	}
	return packages;
};

/** The directories of `root` and every workspace package it reaches through a runtime or peer edge. */
export const toolClosure = (
	packages: ReadonlyMap<string, { readonly dir: string; readonly manifest: Manifest }>,
	root: string,
): ReadonlyArray<string> => {
	const seen = new Set<string>();
	const queue = [root];
	while (queue.length > 0) {
		const name = queue.pop() as string;
		const entry = packages.get(name);
		if (entry === undefined || seen.has(name)) continue;
		seen.add(name);
		for (const field of EDGE_FIELDS) {
			for (const dependency of Object.keys(entry.manifest[field] ?? {})) queue.push(dependency);
		}
	}
	return [...seen].map((name) => packages.get(name)?.dir as string).sort();
};

const SOURCE_INPUT = /^\$TURBO_ROOT\$\/packages\/([^/]+)\/src\/\*\*$/;

/** The package directories whose sources `turbo.json`'s `build` task names. */
const buildSourceInputs = (): ReadonlyArray<string> => {
	const turbo = JSON.parse(readFileSync(join(ROOT, "turbo.json"), "utf8")) as {
		readonly tasks: { readonly build: { readonly inputs: ReadonlyArray<string> } };
	};
	return turbo.tasks.build.inputs.flatMap((input) => {
		const match = SOURCE_INPUT.exec(input);
		return match?.[1] === undefined ? [] : [match[1]];
	});
};

describe("the build task's tool inputs", () => {
	it("follows runtime and peer edges, and no other", () => {
		const packages = new Map([
			["@x/root", { dir: "root", manifest: { name: "@x/root", dependencies: { "@x/a": "workspace:*" } } }],
			["@x/a", { dir: "a", manifest: { name: "@x/a", peerDependencies: { "@x/b": "workspace:^", effect: "4" } } }],
			["@x/b", { dir: "b", manifest: { name: "@x/b", optionalDependencies: { "@x/root": "workspace:*" } } }],
			["@x/dev", { dir: "dev", manifest: { name: "@x/dev" } }],
		]);
		assert.deepStrictEqual(toolClosure(packages, "@x/root"), ["a", "b", "root"]);
	});

	it("names exactly the sources of @effected/plugin's workspace closure", () => {
		const closure = toolClosure(workspacePackages(), "@effected/plugin");
		// A walk that found nothing would match an empty list.
		for (const dir of ["plugin", "cli", "engine", "bundler"]) assert.include(closure, dir);
		const named = buildSourceInputs();
		assert.deepStrictEqual(
			[...named].sort(),
			[...closure],
			"turbo.json's build inputs must name $TURBO_ROOT$/packages/<dir>/src/** for each package the effected tool loads",
		);
		assert.strictEqual(new Set(named).size, named.length, "a package's sources are named twice");
	});

	it("keeps no glob over every package's sources", () => {
		const turbo = readFileSync(join(ROOT, "turbo.json"), "utf8");
		assert.notInclude(turbo, "$TURBO_ROOT$/packages/*/src/**");
	});
});
