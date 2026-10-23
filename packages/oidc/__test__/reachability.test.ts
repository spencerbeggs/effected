// The confinement invariant, as a test rather than a promise.
//
// `IdentityToken.ts` is the issuer contract `@effected/sbom` depends on, and
// sbom needs only the contract: it must link no JWT code. So the claim
// "IdentityToken reaches only effect" is checked structurally, by walking the
// RUNTIME import graph of `src`. `import type` is skipped because it is erased.
// What this does not prove is that a downstream bundler drops an unreferenced
// module; that rests on `"sideEffects": false` (asserted below) plus the
// module-per-file output the builder emits.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every `from "..."` specifier in a module, ignoring type-only imports. */
const runtimeSpecifiers = (source: string): ReadonlyArray<string> => {
	// Doc comments carry `@example` blocks with real import statements in them,
	// so comments come out first or the walker "finds" edges that exist only in
	// prose. LINE comments go first, and that ordering is load-bearing: a
	// `/*`-bearing token in a line comment (a scope like `@effected/*`) opens a
	// block comment as far as a regex is concerned, and stripping blocks first
	// would delete real imports and pass in the permissive direction.
	const code = source.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
	const pattern = /(?:^|\n)\s*(?:import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;
	const specifiers: Array<string> = [];
	for (const match of code.matchAll(pattern)) {
		const clause = match[1] ?? "";
		const specifier = match[2];
		if (specifier === undefined) continue;
		if (/^\s*type\b/.test(clause)) continue;
		specifiers.push(specifier);
	}
	return specifiers;
};

/** Every bare (non-relative) specifier reachable at runtime from `entry`. */
const reachableBareImports = (entry: string): ReadonlySet<string> => {
	const seen = new Set<string>();
	const bare = new Set<string>();
	const queue = [resolve(SRC, entry)];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
			if (specifier.startsWith(".")) {
				queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
			} else {
				bare.add(specifier);
			}
		}
	}
	return bare;
};

const manifest = (): {
	readonly sideEffects?: unknown;
	readonly dependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
} => JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8"));

describe("bundle reachability", () => {
	it("the walker does not lose imports after a /*-bearing token in a line comment", () => {
		// The stripper's own regression test. The token must sit in a LINE
		// comment: inside a block comment a `/*` is swallowed by its container,
		// so a block-comment fixture passes with or without the fix.
		const fixture = [
			"// Prose naming a scope like @effected/* here.",
			'import { Schema } from "effect";',
			"/** A real doc comment, whose close is the phantom comment's close. */",
			'import { Jwt } from "@effected/jwt";',
			'import type { Duration } from "effect";',
			"export const x = [Schema, Jwt];",
		].join("\n");
		assert.deepStrictEqual([...runtimeSpecifiers(fixture)], ["effect", "@effected/jwt"]);
	});

	it("the verifier DOES reach @effected/jwt", () => {
		// The positive control: without it, the assertion below could pass because
		// the walker is broken rather than because the edge is absent.
		assert.deepStrictEqual([...reachableBareImports("Oidc.ts")].sort(), ["@effected/jwt", "effect"]);
		assert.deepStrictEqual([...reachableBareImports("IdTokenClaims.ts")].sort(), ["@effected/jwt", "effect"]);
		assert.isTrue(reachableBareImports("index.ts").has("@effected/jwt"));
	});

	it("IdentityToken reaches nothing but effect", () => {
		assert.deepStrictEqual(
			[...reachableBareImports("IdentityToken.ts")].sort(),
			["effect"],
			"IdentityToken reaches more than effect: @effected/sbom would link it",
		);
	});

	it("the package declares itself side-effect free", () => {
		assert.strictEqual(manifest().sideEffects, false);
	});

	it("every runtime dependency is declared, and no node: builtin is imported", () => {
		const { dependencies, peerDependencies } = manifest();
		const declared = new Set([...Object.keys(dependencies ?? {}), ...Object.keys(peerDependencies ?? {})]);
		for (const specifier of reachableBareImports("index.ts")) {
			assert.isFalse(specifier.startsWith("node:"), `${specifier} is a node: import in a boundary package`);
			const packageName = specifier.startsWith("@")
				? specifier.split("/").slice(0, 2).join("/")
				: specifier.split("/")[0];
			assert.isTrue(declared.has(packageName ?? specifier), `${specifier} is imported but not declared`);
		}
	});
});
