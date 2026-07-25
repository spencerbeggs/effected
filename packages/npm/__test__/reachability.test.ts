// The tier guardrail, asserted rather than trusted to review.
//
// `@effected/npm` became boundary tier when NpmRegistry and PackagePublish
// landed, but `@effected/lockfiles` (PURE) and `@effected/package-json` depend
// on it for vocabulary only — `IntegrityHash`, `DependencySpecifier`, the
// section literals. Those consumers must be able to import the vocabulary
// without linking an HTTP client or a subprocess runner.
//
// Two things protect that, and both are checkable from the source graph:
//   1. the vocabulary modules import neither service nor `@effected/commands`;
//   2. `index.ts` exports every symbol individually — a namespace object would
//      be one live binding and would retain the whole graph regardless of (1).
//
// This is a source-level check because ESM offers no module-graph
// introspection at runtime; the import edges ARE the reachability.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";

const SRC = new URL("../src/", import.meta.url).pathname;

/** The modules a contracts-only consumer imports. */
const VOCABULARY = [
	"IntegrityHash.ts",
	"DependencySpecifier.ts",
	"DependencySection.ts",
	"ReleaseAgeGate.ts",
	"CatalogResolver.ts",
	"WorkspaceResolver.ts",
	"CatalogAssemblyError.ts",
	"Manifest.ts",
];

/** Modules that reach IO, directly or transitively. */
const IO_MODULES = ["./NpmRegistry.js", "./PackagePublish.js", "./NpmExecutor.js", "@effected/commands"];

const read = (file: string): string => readFileSync(join(SRC, file), "utf8");

describe("tier guardrail: the pure vocabulary does not reach IO", () => {
	for (const module of VOCABULARY) {
		it(`${module} imports no IO module`, () => {
			const source = read(module);
			for (const io of IO_MODULES) {
				assert.notInclude(
					source,
					`from "${io}"`,
					`${module} must not import ${io} — a contracts-only consumer would link it`,
				);
			}
		});
	}

	it("every vocabulary module in VOCABULARY actually exists", () => {
		// Guards the list itself: a renamed module would silently drop out of the
		// check above and the suite would still pass.
		const present = new Set(readdirSync(SRC).filter((f) => f.endsWith(".ts")));
		for (const module of VOCABULARY) {
			assert.isTrue(present.has(module), `${module} is listed but missing from src/`);
		}
	});
});

describe("tier guardrail: the entrypoint exports individually", () => {
	it("index.ts declares no namespace object over the surface", () => {
		const source = read("index.ts");
		// `export * as X from` is the namespace-object form; a bundler cannot see
		// through it, so one import of the vocabulary would retain every service.
		assert.notMatch(
			source,
			/export\s+\*\s+as\s/,
			"index.ts must not export a namespace object — it defeats tree-shaking for every consumer",
		);
	});

	it("index.ts exports the services by name", () => {
		const source = read("index.ts");
		assert.include(source, "NpmRegistry");
		assert.include(source, "PackagePublish");
	});
});
