import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The dev build: the test pre-build refreshes it, and its module graph and declarations are the ones prod ships. */
const BUILT = join(PACKAGE, "dist", "dev", "pkg");
/** The prod build, when a prod build has run: the graph a consumer installs, so a prod-only chunk cannot leak an engine. */
const PROD = join(PACKAGE, "dist", "prod", "npm", "pkg");
/** Every built package root to walk: dev always, prod when present. */
const BUILDS: ReadonlyArray<string> = existsSync(join(PROD, "index.js")) ? [BUILT, PROD] : [BUILT];
const TSC = join(PACKAGE, "node_modules", ".bin", "tsc");

/** The three format engines, each an optional peer reachable from its own subpath only. */
const ENGINES = ["@effected/jsonc", "@effected/toml", "@effected/yaml"] as const;

/** Each codec subpath, its built entry, the codec it exports and the one engine it may load. */
const SUBPATHS = [
	{ subpath: "./jsonc", entry: "jsonc", codec: "JsoncCodec", engine: "@effected/jsonc" },
	{ subpath: "./toml", entry: "toml", codec: "TomlCodec", engine: "@effected/toml" },
	{ subpath: "./yaml", entry: "yaml", codec: "YamlCodec", engine: "@effected/yaml" },
] as const;

/** Reads a module's text; the real graph reads the disk, the mutation control reads a map. */
type Read = (file: string) => string;
const readDisk: Read = (file) => readFileSync(file, "utf8");

/** Block and line comments removed, so a TSDoc example's `import … from "…"` is not an edge. */
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every specifier a module loads: static imports, re-exports, side-effect imports and `import("<literal>")`. */
const specifiersOf = (text: string): ReadonlyArray<string> =>
	[...stripComments(text).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\1/g)].map(
		(match) => match[2] ?? "",
	);

/** The bare (package) specifiers every module reachable from `entry` loads, transitively, sorted. */
const packagesReachedFrom = (entry: string, read: Read = readDisk): ReadonlyArray<string> => {
	const seen = new Set<string>();
	const packages = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of specifiersOf(read(file))) {
			if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier));
			else packages.add(specifier);
		}
	}
	return [...packages].sort();
};

/** The `@effected/*` packages among `packages`: `effect` and its subpaths are always allowed. */
const kitPackages = (packages: ReadonlyArray<string>): ReadonlyArray<string> =>
	packages.filter((name) => name.startsWith("@effected/"));

describe("the built module graph", () => {
	it("keeps the root entry off every format engine: it reaches @effected/walker and effect only", () => {
		for (const build of BUILDS) {
			const reached = packagesReachedFrom(join(build, "index.js"));
			assert.include(reached, "effect", `the control: the root graph was walked (${build})`);
			assert.deepStrictEqual(kitPackages(reached), ["@effected/walker"], build);
			for (const engine of ENGINES) assert.notInclude(reached, engine, `${engine} (${build})`);
		}
	});

	it("lets each codec subpath reach its own engine and no other", () => {
		for (const build of BUILDS) {
			for (const { entry, engine } of SUBPATHS) {
				const reached = packagesReachedFrom(join(build, `${entry}.js`));
				assert.deepStrictEqual(kitPackages(reached), [engine], `${entry} (${build})`);
			}
		}
	});

	it("mutation control: an engine reached transitively, through a lazy import, is found; one in a comment is not", () => {
		const files: Record<string, string> = {
			"/pkg/index.js": '/** import { Yaml } from "@effected/yaml" */\nexport { A } from "./a.js";\nimport "effect";',
			"/pkg/a.js": 'export const A = () => import("./b.js");',
			"/pkg/b.js": 'import { Toml } from "@effected/toml";\nexport const B = Toml;',
		};
		const read: Read = (file) => files[file] ?? "";
		assert.deepStrictEqual(packagesReachedFrom("/pkg/index.js", read), ["@effected/toml", "effect"]);
	});
});

