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

/**
 * Source with comments removed, so an import that exists only in an
 * `@example` block is not mistaken for a real edge. Four of the modules
 * checked below already carry `@example` blocks, and a guardrail is exactly
 * the thing someone illustrates with a "never do this" import.
 *
 * LINE comments come out FIRST, and the ordering is load-bearing rather than
 * stylistic. Prose containing a `/*`-bearing token — a glob like `src/[*]`, or
 * a scope like `@effected/[*]` — opens a block comment as far as a regex is
 * concerned; stripping blocks first deletes everything from that word to the
 * end of the next doc comment, real imports included. In this suite that
 * direction is doubly bad: a devoured import makes the confinement assertion
 * PASS, so the guardrail would report success precisely when it had stopped
 * looking. Blocks cannot nest, so once the fake openers are gone a `/*` inside
 * a real block comment is harmless.
 */
const stripComments = (source: string): string =>
	source.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

describe("tier guardrail: the pure vocabulary does not reach IO", () => {
	for (const module of VOCABULARY) {
		it(`${module} imports no IO module`, () => {
			const code = stripComments(read(module));
			for (const io of IO_MODULES) {
				assert.notInclude(
					code,
					`from "${io}"`,
					`${module} must not import ${io} — a contracts-only consumer would link it`,
				);
			}
		});
	}

	// The discriminating case. A LINE comment mentioning a glob or a scoped
	// wildcard used to open a phantom block comment that ran to the end of the
	// next doc comment, swallowing every import between — and this suite reads a
	// swallowed import as "no edge", i.e. as a pass.
	//
	// Two things about this test were wrong on the first draft and are worth not
	// repeating: the token must sit in a LINE comment (inside a block comment a
	// `/*` is swallowed by its own comment and is harmless), and the body must be
	// the test function itself — an `it(name, () => (…) => {…})` returns a
	// closure that never runs, and passes unconditionally.
	it("the comment stripper does not devour code after a /*-bearing token", () => {
		const fixture = [
			"// Prose naming a glob like src/* and a scope like @effected/* here.",
			'import { Run } from "@effected/commands";',
			"/** A real doc comment, whose close is the phantom's close. */",
			"export const x = Run;",
		].join("\n");
		const stripped = stripComments(fixture);
		assert.include(stripped, 'from "@effected/commands"', "a real import must survive the stripper");
		assert.notInclude(stripped, "Prose naming a glob", "prose must not survive the stripper");
	});

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
