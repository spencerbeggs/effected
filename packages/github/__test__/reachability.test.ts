import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

/**
 * The tree-shaking invariant, as a test rather than a promise.
 *
 * @remarks
 * The package this replaces put octokit, `@octokit/auth-app`'s OAuth arm,
 * CycloneDX and Sigstore behind one entry point, and the cost was real and
 * measured: one consumer whose only GitHub dependency was that package shipped
 * an eleven-line bundler ignore list for XML libraries it never invoked. The
 * failure was invisible until somebody measured a bundle.
 *
 * So the claim "a token-only consumer cannot reach the GitHub App JWT signer" is
 * checked here, structurally, by walking the **runtime** import graph of `src`.
 * `import type` is skipped because it is erased — which is also what makes the
 * generous use of `@octokit/types` free, and that is asserted too.
 *
 * What this does not prove is that a downstream bundler drops the unreferenced
 * module; that rests on `"sideEffects": false` (asserted below) plus the
 * module-per-file output the builder emits. What it does prove is the part we
 * control: no edge exists.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every `from "..."` specifier in a module, ignoring type-only imports. */
const runtimeSpecifiers = (source: string): ReadonlyArray<string> => {
	const specifiers: Array<string> = [];
	// Doc comments carry `@example` blocks with real import statements in them.
	// Stripping comments first is what stops this walker from "finding" an edge
	// that only exists in prose — which it did, on the first run.
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/.*/g, "$1");
	const pattern = /(?:^|\n)\s*(?:import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;
	for (const match of code.matchAll(pattern)) {
		const clause = match[1] ?? "";
		const specifier = match[2];
		if (specifier === undefined) continue;
		// `import type { X } from "y"` and `export type { X } from "y"` are erased.
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
		const source = readFileSync(file, "utf8");
		for (const specifier of runtimeSpecifiers(source)) {
			if (specifier.startsWith(".")) {
				queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
			} else {
				bare.add(specifier);
			}
		}
	}
	return bare;
};

const SIGNER = "universal-github-app-jwt";

describe("bundle reachability", () => {
	it("the App module DOES reach the JWT signer", () => {
		// The control. Without it, the assertion below could pass because the
		// walker is broken rather than because the edge is absent.
		assert.isTrue(reachableBareImports("GitHubApp.ts").has(SIGNER));
	});

	it("a token-only client does NOT reach the JWT signer", () => {
		const reachable = reachableBareImports("GitHubClient.ts");
		assert.isFalse(
			reachable.has(SIGNER),
			`GitHubClient reaches ${SIGNER} — layerFromApp's dependency has leaked into the token path`,
		);
		assert.isTrue(reachable.has("@octokit/core"), "but it does reach the transport it needs");
	});

	it("the octokit type packages are reachable only as types", () => {
		// `@octokit/types` ships no JavaScript at all, and `plugin-paginate-rest`'s
		// generated route map is likewise types. Leaning on them costs zero runtime
		// bytes, which is why this package types every endpoint rather than none.
		const reachable = reachableBareImports("Rest.ts");
		assert.deepStrictEqual([...reachable].sort(), ["effect"]);
	});

	it("the pure classes reach nothing but effect", () => {
		for (const entry of ["Resilience.ts", "GraphQL.ts"]) {
			assert.deepStrictEqual([...reachableBareImports(entry)].sort(), ["effect"], entry);
		}
	});

	it("the package declares itself side-effect free", () => {
		// The other half of the mechanism: without this a bundler must assume
		// evaluating an unreferenced module matters, and keeps it.
		const manifest = JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8")) as {
			sideEffects?: unknown;
		};
		assert.strictEqual(manifest.sideEffects, false);
	});

	it("every runtime dependency is declared", () => {
		// A package you import but do not declare is how a peer closure rots; the
		// classifier in GitHubError reads octokit's throwables structurally rather
		// than importing `@octokit/request-error` for exactly this reason.
		const manifest = JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		const declared = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
		]);
		const used = new Set([...reachableBareImports("index.ts"), ...reachableBareImports("GitHubApp.ts")]);
		for (const specifier of used) {
			const packageName = specifier.startsWith("@")
				? specifier.split("/").slice(0, 2).join("/")
				: specifier.split("/")[0];
			assert.isTrue(declared.has(packageName ?? specifier), `${specifier} is imported but not declared`);
		}
	});
});
