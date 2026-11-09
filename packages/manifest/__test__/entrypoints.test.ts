import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");

/**
 * A module's code with its comments removed, line comments before block
 * comments, so a TSDoc example that imports a package is not read as an
 * import. `src/` holds no `//` inside a string literal, which is what makes
 * this naive stripper safe here.
 */
const codeOf = (source: string): string => source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every import specifier in a source text, in every import and re-export form. */
const specifiersIn = (source: string): ReadonlyArray<string> =>
	[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((match) => match[1] ?? "");

describe("@effected/manifest entrypoint", () => {
	it("exports the manifest schema and its boundaries and no other runtime value", async () => {
		const main = await import("../src/index.js");
		assert.deepStrictEqual(Object.keys(main).sort(), [
			"BUNDLE_MANIFEST_FILENAME",
			"BundleManifest",
			"BundleManifestError",
			"KNOWN_REGISTRY_TYPES",
			"MANIFEST_SPEC",
			"ManifestSource",
			"OpenGraphConfig",
			"OpenGraphImage",
			"ProjectIdentity",
			"RegistryRef",
			"SbomRef",
			"decodeBundleManifest",
			"decodeManifestSource",
			"encodeBundleManifest",
			"isKnownRegistryType",
		]);
	});

	it("imports only effect and its own modules, so a doc-site reader installs nothing else", () => {
		const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
		// positive control: the walk found the modules
		assert.includeMembers(files, ["index.ts", "BundleManifest.ts", "ManifestSource.ts"]);
		const foreign = files.flatMap((file) =>
			specifiersIn(codeOf(readFileSync(resolve(SRC, file), "utf8")))
				.filter((specifier) => !specifier.startsWith("./") && specifier !== "effect")
				.map((specifier) => `${file}: ${specifier}`),
		);
		assert.deepStrictEqual(foreign, []);
	});

	it("the specifier scan sees a bare import in every form", () => {
		assert.include(specifiersIn(readFileSync(fileURLToPath(import.meta.url), "utf8")), "node:fs");
		const fixture = [
			'import "side-effect";',
			'const lazy = await import("dynamic");',
			'export { thing } from "reexport";',
			'import type { T } from "type-only";',
			'// import { b } from "line-comment";',
		].join("\n");
		assert.deepStrictEqual([...specifiersIn(codeOf(fixture))].sort(), [
			"dynamic",
			"reexport",
			"side-effect",
			"type-only",
		]);
	});

	it("declares effect as its only peer and no dependency at all", () => {
		const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
		assert.notProperty(manifest, "dependencies");
		assert.notProperty(manifest, "optionalDependencies");
		assert.deepStrictEqual(manifest.peerDependencies, { effect: "catalog:effected:peers" });
		// positive control: the manifest read is live
		assert.property(manifest, "devDependencies");
		assert.strictEqual(manifest.sideEffects, false);
	});
});