describe("the published manifest", () => {
	const manifest = JSON.parse(readFileSync(join(BUILT, "package.json"), "utf8")) as {
		readonly exports?: Record<string, unknown>;
		readonly peerDependencies?: Record<string, string>;
		readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
	};

	it("exports one subpath per non-JSON codec", () => {
		for (const { subpath } of SUBPATHS) assert.property(manifest.exports, subpath, subpath);
	});

	it("marks the three engines optional and keeps the peers the root reaches required", () => {
		for (const engine of ENGINES) {
			assert.property(manifest.peerDependencies, engine, `${engine} is still a peer`);
			assert.isTrue(manifest.peerDependenciesMeta?.[engine]?.optional === true, `${engine} is optional`);
		}
		// The root's resolvers reach @effected/walker, and walker peers on @effected/glob: both stay required.
		for (const required of ["@effected/walker", "@effected/glob", "effect"]) {
			assert.property(manifest.peerDependencies, required, required);
			assert.isUndefined(manifest.peerDependenciesMeta?.[required], `${required} is required`);
		}
	});
});

/** A top-level declaration in a rolled-up `.d.ts`: whether the line exports it, and its name. */
const TOP_LEVEL_DECLARATION =
	/^(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|let|var|function|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;

describe("the built codec declarations", () => {
	it("export exactly their codec, tagged @public, typed through the root rather than a copy", () => {
		for (const { entry, codec } of SUBPATHS) {
			const dts = readFileSync(join(BUILT, `${entry}.d.ts`), "utf8");
			const declarations = [...dts.matchAll(TOP_LEVEL_DECLARATION)];
			// Every top-level declaration is the exported codec: an unexported one is what the scoped
			// ae-forgotten-export suppression in savvy.build.ts would otherwise hide.
			assert.deepStrictEqual(
				declarations.map((match) => [match[1] !== undefined, match[2]]),
				[[true, codec]],
				entry,
			);
			assert.include(dts, 'import { ConfigCodec } from "@effected/config-file";', `${entry} names the root's type`);
			assert.match(dts, new RegExp(`@public\\s*\\*/\\s*export declare const ${codec}:`), `${entry} is tagged`);
		}
	});

	it("type-check in a consumer, with each codec a real ConfigCodec rather than an unresolved any", () => {
		const consumer = `import { ConfigFile, JsonCodec } from "@effected/config-file";
import { JsoncCodec } from "@effected/config-file/jsonc";
import { TomlCodec } from "@effected/config-file/toml";
import { YamlCodec } from "@effected/config-file/yaml";
import { Schema } from "effect";

const Shape = Schema.Struct({ port: Schema.Number });
export const reads = [JsonCodec, JsoncCodec, TomlCodec, YamlCodec].map((codec) =>
	ConfigFile.read("config", { schema: Shape, codec }),
);
`;
		// The live control: if a subpath's ConfigCodec import failed to resolve, the codec would be any and assign.
		const control = `import { JsoncCodec } from "@effected/config-file/jsonc";
export const wrong: number = JsoncCodec;
`;
		const fixture = mkdtempSync(join(tmpdir(), "config-file-subpaths-"));
		try {
			mkdirSync(join(fixture, "node_modules", "@effected"), { recursive: true });
			symlinkSync(BUILT, join(fixture, "node_modules", "@effected", "config-file"), "dir");
			symlinkSync(
				realpathSync(join(PACKAGE, "node_modules", "effect")),
				join(fixture, "node_modules", "effect"),
				"dir",
			);
			writeFileSync(join(fixture, "consumer.ts"), consumer);
			writeFileSync(join(fixture, "control.ts"), control);
			writeFileSync(
				join(fixture, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						strict: true,
						exactOptionalPropertyTypes: true,
						module: "nodenext",
						moduleResolution: "nodenext",
						target: "es2022",
						noEmit: true,
						skipLibCheck: true,
						types: [],
					},
					files: ["consumer.ts", "control.ts"],
				}),
			);
			const result = spawnSync(TSC, ["-p", "."], { cwd: fixture, encoding: "utf8" });
			const lines = `${result.stdout}${result.stderr}`
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "");
			assert.deepStrictEqual(
				lines.filter((line) => line.startsWith("consumer.ts")),
				[],
			);
			const controlLines = lines.filter((line) => line.startsWith("control.ts"));
			assert.isNotEmpty(controlLines, "live control: a codec assigned to number is reported, so the gate can fail");
			assert.isTrue(
				controlLines.some((line) => line.includes("ConfigCodec")),
				`the control fails for the codec's type: ${controlLines.join(" | ")}`,
			);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	}, 60_000);
});
